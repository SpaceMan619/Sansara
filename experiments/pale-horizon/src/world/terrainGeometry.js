import { noise2, terrainHeight, terrainNormal, WATER_LEVEL } from './terrainField.js';

export const FIELD_SIZE = 14336;
export const TILE_SEGMENTS = 128;
export const TILE_SIDE = TILE_SEGMENTS + 1;
export const TILE_SIZE = FIELD_SIZE / 2;
export const SPACING = TILE_SIZE / TILE_SEGMENTS;

const clamp = v => Math.max(0, Math.min(1, v));
const smooth = v => { const t = clamp(v); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
// Mineral blue shadows, ochre grass, slate ribs and cool snow. Colour is
// baked per vertex while streaming, never recalculated in the render loop.
const meadow = [0.23, 0.35, 0.27];
const heath = [0.39, 0.43, 0.29];
const rock = [0.30, 0.34, 0.36];
const snow = [0.85, 0.91, 0.94];

function colorAt(colors, index, x, z, height, ny) {
  const patch = smooth(noise2(x * 0.0011 + 17, z * 0.0011 - 6) + 0.45);
  const slope = smooth((0.94 - ny) / 0.27);
  const snowLine = 790 + noise2(x * 0.002 + 61, z * 0.002) * 95;
  const ice = smooth((height - snowLine) / 200) * smooth((ny - 0.54) / 0.32);
  const shore = 1 - smooth((height - WATER_LEVEL - 3) / 35);
  const variation = noise2(x * 0.008, z * 0.008) * 0.025;
  for (let c = 0; c < 3; c++) {
    let value = mix(meadow[c], heath[c], patch);
    value = mix(value, rock[c], slope);
    value = mix(value, [0.44, 0.45, 0.37][c], shore);
    colors[index + c] = clamp(mix(value, snow[c], ice) + variation);
  }
  colors[index + 3] = 1;
}

export function buildTerrainTiles(centerX, centerZ) {
  const tiles = [];
  for (const [tileX, tileZ] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
    const count = TILE_SIDE * TILE_SIDE;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4);
    const uvs = new Float32Array(count * 2);
    // A one-cell halo gives both sides of every tile seam identical normals.
    const haloSide = TILE_SIDE + 2;
    const heights = new Float32Array(haloSide * haloSide);
    const originX = centerX + (tileX - 1) * TILE_SIZE / 2;
    const originZ = centerZ + (tileZ - 1) * TILE_SIZE / 2;
    for (let z = -1; z <= TILE_SIDE; z++) {
      for (let x = -1; x <= TILE_SIDE; x++) {
        heights[(z + 1) * haloSide + x + 1] = terrainHeight(originX + x * SPACING, originZ + z * SPACING);
      }
    }
    for (let z = 0; z < TILE_SIDE; z++) {
      for (let x = 0; x < TILE_SIDE; x++) {
        const i = z * TILE_SIDE + x, h = (z + 1) * haloSide + x + 1;
        const wx = originX + x * SPACING, wz = originZ + z * SPACING;
        positions[i * 3] = x * SPACING - TILE_SIZE / 2;
        positions[i * 3 + 1] = heights[h];
        positions[i * 3 + 2] = z * SPACING - TILE_SIZE / 2;
        const nx = heights[h - 1] - heights[h + 1];
        const nz = heights[h - haloSide] - heights[h + haloSide];
        const inv = 1 / Math.hypot(nx, 2 * SPACING, nz);
        normals[i * 3] = nx * inv;
        normals[i * 3 + 1] = 2 * SPACING * inv;
        normals[i * 3 + 2] = nz * inv;
        colorAt(colors, i * 4, wx, wz, heights[h], normals[i * 3 + 1]);
        uvs[i * 2] = wx / 220;
        uvs[i * 2 + 1] = wz / 220;
      }
    }
    tiles.push({ positions, normals, colors, uvs });
  }
  // A coarse outer ring closes the horizon. Its inner edge uses the exact
  // same samples as the near tiles, so there are no LOD cracks. Redistributing
  // the existing vertex budget keeps the whole landscape below 104k vertices.
  const along = TILE_SEGMENTS * 2, rows = 32, half = FIELD_SIZE / 2, outer = 22000;
  const normal = { x: 0, y: 1, z: 0 };
  for (let side = 0; side < 4; side++) {
    const count = (along + 1) * (rows + 1);
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4), uvs = new Float32Array(count * 2);
    const indices = new Uint16Array(along * rows * 6);
    for (let row = 0; row <= rows; row++) {
      const radius = mix(half, outer, (row / rows) ** 1.6);
      for (let col = 0; col <= along; col++) {
        const edge = (col / along * 2 - 1) * radius;
        const x = side === 0 ? edge : side === 1 ? radius : side === 2 ? -edge : -radius;
        const z = side === 0 ? radius : side === 1 ? -edge : side === 2 ? -radius : edge;
        const i = row * (along + 1) + col, wx = centerX + x, wz = centerZ + z;
        let h = terrainHeight(wx, wz);
        // Filter the distant height field to the radial sample footprint;
        // otherwise narrow ridges alias into a repeated sawtooth skyline.
        const filter = row === 0 ? 0 : Math.min(750, (radius - half) / 10);
        if (filter > 0) h = (h * 4 + terrainHeight(wx-filter,wz) + terrainHeight(wx+filter,wz)
          + terrainHeight(wx,wz-filter) + terrainHeight(wx,wz+filter)) / 8;
        positions.set([x, h, z], i * 3);
        terrainNormal(wx, wz, normal, SPACING);
        normals.set([normal.x, normal.y, normal.z], i * 3);
        colorAt(colors, i * 4, wx, wz, h, normal.y);
        uvs.set([wx / 220, wz / 220], i * 2);
      }
    }
    let cursor = 0;
    for (let row = 0; row < rows; row++) for (let col = 0; col < along; col++) {
      const a = row * (along + 1) + col, b = a + 1, c = a + along + 1, d = c + 1;
      indices[cursor++] = a; indices[cursor++] = b; indices[cursor++] = c;
      indices[cursor++] = b; indices[cursor++] = d; indices[cursor++] = c;
    }
    tiles.push({ positions, normals, colors, uvs, indices });
  }
  return tiles;
}

export function buildForest(x, z) {
  const matrices = [];
  const cx = Math.floor(x / 100), cz = Math.floor(z / 100);
  const normal = {x:0,y:1,z:0};
  for(let dz=-28;dz<=28;dz++)for(let dx=-28;dx<=28;dx++) {
    if(matrices.length >= 700 * 16) break;
    const gx=cx+dx,gz=cz+dz;
    const wx=gx*100+noise2(gx*4.1,gz*3.8)*35;
    const wz=gz*100+noise2(gx*2.7+9,gz*5.2)*35;
    if(Math.abs(wx)<180 && Math.abs(wz-180)<1300)continue;
    if(noise2(wx*.0013+17,wz*.0013)<0.12)continue;
    const h=terrainHeight(wx,wz);
    if(h<WATER_LEVEL+15 || h>540 || terrainNormal(wx,wz,normal,20).y<0.88)continue;
    const size=0.7+(noise2(gx+53,gz+17)+1)*0.35;
    matrices.push(size,0,0,0, 0,size,0,0, 0,0,size,0, wx,h-1,wz,1);
  }
  return new Float32Array(matrices);
}
