import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";

import {
  noise2, terrainHeight, terrainNormal, waterMaskAt, WATER_LEVEL,
} from "./terrainField.js";

// Four equal tiles form one continuous 14.3 km field. The earlier single mesh
// crossed 65,535 vertices; Safari's WebGPU path corrupted its 32-bit index
// buffer after the first recenter, producing the flooded ribbons seen from the
// air. Each tile now stays safely below that boundary while the combined grid
// is denser than the failed version.
const FIELD_SIZE = 14336;
const GRID_SEGMENTS = 320;
const TILE_SEGMENTS = GRID_SEGMENTS / 2;
const TILE_SIDE = TILE_SEGMENTS + 1;
const TILE_SIZE = FIELD_SIZE / 2;
const SPACING = FIELD_SIZE / GRID_SEGMENTS;
const SNAP = 1024;

const PALETTE = {
  shore: [0.42, 0.44, 0.38],
  field: [0.58, 0.62, 0.49],
  rock: [0.52, 0.49, 0.42],
  high: [0.72, 0.73, 0.65],
};

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const mix = (a, b, t) => a + (b - a) * t;
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function writeColor(colors, offset, x, z, height, normalY) {
  const altitude = smooth01((height - WATER_LEVEL) / 460);
  const steep = smooth01((0.90 - normalY) / 0.30);
  const high = smooth01((height - 260) / 420) * (1 - steep * 0.35);
  const shore = waterMaskAt(x, z) * (1 - smooth01((height - WATER_LEVEL) / 34));
  const variation = noise2(x * 0.00075 + 17.2, z * 0.00075 - 6.4) * 0.035;

  let r = mix(PALETTE.shore[0], PALETTE.field[0], altitude);
  let g = mix(PALETTE.shore[1], PALETTE.field[1], altitude);
  let b = mix(PALETTE.shore[2], PALETTE.field[2], altitude);
  r = mix(r, PALETTE.rock[0], steep);
  g = mix(g, PALETTE.rock[1], steep);
  b = mix(b, PALETTE.rock[2], steep);
  r = mix(r, PALETTE.high[0], high);
  g = mix(g, PALETTE.high[1], high);
  b = mix(b, PALETTE.high[2], high);
  r = mix(r, 0.25, shore * 0.28);
  g = mix(g, 0.29, shore * 0.28);
  b = mix(b, 0.26, shore * 0.28);

  colors[offset] = clamp01(r + variation);
  colors[offset + 1] = clamp01(g + variation * 0.8);
  colors[offset + 2] = clamp01(b + variation * 0.55);
  colors[offset + 3] = 1;
}

function buildTileIndices() {
  const indices = new Uint16Array(TILE_SEGMENTS * TILE_SEGMENTS * 6);
  let cursor = 0;
  for (let z = 0; z < TILE_SEGMENTS; z++) {
    for (let x = 0; x < TILE_SEGMENTS; x++) {
      const a = z * TILE_SIDE + x;
      const b = a + 1;
      const c = a + TILE_SIDE;
      const d = c + 1;
      // Babylon treats clockwise winding as the front face. The previous
      // counter-clockwise order exposed only the underside of steep triangles,
      // so distant mountains appeared as disconnected horizontal shards.
      indices[cursor++] = a;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = d;
      indices[cursor++] = c;
    }
  }
  return indices;
}

function makeTile(scene, material, tileX, tileZ, indices) {
  const vertexCount = TILE_SIDE * TILE_SIDE;
  const tile = {
    tileX,
    tileZ,
    positions: new Float32Array(vertexCount * 3),
    normals: new Float32Array(vertexCount * 3),
    colors: new Float32Array(vertexCount * 4),
    uvs: new Float32Array(vertexCount * 2),
    mesh: new Mesh(`terrain-tile-${tileX}-${tileZ}`, scene),
  };
  tile.mesh.material = material;
  tile.mesh.receiveShadows = true;
  tile.mesh.useVertexColors = true;
  tile.mesh.alwaysSelectAsActiveMesh = true;
  tile.mesh.isPickable = false;

  let vertex = 0;
  for (let z = 0; z < TILE_SIDE; z++) {
    for (let x = 0; x < TILE_SIDE; x++) {
      const p = vertex * 3;
      tile.positions[p] = x * SPACING - TILE_SIZE * 0.5;
      tile.positions[p + 2] = z * SPACING - TILE_SIZE * 0.5;
      vertex++;
    }
  }
  const data = new VertexData();
  data.positions = tile.positions;
  data.normals = tile.normals;
  data.colors = tile.colors;
  data.uvs = tile.uvs;
  data.indices = indices;
  data.applyToMesh(tile.mesh, true);
  return tile;
}

export class EndlessTerrain {
  constructor(scene) {
    this.scene = scene;
    this.centerX = Number.NaN;
    this.centerZ = Number.NaN;
    this.material = new StandardMaterial("pale-terrain-material", scene);
    this.material.diffuseColor = Color3.White();
    this.material.ambientColor = new Color3(0.38, 0.42, 0.36);
    this.material.emissiveColor = new Color3(0.065, 0.073, 0.061);
    this.material.specularColor = new Color3(0.10, 0.105, 0.085);
    this.material.specularPower = 24;
    this.material.backFaceCulling = true;
    this.material.maxSimultaneousLights = 2;

    const indices = buildTileIndices();
    this.tiles = [
      makeTile(scene, this.material, -1, -1, indices),
      makeTile(scene, this.material, 1, -1, indices),
      makeTile(scene, this.material, -1, 1, indices),
      makeTile(scene, this.material, 1, 1, indices),
    ];
    this.meshes = this.tiles.map((tile) => tile.mesh);
    this.vertexCount = this.tiles.length * TILE_SIDE * TILE_SIDE;
    this.update({ x: 0, z: -620 }, true);
  }

  update(position, force = false) {
    const nextX = Math.round(position.x / SNAP) * SNAP;
    const nextZ = Math.round(position.z / SNAP) * SNAP;
    if (!force && nextX === this.centerX && nextZ === this.centerZ) return false;
    this.centerX = nextX;
    this.centerZ = nextZ;

    for (const tile of this.tiles) {
      const offsetX = tile.tileX * TILE_SIZE * 0.5;
      const offsetZ = tile.tileZ * TILE_SIZE * 0.5;
      tile.mesh.position.set(nextX + offsetX, 0, nextZ + offsetZ);

      let vertex = 0;
      for (let z = 0; z < TILE_SIDE; z++) {
        const localZ = tile.positions[z * TILE_SIDE * 3 + 2];
        const worldZ = tile.mesh.position.z + localZ;
        for (let x = 0; x < TILE_SIDE; x++) {
          const p = vertex * 3;
          const worldX = tile.mesh.position.x + tile.positions[p];
          tile.positions[p + 1] = terrainHeight(worldX, worldZ);
          const uv = vertex * 2;
          tile.uvs[uv] = worldX / 220;
          tile.uvs[uv + 1] = worldZ / 220;
          vertex++;
        }
      }

      for (let z = 0; z < TILE_SIDE; z++) {
        for (let x = 0; x < TILE_SIDE; x++) {
          const index = z * TILE_SIDE + x;
          const p = index * 3;
          const worldX = tile.mesh.position.x + tile.positions[p];
          const worldZ = tile.mesh.position.z + tile.positions[p + 2];
          const leftY = x > 0
            ? tile.positions[(index - 1) * 3 + 1]
            : terrainHeight(worldX - SPACING, worldZ);
          const rightY = x < TILE_SEGMENTS
            ? tile.positions[(index + 1) * 3 + 1]
            : terrainHeight(worldX + SPACING, worldZ);
          const downY = z > 0
            ? tile.positions[(index - TILE_SIDE) * 3 + 1]
            : terrainHeight(worldX, worldZ - SPACING);
          const upY = z < TILE_SEGMENTS
            ? tile.positions[(index + TILE_SIDE) * 3 + 1]
            : terrainHeight(worldX, worldZ + SPACING);
          let nx = -(rightY - leftY) / (2 * SPACING);
          let ny = 1;
          let nz = -(upY - downY) / (2 * SPACING);
          const inverseLength = 1 / Math.max(1e-8, Math.hypot(nx, ny, nz));
          nx *= inverseLength;
          ny *= inverseLength;
          nz *= inverseLength;
          tile.normals[p] = nx;
          tile.normals[p + 1] = ny;
          tile.normals[p + 2] = nz;
          writeColor(tile.colors, index * 4, worldX, worldZ, tile.positions[p + 1], ny);
        }
      }

      tile.mesh.updateVerticesData(VertexBuffer.PositionKind, tile.positions, true, false);
      tile.mesh.updateVerticesData(VertexBuffer.NormalKind, tile.normals, false, false);
      tile.mesh.updateVerticesData(VertexBuffer.ColorKind, tile.colors, false, false);
      tile.mesh.updateVerticesData(VertexBuffer.UVKind, tile.uvs, false, false);
      tile.mesh.refreshBoundingInfo(true);
    }
    return true;
  }

  heightAt(x, z) {
    return terrainHeight(x, z);
  }

  normalAt(x, z, out, sampleRadius) {
    return terrainNormal(x, z, out, sampleRadius);
  }

  dispose() {
    for (const tile of this.tiles) tile.mesh.dispose(false, false);
    this.material.dispose();
  }
}

export { terrainHeight, terrainNormal } from "./terrainField.js";
