#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultOutputRoot = resolve(scriptDir, '../../public/vehicles/aircraft');
const transformBin = join(scriptDir, 'node_modules/.bin/gltf-transform');
const tiers = Object.freeze({ high: 2048, balanced: 1024, low: 512 });

const helpText = `Sansara aircraft asset pipeline

Accepted input (always supplied by exact path):
  * an official .glb file
  * an official .zip containing one .glb, or a .gltf with its .bin and textures

Commands:
  npm run help
  npm run dry-run -- [--input /exact/package.glb|zip] [--entry path/in/archive/scene.gltf]
  npm run ingest -- --input /exact/package.glb|zip --slug aircraft-id --metadata ./presets/model.json [--entry path/in/archive/scene.gltf]
  npm run validate -- --manifest ../../public/vehicles/aircraft/aircraft-id/manifest.json

Ingest output:
  public/vehicles/aircraft/<slug>/source/       untouched official input and provenance.json
  public/vehicles/aircraft/<slug>/runtime/high/model.glb      max 2048 px textures
  public/vehicles/aircraft/<slug>/runtime/balanced/model.glb  max 1024 px textures
  public/vehicles/aircraft/<slug>/runtime/low/model.glb       max 512 px textures
  public/vehicles/aircraft/<slug>/manifest.json               controller-facing record

The resize pass never enlarges textures. It does not prune, weld, flatten, join, quantize,
or compress geometry, so node hierarchy, names, skins, animations, and PBR bindings remain.
The command refuses to replace an existing asset directory or modify the supplied input.`;

function parseArgs(argv) {
  const command = argv[0] ?? 'help';
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit' });
  if (result.error) throw new Error(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture ? `\n${(result.stderr || result.stdout).trim()}` : '';
    throw new Error(`${command} exited with status ${result.status}.${detail}`);
  }
  return options.capture ? result.stdout : '';
}

async function exists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

function requireSlug(value) {
  if (!value || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error('--slug must contain lowercase letters, numbers, and single hyphens only.');
  }
  return value;
}

async function inspectModel(path) {
  let NodeIO;
  let ALL_EXTENSIONS;
  try {
    ({ NodeIO } = await import('@gltf-transform/core'));
    ({ ALL_EXTENSIONS } = await import('@gltf-transform/extensions'));
  } catch (error) {
    throw new Error(`glTF inspection packages are missing. Run npm ci here first. (${error.message})`);
  }
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
  const root = document.getRoot();
  const nodes = root.listNodes();
  const textures = root.listTextures();
  const textureIndex = new Map(textures.map((texture, index) => [texture, index]));
  const textureRef = (texture) => texture ? textureIndex.get(texture) : null;
  const names = (items) => items.map((item) => item.getName());
  const animations = root.listAnimations().map((animation) => ({
    name: animation.getName(),
    channels: animation.listChannels().map((channel) => ({
      targetNode: channel.getTargetNode()?.getName() ?? '',
      targetPath: channel.getTargetPath()
    }))
  }));
  const materials = root.listMaterials().map((material) => ({
    name: material.getName(),
    baseColorTexture: textureRef(material.getBaseColorTexture()),
    metallicRoughnessTexture: textureRef(material.getMetallicRoughnessTexture()),
    normalTexture: textureRef(material.getNormalTexture()),
    occlusionTexture: textureRef(material.getOcclusionTexture()),
    emissiveTexture: textureRef(material.getEmissiveTexture()),
    alphaMode: material.getAlphaMode(),
    doubleSided: material.getDoubleSided()
  }));
  const summary = {
    counts: {
      scenes: root.listScenes().length,
      nodes: nodes.length,
      meshes: root.listMeshes().length,
      materials: materials.length,
      textures: textures.length,
      animations: animations.length,
      skins: root.listSkins().length,
      cameras: root.listCameras().length
    },
    nodeNames: names(nodes),
    meshNames: names(root.listMeshes()),
    skinNames: names(root.listSkins()),
    animations,
    materials,
    textures: textures.map((texture, index) => ({
      id: texture.getName() || `texture-${String(index).padStart(3, '0')}`,
      mimeType: texture.getMimeType(),
      dimensions: texture.getSize()
    })),
    extensionsUsed: root.listExtensionsUsed().map((extension) => extension.extensionName).sort(),
    extensionsRequired: root.listExtensionsRequired().map((extension) => extension.extensionName).sort()
  };
  summary.structureSha256 = createHash('sha256').update(JSON.stringify({
    counts: summary.counts,
    nodeNames: summary.nodeNames,
    meshNames: summary.meshNames,
    skinNames: summary.skinNames,
    animations: summary.animations,
    materials: summary.materials,
    extensionsUsed: summary.extensionsUsed,
    extensionsRequired: summary.extensionsRequired
  })).digest('hex');
  return summary;
}

function safeArchiveEntries(zipPath) {
  const entries = run('unzip', ['-Z1', zipPath], { capture: true }).split(/\r?\n/).filter(Boolean);
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error(`Unsafe path in ZIP: ${entry}`);
    }
  }
  return entries;
}

function selectZipEntry(entries, requested) {
  const candidates = entries.filter((entry) => /\.(?:glb|gltf)$/i.test(entry));
  if (requested) {
    if (!candidates.includes(requested)) throw new Error(`--entry does not name a .glb or .gltf in the ZIP: ${requested}`);
    return requested;
  }
  if (candidates.length === 0) throw new Error('ZIP contains no .glb or .gltf scene.');
  if (candidates.length > 1) throw new Error(`ZIP contains multiple scene files; pass --entry with one of:\n${candidates.join('\n')}`);
  return candidates[0];
}

async function resolveInput(inputValue, entryValue, workspace) {
  if (!inputValue) throw new Error('--input is required and must be an explicit path.');
  const input = resolve(inputValue);
  const info = await stat(input).catch(() => null);
  if (!info?.isFile()) throw new Error(`Input is not a readable file: ${input}`);
  const extension = extname(input).toLowerCase();
  if (!['.glb', '.zip'].includes(extension)) throw new Error('Input must be an official .glb or .zip package.');
  if (extension === '.glb') return { input, model: input, selectedEntry: null, kind: 'glb' };
  const entries = safeArchiveEntries(input);
  const selectedEntry = selectZipEntry(entries, entryValue);
  if (!workspace) return { input, model: null, selectedEntry, kind: 'zip' };
  const extracted = join(workspace, 'extracted');
  await mkdir(extracted, { recursive: true });
  run('unzip', ['-q', input, '-d', extracted]);
  const model = resolve(extracted, selectedEntry);
  if (relative(extracted, model).startsWith(`..${sep}`) || !await exists(model)) throw new Error('Selected ZIP scene could not be extracted safely.');
  return { input, model, selectedEntry, kind: 'zip' };
}

function assertStructure(source, output, label) {
  if (source.structureSha256 !== output.structureSha256) {
    throw new Error(`${label} changed hierarchy, names, skins, animations, materials, or extension requirements.`);
  }
}

async function dryRun(options) {
  console.log(helpText);
  console.log('\nPrerequisite check:');
  console.log(`  Node ${process.versions.node}: ${Number(process.versions.node.split('.')[0]) >= 20 ? 'ready' : 'needs Node 20+'}`);
  console.log(`  local glTF-Transform: ${await exists(transformBin) ? 'ready' : 'missing; run npm ci in tools/aircraft-pipeline'}`);
  let sharpReady = false;
  try { await import('sharp'); sharpReady = true; } catch { /* Report below without aborting the read-only check. */ }
  console.log(`  Sharp texture backend: ${sharpReady ? 'ready' : 'missing; run npm ci in tools/aircraft-pipeline'}`);
  const unzipReady = spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0;
  console.log(`  unzip (needed only for ZIP input): ${unzipReady ? 'ready' : 'missing'}`);
  if (options.input) {
    const resolved = await resolveInput(options.input, options.entry, null);
    console.log(`  input: ${resolved.input}`);
    console.log(`  scene: ${resolved.selectedEntry ?? basename(resolved.input)}`);
  } else {
    console.log('  input: not checked; pass --input with one exact file path');
  }
  console.log('\nDry run made no asset changes.');
}

async function ingest(options) {
  const slug = requireSlug(options.slug);
  if (!options.metadata) throw new Error('--metadata is required. Use a reviewed preset or JSON record.');
  if (!await exists(transformBin)) throw new Error('glTF-Transform is missing. Run npm ci in tools/aircraft-pipeline.');
  const outputRoot = options['output-root'] ? resolve(options['output-root']) : defaultOutputRoot;
  const destination = join(outputRoot, slug);
  if (await exists(destination)) throw new Error(`Refusing to overwrite existing asset directory: ${destination}`);
  const metadataPath = resolve(options.metadata);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  for (const field of ['title', 'creator', 'sourceUrl', 'license', 'creditText', 'metadataStatus']) {
    if (!metadata[field]) throw new Error(`Metadata record is missing ${field}.`);
  }
  const staging = join(outputRoot, `.${slug}.staging-${process.pid}`);
  await mkdir(staging, { recursive: true });
  try {
    const resolvedInput = await resolveInput(options.input, options.entry, staging);
    const sourceDir = join(staging, 'source');
    const reportsDir = join(staging, 'reports');
    await mkdir(sourceDir, { recursive: true });
    await mkdir(reportsDir, { recursive: true });
    const archiveName = resolvedInput.kind === 'zip' ? 'official-package.zip' : 'original.glb';
    const archivedInput = join(sourceDir, archiveName);
    await copyFile(resolvedInput.input, archivedInput, fsConstants.COPYFILE_EXCL);

    console.log(`Inspecting ${resolvedInput.model}`);
    const sourceInspection = await inspectModel(resolvedInput.model);
    await writeFile(join(reportsDir, 'source-inspection.json'), `${JSON.stringify(sourceInspection, null, 2)}\n`);

    const runtime = {};
    for (const [tier, textureMaxSize] of Object.entries(tiers)) {
      const tierDir = join(staging, 'runtime', tier);
      const modelPath = join(tierDir, 'model.glb');
      await mkdir(tierDir, { recursive: true });
      console.log(`Building ${tier} (${textureMaxSize}px texture ceiling)`);
      run(transformBin, ['resize', resolvedInput.model, modelPath, '--width', String(textureMaxSize), '--height', String(textureMaxSize)]);
      const outputInspection = await inspectModel(modelPath);
      assertStructure(sourceInspection, outputInspection, tier);
      const modelStat = await stat(modelPath);
      runtime[tier] = {
        url: `/vehicles/aircraft/${slug}/runtime/${tier}/model.glb`,
        textureMaxSize,
        bytes: modelStat.size,
        sha256: await sha256(modelPath),
        structureSha256: outputInspection.structureSha256,
        textureDimensions: outputInspection.textures.map(({ id, dimensions }) => ({ id, dimensions }))
      };
      await writeFile(join(reportsDir, `${tier}-inspection.json`), `${JSON.stringify(outputInspection, null, 2)}\n`);
    }

    const inputStat = await stat(resolvedInput.input);
    const provenance = {
      packageInspectionStatus: 'inspected',
      sourceType: resolvedInput.kind,
      archivedAs: archiveName,
      originalFilename: basename(resolvedInput.input),
      selectedSceneEntry: resolvedInput.selectedEntry,
      bytes: inputStat.size,
      sha256: await sha256(resolvedInput.input),
      sourceUrl: metadata.sourceUrl,
      creator: metadata.creator,
      license: metadata.license,
      creditText: metadata.creditText,
      metadataStatus: metadata.metadataStatus === 'pending-package-inspection' ? 'package-inspected' : metadata.metadataStatus,
      notes: metadata.notes ?? null
    };
    await writeFile(join(sourceDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
    const namedParts = [...new Set(sourceInspection.nodeNames.filter(Boolean))];
    const manifest = {
      schemaVersion: 1,
      id: slug,
      metadata: {
        ...metadata,
        metadataStatus: metadata.metadataStatus === 'pending-package-inspection' ? 'package-inspected' : metadata.metadataStatus
      },
      source: provenance,
      inspection: {
        counts: sourceInspection.counts,
        structureSha256: sourceInspection.structureSha256,
        namedParts,
        animations: sourceInspection.animations,
        textures: sourceInspection.textures,
        extensionsUsed: sourceInspection.extensionsUsed,
        extensionsRequired: sourceInspection.extensionsRequired
      },
      runtime
    };
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    if (resolvedInput.kind === 'zip') await rm(join(staging, 'extracted'), { recursive: true, force: true });
    await rename(staging, destination);
    console.log(`Ingested ${slug} at ${destination}`);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function validate(options) {
  if (!options.manifest) throw new Error('--manifest is required.');
  const manifestPath = resolve(options.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !manifest.id || !manifest.source?.sha256) throw new Error('Manifest does not match schema version 1.');
  const baseDir = dirname(manifestPath);
  const provenance = JSON.parse(await readFile(join(baseDir, 'source/provenance.json'), 'utf8'));
  if (provenance.sha256 !== manifest.source.sha256) throw new Error('Provenance hash does not match manifest.');
  const archivedSource = join(baseDir, 'source', provenance.archivedAs);
  if (await sha256(archivedSource) !== provenance.sha256) throw new Error('Archived source bytes do not match provenance.');
  for (const [tier, ceiling] of Object.entries(tiers)) {
    const record = manifest.runtime?.[tier];
    if (!record || record.textureMaxSize !== ceiling) throw new Error(`${tier} tier has the wrong texture ceiling.`);
    const modelPath = join(baseDir, 'runtime', tier, 'model.glb');
    if (await sha256(modelPath) !== record.sha256) throw new Error(`${tier} GLB hash does not match manifest.`);
    const inspection = await inspectModel(modelPath);
    if (inspection.structureSha256 !== manifest.inspection.structureSha256) throw new Error(`${tier} GLB structure differs from the source inspection.`);
    if (inspection.textures.some((texture) => texture.dimensions.some((dimension) => dimension > ceiling))) {
      throw new Error(`${tier} GLB contains a texture larger than ${ceiling}px.`);
    }
    console.log(`${tier}: valid, ${record.bytes} bytes, ${inspection.counts.animations} animation(s)`);
  }
  console.log(`Manifest valid: ${manifestPath}`);
}

try {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'help' || command === '--help' || command === '-h') console.log(helpText);
  else if (command === 'dry-run') await dryRun(options);
  else if (command === 'ingest') await ingest(options);
  else if (command === 'validate') await validate(options);
  else throw new Error(`Unknown command: ${command}\n\n${helpText}`);
} catch (error) {
  console.error(`aircraft-pipeline: ${error.message}`);
  process.exitCode = 1;
}
