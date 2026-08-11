import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";

const DEG = Math.PI / 180;

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(low, high, value) {
  const t = clamp01((value - low) / Math.max(1e-6, high - low));
  return t * t * (3 - 2 * t);
}

/**
 * A camera-centred sky painted from one physical sun direction. The broad
 * aureole is baked into the sky itself, so it cannot read as a flat billboard
 * floating in front of the terrain.
 */
export function createAtmosphere(scene, {
  azimuth = 118,
  elevation = 13,
  diameter = 18000,
} = {}) {
  const az = azimuth * DEG;
  const el = elevation * DEG;
  const cosElevation = Math.cos(el);
  const sunDirection = new Vector3(
    Math.sin(az) * cosElevation,
    Math.sin(el),
    Math.cos(az) * cosElevation,
  ).normalize();

  const width = 1024;
  const height = 512;
  const texture = new DynamicTexture("pale-sky-lut", { width, height }, scene, false);
  const context = texture.getContext();
  const image = context.createImageData(width, height);

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const theta = v * Math.PI;
    const dy = Math.cos(theta);
    const horizontal = Math.sin(theta);
    const above = smoothstep(-0.09, 0.55, dy);
    const zenith = smoothstep(0.02, 0.92, dy);
    const horizonBand = Math.exp(-Math.abs(dy) * 7.2);

    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const phi = (1 - u) * Math.PI * 2;
      const dx = Math.cos(phi) * horizontal;
      const dz = Math.sin(phi) * horizontal;
      const sunDot = dx * sunDirection.x + dy * sunDirection.y + dz * sunDirection.z;
      const aureole = Math.exp(-(1 - sunDot) * 34);
      const innerGlow = Math.exp(-(1 - sunDot) * 520);
      const disc = smoothstep(Math.cos(1.05 * DEG), Math.cos(0.42 * DEG), sunDot);

      // Layered horizon variation gives the air depth without placing opaque
      // cloud meshes across the view. It stays faint enough to avoid shimmer.
      const hazeNoise = (
        Math.sin(phi * 5.0 + Math.sin(phi * 2.0) * 1.7)
        + Math.sin(phi * 11.0 - 1.8) * 0.42
        + Math.sin(phi * 23.0 + 0.6) * 0.16
      ) * 0.5 + 0.5;
      const haze = horizonBand * smoothstep(-0.15, 0.45, dy) * hazeNoise;

      let r = 0.27 + above * 0.26 - zenith * 0.18;
      let g = 0.34 + above * 0.30 - zenith * 0.16;
      let b = 0.40 + above * 0.35 - zenith * 0.10;
      r += horizonBand * 0.22 + haze * 0.055;
      g += horizonBand * 0.18 + haze * 0.052;
      b += horizonBand * 0.12 + haze * 0.050;
      r += aureole * 0.50 + innerGlow * 0.58 + disc * 0.62;
      g += aureole * 0.36 + innerGlow * 0.48 + disc * 0.58;
      b += aureole * 0.20 + innerGlow * 0.30 + disc * 0.48;

      const offset = (y * width + x) * 4;
      image.data[offset] = Math.round(clamp01(r) * 255);
      image.data[offset + 1] = Math.round(clamp01(g) * 255);
      image.data[offset + 2] = Math.round(clamp01(b) * 255);
      image.data[offset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.update(false);

  const mesh = MeshBuilder.CreateSphere("physical-sky", {
    diameter,
    segments: 48,
    sideOrientation: Mesh.BACKSIDE,
  }, scene);
  mesh.infiniteDistance = true;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isPickable = false;
  mesh.renderingGroupId = 0;

  const material = new StandardMaterial("physical-sky-material", scene);
  material.disableLighting = true;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  material.fogEnabled = false;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.White();
  material.emissiveTexture = texture;
  mesh.material = material;

  return { mesh, material, texture, sunDirection };
}
