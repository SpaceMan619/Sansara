import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { ProceduralTexture } from "@babylonjs/core/Materials/Textures/Procedurals/proceduralTexture.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { createFallbackSky } from './fallbackSky.js';

// Pale Horizon now uses Dark Snow's actual atmospheric scattering and solar
// shader sources. Keeping these as imports, rather than rewritten copies, means
// future fixes to Dark Snow's sun model reach both experiments.
import noiseSource from "../../../dark-snow/src/shaders/lib/noise.wgsl?raw";
import atmosphereSource from "../../../dark-snow/src/shaders/lib/atmosphere.wgsl?raw";
import shadingSource from "../../../dark-snow/src/shaders/lib/shading.wgsl?raw";
import ridgeSource from "../../../dark-snow/src/shaders/lib/ridge.wgsl?raw";
import skyBakeSource from "../../../dark-snow/src/shaders/skyBake.fragment.wgsl?raw";
import skyVertexSource from "../../../dark-snow/src/shaders/sky.vertex.wgsl?raw";
import skyFragmentSource from "../../../dark-snow/src/shaders/sky.fragment.wgsl?raw";

ShaderStore.IncludesShadersStoreWGSL.snowNoise = noiseSource;
ShaderStore.IncludesShadersStoreWGSL.snowAtmosphere = atmosphereSource;
ShaderStore.IncludesShadersStoreWGSL.snowShading = shadingSource;
ShaderStore.IncludesShadersStoreWGSL.snowRidge = ridgeSource;
ShaderStore.ShadersStoreWGSL.paleDarkSkyBakePixelShader = skyBakeSource;
ShaderStore.ShadersStoreWGSL.paleDarkSkyVertexShader = skyVertexSource;
// From flight altitude the ground hemisphere of the shared LUT is visible
// beyond the terrain. Extend its horizon radiance instead of a black abyss.
ShaderStore.ShadersStoreWGSL.paleDarkSkyPixelShader = skyFragmentSource.replace(
  'let uv = dirToLatLong(dir);',
  'let uv = dirToLatLong(normalize(vec3f(dir.x, max(dir.y, 0.008), dir.z)));',
);

const SUN_SCALE_BASE = 5.5;
const DEG = Math.PI / 180;
const EMPTY_SH = new Float32Array(36);
const WIND = new Vector2(0.35, 0.94);

function waitUntilReady(object, label) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      try {
        if (object.isReady()) {
          resolve();
          return;
        }
      } catch (error) {
        reject(new Error(`${label} failed: ${error.message}`));
        return;
      }
      if (performance.now() - started > 25000) {
        reject(new Error(`${label} did not compile within 25 seconds`));
        return;
      }
      requestAnimationFrame(poll);
    };
    poll();
  });
}

export class DarkSnowAtmosphere {
  constructor(scene, {
    azimuth = 118,
    elevation = 13,
    intensity = 3.0,
    warmth = 1,
  } = {}) {
    this.scene = scene;
    this.azimuth = azimuth;
    this.elevation = elevation;
    this.intensity = intensity;
    this.warmth = warmth;
    this.sunDirection = new Vector3(0, 0.2, 1);
    this.sunColor = new Color3(1, 0.85, 0.66);
    this.sunRadiance = new Color3(1, 1, 1);
    this.sunScale = 1;
    this.groundBounce = new Color3(0, 0, 0);
    this.dirty = true;

    this.lut = new ProceduralTexture(
      "pale-dark-snow-sky-lut",
      { width: 512, height: 256 },
      "paleDarkSkyBake",
      scene,
      {
        generateMipMaps: true,
        type: Constants.TEXTURETYPE_HALF_FLOAT,
        format: Constants.TEXTUREFORMAT_RGBA,
        samplingMode: Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
        shaderLanguage: ShaderLanguage.WGSL,
        skipSceneRegistration: true,
      },
    );
    this.lut.wrapU = Constants.TEXTURE_WRAP_ADDRESSMODE;
    this.lut.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    this.lut.refreshRate = 0;

    this.mesh = MeshBuilder.CreateBox("pale-dark-snow-sky", { size: 2 }, scene);
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;

    this.material = new ShaderMaterial(
      "pale-dark-snow-sky-material",
      scene,
      { vertex: "paleDarkSky", fragment: "paleDarkSky" },
      {
        attributes: ["position"],
        uniforms: [
          "viewProjection", "cameraPosition", "skyScale", "sunDir",
          "sunColor", "sunIntensity", "time", "windDir", "cloudAmount",
          "sunRadiance", "shR", "ambientIntensity", "ridgeAmp",
          "fogDensity", "fogHeightFalloff", "fogStart", "aerialStrength",
        ],
        samplers: ["skyLUT"],
        shaderLanguage: ShaderLanguage.WGSL,
      },
    );
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.setTexture("skyLUT", this.lut);
    this.material.setArray4("shR", EMPTY_SH);
    this.mesh.material = this.material;
    this.syncSun();
  }

  syncSun() {
    const azimuth = this.azimuth * DEG;
    const elevation = this.elevation * DEG;
    const cosElevation = Math.cos(elevation);
    this.sunDirection.set(
      Math.sin(azimuth) * cosElevation,
      Math.sin(elevation),
      Math.cos(azimuth) * cosElevation,
    ).normalize();
    this.sunScale = this.intensity * SUN_SCALE_BASE;

    const zenithDegrees = Math.acos(Math.min(1, Math.max(-1, this.sunDirection.y))) / DEG;
    const denominator = Math.cos(zenithDegrees * DEG)
      + 0.50572 * Math.pow(Math.max(0.001, 96.07995 - zenithDegrees), -1.6364);
    const airMass = Math.min(denominator > 0 ? 1 / denominator : 40, 40);
    const tauRayleigh = [0.0464, 0.108, 0.265];
    const tauMie = 0.0252;
    const r = Math.exp(-(tauRayleigh[0] * this.warmth + tauMie) * airMass);
    const g = Math.exp(-(tauRayleigh[1] * this.warmth + tauMie) * airMass);
    const b = Math.exp(-(tauRayleigh[2] * this.warmth + tauMie) * airMass);
    this.sunRadiance.set(r * this.sunScale, g * this.sunScale, b * this.sunScale);
    const maximum = Math.max(r, g, b) || 1;
    this.sunColor.set(r / maximum, g / maximum, b / maximum);
    this.groundBounce.set(
      this.sunRadiance.r * this.sunDirection.y * 0.10,
      this.sunRadiance.g * this.sunDirection.y * 0.12,
      this.sunRadiance.b * this.sunDirection.y * 0.17,
    );
  }

  async solve() {
    this.syncSun();
    await waitUntilReady(this.lut, "Dark Snow atmosphere");
    this.bake();
    this.dirty = false;
  }

  bake() {
    this.lut.setVector3("sunDir", this.sunDirection);
    this.lut.setFloat("sunIntensity", this.sunScale);
    this.lut.setColor3("groundBounce", this.groundBounce);
    this.lut.render();
  }

  setIntensity(value) {
    if (Math.abs(value - this.intensity) < 1e-5) return;
    this.intensity = value;
    this.syncSun();
    this.dirty = true;
  }

  render(camera, time) {
    if (this.dirty && this.lut.isReady()) {
      this.bake();
      this.dirty = false;
    }
    const material = this.material;
    material.setVector3("cameraPosition", camera.position);
    material.setFloat("skyScale", camera.maxZ * 0.5);
    material.setVector3("sunDir", this.sunDirection);
    material.setColor3("sunColor", this.sunColor);
    material.setFloat("sunIntensity", this.sunScale);
    material.setFloat("time", time);
    material.setVector2("windDir", WIND);
    material.setFloat("cloudAmount", 0.30);
    material.setColor3("sunRadiance", this.sunRadiance);
    material.setFloat("ambientIntensity", 0);
    material.setFloat("ridgeAmp", 0);
    material.setFloat("fogDensity", 0);
    material.setFloat("fogHeightFalloff", 0.04);
    material.setFloat("fogStart", 0);
    material.setFloat("aerialStrength", 0);
  }

  dispose() {
    this.lut.dispose();
    this.mesh.dispose();
    this.material.dispose();
  }
}

export async function createAtmosphere(scene, options) {
  if (!scene.getEngine().isWebGPU) return createFallbackSky(scene, options);
  const atmosphere = new DarkSnowAtmosphere(scene, options);
  await atmosphere.solve();
  return atmosphere;
}
