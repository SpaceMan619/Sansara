import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { terrainHeight, terrainNormal } from './terrainField.js';
import { createSurfaceTexture } from './surfaceTextures.js';
import { buildTerrainTiles, buildForest, TILE_SEGMENTS, TILE_SIDE, TILE_SIZE } from './terrainGeometry.js';
import { createForest } from './forest.js';

const SNAP = 1024;
const COORDS = [[-1,-1],[1,-1],[-1,1],[1,1],[0,0],[0,0],[0,0],[0,0]];

function buildTileIndices() {
  // Stay below Safari WebGPU's 16-bit vertex boundary.
  const indices = new Uint16Array(TILE_SEGMENTS * TILE_SEGMENTS * 6);
  let cursor = 0;
  for (let z = 0; z < TILE_SEGMENTS; z++) {
    for (let x = 0; x < TILE_SEGMENTS; x++) {
      const a = z * TILE_SIDE + x, b = a + 1, c = a + TILE_SIDE, d = c + 1;
      indices[cursor++] = a; indices[cursor++] = b; indices[cursor++] = c;
      indices[cursor++] = b; indices[cursor++] = d; indices[cursor++] = c;
    }
  }
  return indices;
}

export class EndlessTerrain {
  constructor(scene) {
    this.centerX = NaN;
    this.centerZ = NaN;
    this.targetX = 0;
    this.targetZ = -1024;
    this.busy = false;
    this.disposed = false;
    this.generationMs = 0;
    this.uploadMs = 0;
    this.material = new StandardMaterial('pale-terrain-material', scene);
    this.material.diffuseColor = Color3.White();
    this.material.diffuseTexture = createSurfaceTexture(scene);
    this.material.ambientColor = new Color3(0.20, 0.24, 0.28);
    this.material.emissiveColor = new Color3(0.018, 0.023, 0.030);
    this.material.specularColor = new Color3(0.018, 0.018, 0.018);
    this.material.specularPower = 48;
    this.material.maxSimultaneousLights = 2;
    this.indices = buildTileIndices();
    this.forest = createForest(scene);
    this.tiles = COORDS.map(([tileX, tileZ], i) => {
      const mesh = new Mesh('terrain-tile-' + i, scene);
      mesh.material = this.material;
      mesh.receiveShadows = true;
      mesh.useVertexColors = true;
      mesh.isPickable = false;
      return { mesh, tileX, tileZ };
    });
    this.meshes = this.tiles.map(tile => tile.mesh);
    this.vertexCount = 4 * TILE_SIDE * TILE_SIDE + 4 * (TILE_SEGMENTS * 2 + 1) * 33;
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
    // Generate away from the flight loop; swap complete tile sets atomically.
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (this.disposed) return;
        this.busy = false;
        this.generationMs = data.generationMs;
        this.applyTiles(data.x, data.z, data.tiles);
        this.forest.update(data.forest || new Float32Array());
        this.requestTiles();
      };
      this.worker.onerror = error => {
        console.warn('[Pale Horizon] terrain worker unavailable; using synchronous fallback.', error.message);
        this.worker.terminate();
        this.worker = null;
        this.busy = false;
        this.requestTiles();
      };
    }
    this.requestTiles();
  }

  requestTiles() {
    if (this.disposed || this.busy || (this.centerX === this.targetX && this.centerZ === this.targetZ)) return;
    if (this.worker) {
      this.busy = true;
      this.worker.postMessage({ x: this.targetX, z: this.targetZ });
    } else {
      const start = performance.now();
      const tiles = buildTerrainTiles(this.targetX, this.targetZ);
      this.generationMs = performance.now() - start;
      this.applyTiles(this.targetX, this.targetZ, tiles);
      this.forest.update(buildForest(this.targetX, this.targetZ));
    }
  }

  applyTiles(x, z, data) {
    const start = performance.now();
    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i], next = data[i];
      if (!tile.positions) {
        const vertices = new VertexData();
        Object.assign(vertices, next, { indices: next.indices || this.indices });
        vertices.applyToMesh(tile.mesh, true);
      } else {
        tile.mesh.updateVerticesData(VertexBuffer.PositionKind, next.positions, true, false);
        tile.mesh.updateVerticesData(VertexBuffer.NormalKind, next.normals, false, false);
        tile.mesh.updateVerticesData(VertexBuffer.ColorKind, next.colors, false, false);
        tile.mesh.updateVerticesData(VertexBuffer.UVKind, next.uvs, false, false);
      }
      Object.assign(tile, next);
      tile.mesh.position.set(x + tile.tileX * TILE_SIZE / 2, 0, z + tile.tileZ * TILE_SIZE / 2);
      tile.mesh.refreshBoundingInfo(true);
    }
    this.centerX = x; this.centerZ = z;
    this.uploadMs = performance.now() - start;
    this.resolveReady();
  }

  update(position) {
    const x = Math.round(position.x / SNAP) * SNAP;
    const z = Math.round(position.z / SNAP) * SNAP;
    if (x === this.targetX && z === this.targetZ) return false;
    this.targetX = x; this.targetZ = z;
    this.requestTiles();
    return true;
  }

  heightAt(x, z) { return terrainHeight(x, z); }
  normalAt(x, z, out, sampleRadius) { return terrainNormal(x, z, out, sampleRadius); }
  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    this.forest.dispose();
    for (const tile of this.tiles) tile.mesh.dispose(false, false);
    this.material.dispose(false, true);
  }
}

export { terrainHeight, terrainNormal } from './terrainField.js';
