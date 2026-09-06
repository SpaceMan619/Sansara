import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';

// Small periodic textures, generated once. No image downloads or render targets.
export function createSurfaceTexture(scene, normal = false) {
  const size = 128, bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
      const i = (y * size + x) * 4;
      bytes[i + 3] = 255;
      if (normal) {
        const nx = Math.cos(u * 5 + Math.sin(v * 3)) * 0.04 + Math.cos(u * 11 + v * 7) * 0.018;
        const ny = Math.cos(v * 7 + Math.sin(u * 2)) * 0.03;
        bytes[i] = (nx * 0.5 + 0.5) * 255;
        bytes[i + 1] = (ny * 0.5 + 0.5) * 255;
        bytes[i + 2] = Math.sqrt(1 - nx * nx - ny * ny) * 255;
      } else {
        let hash = Math.imul(x + y * size + 1, 0x45d9f3b);
        hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
        const value = 237 + ((hash ^ (hash >>> 16)) & 255) * 0.07;
        bytes[i] = bytes[i + 1] = bytes[i + 2] = value;
      }
    }
  }
  const texture = RawTexture.CreateRGBATexture(bytes, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 4;
  texture.gammaSpace = !normal;
  return texture;
}
