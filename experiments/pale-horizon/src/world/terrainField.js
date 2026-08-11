/*
 * Pale Horizon's terrain contract.
 *
 * Rendering and flight collision both sample these functions. Keeping one
 * deterministic field avoids the familiar "aircraft floating above the mesh"
 * failure caused by drawing one height function and colliding against another.
 * The field has no Babylon dependency, which also makes it cheap to test from
 * Node and safe to use from physics code.
 */

const RUNWAY_CENTER_Z = 180;
const RUNWAY_HALF_WIDTH = 36;
const RUNWAY_HALF_LENGTH = 960;
const RUNWAY_SHOULDER_X = 112;
const RUNWAY_SHOULDER_Z = 260;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth01 = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

function hash2(x, z) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

const GRADIENTS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.70710678, 0.70710678], [-0.70710678, 0.70710678],
  [0.70710678, -0.70710678], [-0.70710678, -0.70710678],
];

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Seeded gradient noise in approximately [-1, 1]. */
export function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);

  const dot = (gx, gz, dx, dz) => {
    const g = GRADIENTS[hash2(gx, gz) & 7];
    return g[0] * dx + g[1] * dz;
  };
  const a = dot(ix, iz, fx, fz);
  const b = dot(ix + 1, iz, fx - 1, fz);
  const c = dot(ix, iz + 1, fx, fz - 1);
  const d = dot(ix + 1, iz + 1, fx - 1, fz - 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 1.42;
}

function fbm(x, z, octaves, gain = 0.5, lacunarity = 2.03) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let i = 0; i < octaves; i++) {
    total += noise2(x * frequency, z * frequency) * amplitude;
    weight += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return total / weight;
}

/**
 * 0 on the runway, 1 on untouched terrain. The wide smooth shoulder prevents
 * a hard trench where the runway meets the procedural field.
 */
export function runwayTerrainBlend(x, z) {
  const across = (Math.abs(x) - RUNWAY_HALF_WIDTH) / RUNWAY_SHOULDER_X;
  const along = (Math.abs(z - RUNWAY_CENTER_Z) - RUNWAY_HALF_LENGTH) / RUNWAY_SHOULDER_Z;
  return smooth01(Math.max(across, along));
}

export function isRunwaySurface(x, z, margin = 3) {
  return Math.abs(x) <= RUNWAY_HALF_WIDTH + margin
    && Math.abs(z - RUNWAY_CENTER_Z) <= RUNWAY_HALF_LENGTH + margin;
}

/**
 * Effectively unbounded procedural height in metres.
 *
 * Large warped ridges define the skyline. Lower-frequency shelves and drainage
 * cuts keep the world from reading as a repeated noise carpet, while two small
 * detail bands stop low flight from exposing the coarse shapes.
 */
export function terrainHeight(x, z) {
  const warpX = fbm(x * 0.00019 + 31.7, z * 0.00019 - 12.4, 3) * 1080;
  const warpZ = fbm(x * 0.00017 - 54.2, z * 0.00017 + 26.9, 3) * 920;
  const wx = x + warpX;
  const wz = z + warpZ;

  const continental = fbm(wx * 0.000105 + 7.1, wz * 0.000105 - 19.3, 5, 0.54) * 150;
  const ridgeSignal = 1 - Math.abs(fbm(wx * 0.00031 - 41.8, wz * 0.00031 + 8.6, 5, 0.54));
  const ridgeMask = smooth01(fbm(wx * 0.000075 + 72.4, wz * 0.000075 - 63.1, 4) * 0.9 + 0.43);
  const mountains = Math.pow(clamp01((ridgeSignal - 0.27) / 0.73), 2.35) * 620 * ridgeMask;

  const rolling = fbm(wx * 0.00082 + 16.3, wz * 0.00082 + 44.9, 5, 0.52) * 64;
  const drainage = Math.pow(Math.abs(fbm(wx * 0.00046 - 23.4, wz * 0.00046 + 91.7, 4)), 1.7) * -58;
  const outcrop = Math.pow(clamp01((Math.abs(noise2(wx * 0.0017, wz * 0.0017)) - 0.34) / 0.66), 2) * 34;
  const detail = fbm(x * 0.0041 + 3.2, z * 0.0041 - 8.7, 3, 0.46) * 7.5;

  const raw = continental + mountains + rolling + drainage + outcrop + detail - 24;
  const runwayBlend = runwayTerrainBlend(x, z);
  return raw * runwayBlend;
}

/**
 * Unit surface normal matching terrainHeight(). `sampleRadius` is expressed in
 * metres. Flight collision uses the default; callers can widen it when they
 * need a normal averaged across a larger footprint.
 */
export function terrainNormal(x, z, out = { x: 0, y: 1, z: 0 }, sampleRadius = 2.5) {
  const e = Math.max(0.25, sampleRadius);
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  let nx = -dx;
  let ny = 2 * e;
  let nz = -dz;
  const invLength = 1 / Math.max(1e-8, Math.hypot(nx, ny, nz));
  nx *= invLength;
  ny *= invLength;
  nz *= invLength;
  out.x = nx;
  out.y = ny;
  out.z = nz;
  return out;
}

export const RUNWAY = Object.freeze({
  centerZ: RUNWAY_CENTER_Z,
  halfWidth: RUNWAY_HALF_WIDTH,
  halfLength: RUNWAY_HALF_LENGTH,
});
