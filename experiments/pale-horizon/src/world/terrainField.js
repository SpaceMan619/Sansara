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
export const WATER_LEVEL = -42;

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

const WATER_CELL_SIZE = 9000;
const RIVER_WATER_RADIUS = 245;
const RIVER_VALLEY_RADIUS = 1450;
const lakeCache = new Map();

export function riverCenterXAt(z) {
  // Keep the opening runway in a dry mountain basin. The river becomes visible
  // after takeoff rather than reading as an exposed plane beneath the runway.
  return -2600
    + Math.sin(z * 0.00039 + 0.7) * 520
    + Math.sin(z * 0.00107 - 1.4) * 105;
}

function lakeBasinAt(gx, gz) {
  const key = `${gx}:${gz}`;
  if (lakeCache.has(key)) return lakeCache.get(key);
  if (lakeCache.size > 256) lakeCache.clear();
  const seed = hash2(gx, gz);
  // Sparse enough that a flight reads distinct lakes rather than flooded
  // noise. The old 75% placement rate was the main visual failure.
  if ((seed & 7) > 2) { lakeCache.set(key, null); return null; }
  const cx = (gx + 0.22 + ((seed >>> 4) & 1023) / 1820) * WATER_CELL_SIZE;
  const cz = (gz + 0.22 + ((seed >>> 14) & 1023) / 1820) * WATER_CELL_SIZE;
  // Keep the authored runway basin dry and readable on first load.
  if (Math.abs(cx) < 1700 && Math.abs(cz - RUNWAY_CENTER_Z) < 2800) return null;
  const basin = {
    id: `${gx}:${gz}`,
    cx,
    cz,
    radiusX: 1050 + ((seed >>> 8) & 255) * 3.2,
    radiusZ: 850 + ((seed >>> 20) & 255) * 3.4,
  };
  lakeCache.set(key, basin);
  return basin;
}

function forNearbyLakes(x, z, visitor) {
  const cellX = Math.floor(x / WATER_CELL_SIZE);
  const cellZ = Math.floor(z / WATER_CELL_SIZE);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const basin = lakeBasinAt(cellX + dx, cellZ + dz);
      if (!basin) continue;
      const distance = Math.hypot(
        (x - basin.cx) / basin.radiusX,
        (z - basin.cz) / basin.radiusZ,
      );
      visitor(distance, basin);
    }
  }
}

/** Lake descriptors inside a square search radius, for matching water meshes. */
export function lakeBasinsNear(x, z, radius = 9000) {
  const minX = Math.floor((x - radius) / WATER_CELL_SIZE) - 1;
  const maxX = Math.floor((x + radius) / WATER_CELL_SIZE) + 1;
  const minZ = Math.floor((z - radius) / WATER_CELL_SIZE) - 1;
  const maxZ = Math.floor((z + radius) / WATER_CELL_SIZE) + 1;
  const basins = [];
  for (let gz = minZ; gz <= maxZ; gz++) {
    for (let gx = minX; gx <= maxX; gx++) {
      const basin = lakeBasinAt(gx, gz);
      if (!basin) continue;
      const reachX = basin.radiusX * 0.24;
      const reachZ = basin.radiusZ * 0.24;
      if (Math.abs(basin.cx - x) > radius + reachX) continue;
      if (Math.abs(basin.cz - z) > radius + reachZ) continue;
      basins.push(basin);
    }
  }
  return basins;
}

/** Water coverage only; terrain shaping happens separately below. */
export function waterMaskAt(x, z) {
  const riverDistance = Math.abs(x - riverCenterXAt(z));
  let mask = 1 - smooth01((riverDistance - RIVER_WATER_RADIUS + 45) / 90);
  forNearbyLakes(x, z, (distance) => {
    mask = Math.max(mask, 1 - smooth01((distance - 0.18) / 0.09));
  });
  return clamp01(mask);
}

function carveWaterBodies(rawHeight, x, z) {
  let height = rawHeight;

  // A wide quadratic valley limits the river bank to a plausible grade. It
  // can cross high country without slicing a vertical curtain through it.
  const riverDistance = Math.abs(x - riverCenterXAt(z));
  if (riverDistance < RIVER_VALLEY_RADIUS) {
    const t = riverDistance / RIVER_VALLEY_RADIUS;
    const riverProfile = WATER_LEVEL - 10 + t * t * 350;
    const carved = Math.min(height, riverProfile);
    const bankBlend = 1 - smooth01((t - 0.72) / 0.28);
    height = lerp(height, carved, bankBlend);
  }

  // Lakes use the same rule: a small submerged centre inside a much broader
  // bowl. At the outer edge the profile has already climbed over 200 metres,
  // so it meets mountain terrain without needles, overhangs or hanging strips.
  forNearbyLakes(x, z, (distance) => {
    if (distance >= 2.2) return;
    const lakeProfile = WATER_LEVEL - 9 + distance * distance * 180;
    const carved = Math.min(height, lakeProfile);
    const bankBlend = 1 - smooth01((distance - 1.35) / 0.85);
    height = lerp(height, carved, bankBlend);
  });
  return height;
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

  const continental = fbm(wx * 0.000095 + 7.1, wz * 0.000095 - 19.3, 4, 0.52) * 135;
  // Mountain silhouettes must come from low frequencies only. Feeding five
  // octaves into a 620 m displacement let a 45 m grid step jump by almost
  // 400 m, which produced the needles visible in flight.
  const ridgeSignal = 1 - Math.abs(fbm(
    wx * 0.00015 - 41.8, wz * 0.00015 + 8.6, 2, 0.48, 1.85,
  ));
  const ridgeMask = smooth01(
    fbm(wx * 0.000060 + 72.4, wz * 0.000060 - 63.1, 2, 0.50, 1.88) * 0.9 + 0.43,
  );
  const mountains = Math.pow(clamp01((ridgeSignal - 0.22) / 0.78), 1.75)
    * 390 * ridgeMask;

  const rolling = fbm(wx * 0.00062 + 16.3, wz * 0.00062 + 44.9, 3, 0.50) * 54;
  const drainage = Math.pow(
    Math.abs(fbm(wx * 0.00036 - 23.4, wz * 0.00036 + 91.7, 3)), 1.7,
  ) * -42;
  const outcrop = Math.pow(
    clamp01((Math.abs(noise2(wx * 0.0012, wz * 0.0012)) - 0.38) / 0.62), 2,
  ) * 20;
  const detail = fbm(x * 0.0032 + 3.2, z * 0.0032 - 8.7, 2, 0.44) * 5.0;

  // Two long, asymmetric ranges give the flight a readable valley and a
  // destination skyline. Their broad bases remain smooth at the 44.8 m mesh
  // spacing; fine noise never drives the large mountain displacement.
  const valleyAxis = Math.sin(z * 0.00022) * 420;
  const eastDistance = (x - valleyAxis - 2250) / 1350;
  const westDistance = (x - valleyAxis + 4200) / 1750;
  const eastCrest = 900 + 430 * noise2(z * 0.00048 + 12, 6.7)
    + 210 * noise2(z * 0.0011 - 8, 19.2);
  const westCrest = 1120 + 380 * noise2(z * 0.00039 - 4, 31.8);
  const ranges = Math.exp(-eastDistance * eastDistance) * eastCrest
    + Math.exp(-westDistance * westDistance) * westCrest;
  const rockRibs = Math.abs(noise2(x * 0.0013 + z * 0.00045, z * 0.0009))
    * Math.min(100, ranges * 0.12);
  // The valley floor approaches runway elevation gradually, not via a cliff
  // at the asphalt edge. This keeps the opening takeoff corridor clear.
  const basin = smooth01(Math.abs(x - valleyAxis) / 1400);
  const headwall = Math.exp(-(((z - 7500) / 1800) ** 2) - ((x + 800) / 3200) ** 2)
    * (1050 + noise2(x * 0.0008 + 4, z * 0.0006) * 260);
  let raw = (continental + mountains + rolling + drainage + ranges - rockRibs + outcrop + detail)
    * basin + headwall + 2;
  // Natural noise stays above the water plane. Purpose-built bowls then lower
  // only the river and lake centres, with several hundred metres of bank run.
  raw = carveWaterBodies(Math.max(raw, WATER_LEVEL + 12), x, z);
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
