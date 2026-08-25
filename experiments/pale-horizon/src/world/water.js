import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";

import {
  lakeBasinsNear,
  riverCenterXAt,
  WATER_LEVEL,
} from "./terrainField.js";

const RIVER_HALF_WIDTH = 243;
const RIVER_SPAN = 18432;
const RIVER_SEGMENTS = 256;
const RIVER_SNAP = 3072;
const LAKE_WATER_SCALE = Math.sqrt(9 / 180) * 0.985;
const LAKE_SEGMENTS = 64;
const LAKE_SEARCH_RADIUS = 9800;
const MAX_LAKES = 12;

function makeMaterial(scene) {
  const material = new StandardMaterial("pale-local-water-material", scene);
  material.diffuseColor = new Color3(0.055, 0.19, 0.25);
  material.ambientColor = new Color3(0.08, 0.20, 0.25);
  material.specularColor = new Color3(0.58, 0.62, 0.58);
  material.emissiveColor = new Color3(0.008, 0.023, 0.029);
  material.specularPower = 112;
  material.alpha = 0.91;
  material.backFaceCulling = true;
  material.needDepthPrePass = true;
  return material;
}

function makeRiver(scene, material) {
  const side = RIVER_SEGMENTS + 1;
  const positions = new Float32Array(side * 2 * 3);
  const normals = new Float32Array(side * 2 * 3);
  const uvs = new Float32Array(side * 2 * 2);
  const indices = new Uint16Array(RIVER_SEGMENTS * 6);

  for (let i = 0; i < side * 2; i++) normals[i * 3 + 1] = 1;
  for (let i = 0; i < side; i++) {
    const v = i / RIVER_SEGMENTS;
    uvs[i * 4] = 0;
    uvs[i * 4 + 1] = v * 24;
    uvs[i * 4 + 2] = 1;
    uvs[i * 4 + 3] = v * 24;
  }
  let cursor = 0;
  for (let i = 0; i < RIVER_SEGMENTS; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices[cursor++] = a;
    indices[cursor++] = b;
    indices[cursor++] = c;
    indices[cursor++] = b;
    indices[cursor++] = d;
    indices[cursor++] = c;
  }

  const mesh = new Mesh("river-water", scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh, true);
  mesh.material = material;
  mesh.position.y = WATER_LEVEL + 0.06;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  return { mesh, positions };
}

function makeLake(scene, material, index) {
  const positions = new Float32Array((LAKE_SEGMENTS + 1) * 3);
  const normals = new Float32Array((LAKE_SEGMENTS + 1) * 3);
  const uvs = new Float32Array((LAKE_SEGMENTS + 1) * 2);
  const indices = new Uint16Array(LAKE_SEGMENTS * 3);
  normals[1] = 1;
  uvs[0] = 0.5;
  uvs[1] = 0.5;
  for (let i = 0; i < LAKE_SEGMENTS; i++) {
    const angle = (i / LAKE_SEGMENTS) * Math.PI * 2;
    const vertex = i + 1;
    positions[vertex * 3] = Math.cos(angle);
    positions[vertex * 3 + 2] = Math.sin(angle);
    normals[vertex * 3 + 1] = 1;
    uvs[vertex * 2] = Math.cos(angle) * 0.5 + 0.5;
    uvs[vertex * 2 + 1] = Math.sin(angle) * 0.5 + 0.5;
    indices[i * 3] = 0;
    indices[i * 3 + 1] = vertex;
    indices[i * 3 + 2] = ((i + 1) % LAKE_SEGMENTS) + 1;
  }

  const mesh = new Mesh(`lake-water-${index}`, scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.position.y = WATER_LEVEL + 0.06;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.setEnabled(false);
  return mesh;
}

/**
 * Water exists only where terrainField carves a river or lake below sea level.
 * A world-sized plane made every terrain gap look like a flooded rendering bug.
 */
export class EndlessWater {
  constructor(scene) {
    this.material = makeMaterial(scene);
    this.river = makeRiver(scene, this.material);
    this.lakes = Array.from(
      { length: MAX_LAKES },
      (_, index) => makeLake(scene, this.material, index),
    );
    this.centerZ = Number.NaN;
    this.lakeCenterX = Number.NaN;
    this.lakeCenterZ = Number.NaN;
    this.update({ x: 0, z: -620 }, 0, true);
  }

  update(position, elapsedSeconds = 0, force = false) {
    const nextZ = Math.round(position.z / RIVER_SNAP) * RIVER_SNAP;
    if (force || nextZ !== this.centerZ) {
      this.centerZ = nextZ;
      this.river.mesh.position.z = nextZ;
      for (let i = 0; i <= RIVER_SEGMENTS; i++) {
        const localZ = (i / RIVER_SEGMENTS - 0.5) * RIVER_SPAN;
        const worldZ = nextZ + localZ;
        const centerX = riverCenterXAt(worldZ);
        const p = i * 6;
        this.river.positions[p] = centerX - RIVER_HALF_WIDTH;
        this.river.positions[p + 1] = 0;
        this.river.positions[p + 2] = localZ;
        this.river.positions[p + 3] = centerX + RIVER_HALF_WIDTH;
        this.river.positions[p + 4] = 0;
        this.river.positions[p + 5] = localZ;
      }
      this.river.mesh.updateVerticesData(
        VertexBuffer.PositionKind,
        this.river.positions,
        true,
        false,
      );
      this.river.mesh.refreshBoundingInfo(true);
    }

    const lakeX = Math.round(position.x / RIVER_SNAP) * RIVER_SNAP;
    const lakeZ = Math.round(position.z / RIVER_SNAP) * RIVER_SNAP;
    if (force || lakeX !== this.lakeCenterX || lakeZ !== this.lakeCenterZ) {
      this.lakeCenterX = lakeX;
      this.lakeCenterZ = lakeZ;
      const basins = lakeBasinsNear(position.x, position.z, LAKE_SEARCH_RADIUS)
        .sort((a, b) => {
          const da = (a.cx - position.x) ** 2 + (a.cz - position.z) ** 2;
          const db = (b.cx - position.x) ** 2 + (b.cz - position.z) ** 2;
          return da - db;
        });
      for (let i = 0; i < this.lakes.length; i++) {
        const mesh = this.lakes[i];
        const basin = basins[i];
        if (!basin) {
          mesh.setEnabled(false);
          continue;
        }
        mesh.position.x = basin.cx;
        mesh.position.z = basin.cz;
        mesh.scaling.x = basin.radiusX * LAKE_WATER_SCALE;
        mesh.scaling.z = basin.radiusZ * LAKE_WATER_SCALE;
        mesh.setEnabled(true);
      }
    }

    // Reserved for subtle UV motion once the water material has a normal map.
    void elapsedSeconds;
  }

  dispose() {
    this.river.mesh.dispose(false, false);
    for (const lake of this.lakes) lake.dispose(false, false);
    this.material.dispose();
  }
}
