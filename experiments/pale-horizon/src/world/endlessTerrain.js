import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";

import { noise2, runwayTerrainBlend, terrainHeight, terrainNormal } from "./terrainField.js";

/*
 * Six nested tile rings follow the aircraft. Each ring is one mesh and one draw
 * call; only its vertex buffers change when the aircraft crosses that level's
 * tile boundary. Adjacent levels overlap by half a coarse tile, and coarse
 * geometry sits a few centimetres lower, which hides T-junctions without a
 * visible wall or a crack during fast low-altitude flight.
 */
const LEVELS = Object.freeze([
  { tile: 256, segments: 24, radius: 3, full: true },
  { tile: 512, segments: 18, radius: 3 },
  { tile: 1024, segments: 16, radius: 3 },
  { tile: 2048, segments: 14, radius: 3 },
  { tile: 4096, segments: 11, radius: 3 },
  { tile: 8192, segments: 9, radius: 3 },
]);

const PALETTE = {
  low: [0.155, 0.215, 0.205],
  field: [0.235, 0.295, 0.274],
  rock: [0.325, 0.325, 0.300],
  pale: [0.545, 0.555, 0.525],
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth01 = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

function tileAxis(center, offset, index, config) {
  const { tile, segments, radius } = config;
  let lo = (offset - 0.5) * tile;
  let hi = (offset + 0.5) * tile;
  // A level may be half of the next level's tile away from its centre. Widening
  // only the outermost row by half a tile guarantees the finer ring still meets
  // the next ring in that worst alignment, without paying for another full row
  // of tiles at every LOD.
  if (offset === -radius) lo -= tile * 0.52;
  if (offset === radius) hi += tile * 0.52;
  return center + mix(lo, hi, index / segments);
}

function writeSurfaceColor(colors, offset, x, z, height, normalY, level) {
  const altitude = smooth01((height + 65) / 520);
  const steep = smooth01((0.91 - normalY) / 0.34);
  const pale = smooth01((height - 230) / 360) * (1 - steep * 0.38);
  const wet = smooth01((-height - 18) / 95);
  const breakup = noise2(x * 0.0063 + 17.2, z * 0.0063 - 6.4) * 0.045;

  let r = mix(PALETTE.low[0], PALETTE.field[0], altitude);
  let g = mix(PALETTE.low[1], PALETTE.field[1], altitude);
  let b = mix(PALETTE.low[2], PALETTE.field[2], altitude);
  r = mix(r, PALETTE.rock[0], steep);
  g = mix(g, PALETTE.rock[1], steep);
  b = mix(b, PALETTE.rock[2], steep);
  r = mix(r, PALETTE.pale[0], pale);
  g = mix(g, PALETTE.pale[1], pale);
  b = mix(b, PALETTE.pale[2], pale);
  r = mix(r, 0.12, wet * 0.24) + breakup;
  g = mix(g, 0.17, wet * 0.24) + breakup;
  b = mix(b, 0.18, wet * 0.24) + breakup * 0.7;

  // Fine colour noise belongs near the aircraft. Fade it from distant rings so
  // sub-pixel variation does not shimmer along the horizon.
  const detailFade = 1 - level / (LEVELS.length + 1);
  colors[offset] = clamp01(r + breakup * detailFade);
  colors[offset + 1] = clamp01(g + breakup * detailFade);
  colors[offset + 2] = clamp01(b + breakup * detailFade);
  colors[offset + 3] = 1;
}

function tileOffsets(config) {
  const offsets = [];
  for (let dz = -config.radius; dz <= config.radius; dz++) {
    for (let dx = -config.radius; dx <= config.radius; dx++) {
      if (!config.full && Math.abs(dx) <= 1 && Math.abs(dz) <= 1) continue;
      offsets.push([dx, dz]);
    }
  }
  return offsets;
}

class TerrainRing {
  constructor(scene, material, level, config) {
    this.scene = scene;
    this.level = level;
    this.config = config;
    this.offsets = tileOffsets(config);
    this.centerTileX = Number.NaN;
    this.centerTileZ = Number.NaN;
    this.mesh = new Mesh(`terrain-lod-${level}`, scene);
    this.mesh.material = material;
    this.mesh.receiveShadows = true;
    this.mesh.useVertexColors = true;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;

    const side = config.segments + 1;
    this.vertexCount = this.offsets.length * side * side;
    this.positions = new Float32Array(this.vertexCount * 3);
    this.normals = new Float32Array(this.vertexCount * 3);
    this.colors = new Float32Array(this.vertexCount * 4);
    this.uvs = new Float32Array(this.vertexCount * 2);
    this.indices = this.#buildIndices();
  }

  #buildIndices() {
    const { segments } = this.config;
    const side = segments + 1;
    const indexCount = this.offsets.length * segments * segments * 6;
    const IndexArray = this.vertexCount > 65535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(indexCount);
    let cursor = 0;
    for (let tile = 0; tile < this.offsets.length; tile++) {
      const base = tile * side * side;
      for (let z = 0; z < segments; z++) {
        for (let x = 0; x < segments; x++) {
          const a = base + z * side + x;
          const b = a + 1;
          const c = a + side;
          const d = c + 1;
          indices[cursor++] = a;
          indices[cursor++] = c;
          indices[cursor++] = b;
          indices[cursor++] = b;
          indices[cursor++] = c;
          indices[cursor++] = d;
        }
      }
    }
    return indices;
  }

  update(worldX, worldZ, force = false) {
    const { tile, segments } = this.config;
    const nextTileX = Math.round(worldX / tile);
    const nextTileZ = Math.round(worldZ / tile);
    if (!force && nextTileX === this.centerTileX && nextTileZ === this.centerTileZ) return false;
    this.centerTileX = nextTileX;
    this.centerTileZ = nextTileZ;

    const centerX = nextTileX * tile;
    const centerZ = nextTileZ * tile;
    const side = segments + 1;
    const lodDrop = this.level * 0.055;
    let vertex = 0;

    // Height generation is the expensive part of a procedural terrain update.
    // Sample every vertex once, then derive render normals from the finished
    // height grid. Collision still uses the exact finite-difference normal from
    // terrainField, but terrain recentering avoids four extra field samples per
    // vertex and stays out of the flight loop most frames.
    for (let t = 0; t < this.offsets.length; t++) {
      const [tileOffsetX, tileOffsetZ] = this.offsets[t];
      for (let z = 0; z < side; z++) {
        const wz = tileAxis(centerZ, tileOffsetZ, z, this.config);
        for (let x = 0; x < side; x++) {
          const wx = tileAxis(centerX, tileOffsetX, x, this.config);
          const height = terrainHeight(wx, wz) - lodDrop * runwayTerrainBlend(wx, wz);

          const p = vertex * 3;
          this.positions[p] = wx - centerX;
          this.positions[p + 1] = height;
          this.positions[p + 2] = wz - centerZ;
          const uv = vertex * 2;
          this.uvs[uv] = wx / 54;
          this.uvs[uv + 1] = wz / 54;
          vertex++;
        }
      }
    }

    for (let t = 0; t < this.offsets.length; t++) {
      const base = t * side * side;
      for (let z = 0; z < side; z++) {
        const z0 = Math.max(0, z - 1);
        const z1 = Math.min(segments, z + 1);
        for (let x = 0; x < side; x++) {
          const x0 = Math.max(0, x - 1);
          const x1 = Math.min(segments, x + 1);
          const vertexIndex = base + z * side + x;
          const left = base + z * side + x0;
          const right = base + z * side + x1;
          const down = base + z0 * side + x;
          const up = base + z1 * side + x;
          const p = vertexIndex * 3;
          const leftP = left * 3;
          const rightP = right * 3;
          const downP = down * 3;
          const upP = up * 3;
          const spanX = Math.max(0.001, this.positions[rightP] - this.positions[leftP]);
          const spanZ = Math.max(0.001, this.positions[upP + 2] - this.positions[downP + 2]);
          let nx = -(this.positions[rightP + 1] - this.positions[leftP + 1]) / spanX;
          let ny = 1;
          let nz = -(this.positions[upP + 1] - this.positions[downP + 1]) / spanZ;
          const invLength = 1 / Math.max(1e-8, Math.hypot(nx, ny, nz));
          nx *= invLength;
          ny *= invLength;
          nz *= invLength;
          this.normals[p] = nx;
          this.normals[p + 1] = ny;
          this.normals[p + 2] = nz;
          writeSurfaceColor(
            this.colors,
            vertexIndex * 4,
            this.positions[p] + centerX,
            this.positions[p + 2] + centerZ,
            this.positions[p + 1],
            ny,
            this.level,
          );
        }
      }
    }

    this.mesh.position.x = centerX;
    this.mesh.position.z = centerZ;
    if (!this.mesh.isVerticesDataPresent(VertexBuffer.PositionKind)) {
      const data = new VertexData();
      data.positions = this.positions;
      data.normals = this.normals;
      data.colors = this.colors;
      data.uvs = this.uvs;
      data.indices = this.indices;
      data.applyToMesh(this.mesh, true);
    } else {
      this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, true, false);
      this.mesh.updateVerticesData(VertexBuffer.NormalKind, this.normals, false, false);
      this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors, false, false);
      this.mesh.updateVerticesData(VertexBuffer.UVKind, this.uvs, false, false);
    }
    this.mesh.refreshBoundingInfo(true);
    return true;
  }

  dispose() {
    this.mesh.dispose(false, false);
  }
}

export class EndlessTerrain {
  constructor(scene) {
    const detail = new DynamicTexture("terrain-micro-height", { width: 256, height: 256 }, scene, false);
    const context = detail.getContext();
    const image = context.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const ridge = Math.sin(x * 0.31 + Math.sin(y * 0.047) * 3.2) * 0.34;
        const cross = Math.sin(x * 0.071 - y * 0.113) * 0.18;
        const grain = Math.sin(x * 1.91 + y * 2.37) * 0.08;
        const value = Math.round((0.5 + ridge + cross + grain) * 255);
        const offset = (y * 256 + x) * 4;
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    detail.wrapU = Texture.WRAP_ADDRESSMODE;
    detail.wrapV = Texture.WRAP_ADDRESSMODE;
    detail.update(false);

    this.scene = scene;
    this.material = new StandardMaterial("pale-terrain-material", scene);
    this.material.diffuseColor = Color3.White();
    this.material.ambientColor = new Color3(0.10, 0.13, 0.125);
    this.material.specularColor = new Color3(0.075, 0.085, 0.08);
    this.material.specularPower = 18;
    this.material.bumpTexture = detail;
    detail.level = 0.32;
    this.material.backFaceCulling = false;
    this.material.twoSidedLighting = true;
    this.material.maxSimultaneousLights = 2;
    this.material.freeze();
    this.detailTexture = detail;

    this.rings = LEVELS.map((config, level) => new TerrainRing(scene, this.material, level, config));
    this.update({ x: 0, z: -620 }, true);
  }

  update(position, force = false) {
    for (let i = 0; i < this.rings.length; i++) {
      this.rings[i].update(position.x, position.z, force);
    }
  }

  heightAt(x, z) {
    return terrainHeight(x, z);
  }

  normalAt(x, z, out, sampleRadius) {
    return terrainNormal(x, z, out, sampleRadius);
  }

  dispose() {
    for (const ring of this.rings) ring.dispose();
    this.material.dispose();
    this.detailTexture.dispose();
  }
}

export { terrainHeight, terrainNormal } from "./terrainField.js";
