import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

ShaderStore.ShadersStore.paleFallbackVertexShader = `
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
uniform float skyScale;
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 clip = viewProjection * vec4(position * skyScale + cameraPosition, 1.0);
  clip.z = clip.w * 0.999999;
  gl_Position = clip;
}`;
ShaderStore.ShadersStore.paleFallbackFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform vec3 sunDir;
uniform float sunIntensity;
void main() {
  vec3 dir = normalize(vDir);
  float height = pow(max(dir.y, 0.0), 0.45);
  vec3 color = mix(vec3(0.50, 0.60, 0.66), vec3(0.10, 0.24, 0.38), height);
  float mu = max(dot(dir, sunDir), 0.0);
  color += vec3(1.0, 0.76, 0.48) * (pow(mu, 64.0) * 0.17 + smoothstep(0.999982, 0.99999, mu) * 18.0) * sunIntensity;
  gl_FragColor = vec4(color, 1.0);
}`;

// The scattering LUT is WGSL-only. WebGL gets a small analytic sky instead
// of attempting to compile a shader language it cannot execute.
export function createFallbackSky(scene, { azimuth = 310, elevation = 14, intensity = 0.5 } = {}) {
  const az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180;
  const sunDirection = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const sunColor = new Color3(1, 0.86, 0.70);
  const material = new ShaderMaterial('pale-webgl-sky', scene, { vertex: 'paleFallback', fragment: 'paleFallback' }, {
    attributes: ['position'], uniforms: ['viewProjection', 'cameraPosition', 'skyScale', 'sunDir', 'sunIntensity'],
  });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.setVector3('sunDir', sunDirection);
  material.setFloat('sunIntensity', intensity);
  const mesh = MeshBuilder.CreateBox('pale-webgl-sky', { size: 2 }, scene);
  mesh.material = material;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isPickable = false;
  return {
    sunDirection, sunColor,
    setIntensity(value) { material.setFloat('sunIntensity', value); },
    render(camera) { material.setVector3('cameraPosition', camera.position); material.setFloat('skyScale', camera.maxZ * 0.5); },
    dispose() { mesh.dispose(); material.dispose(); },
  };
}
