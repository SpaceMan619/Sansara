import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';

export function createForest(scene) {
  const mesh = MeshBuilder.CreateCylinder('valley-conifers', { height: 24, diameterTop: 0, diameterBottom: 10, tessellation: 5 }, scene);
  mesh.bakeTransformIntoVertices(Matrix.Translation(0, 12, 0));
  const material = new StandardMaterial('valley-conifers', scene);
  material.diffuseColor = new Color3(0.09, 0.19, 0.14);
  material.specularColor = Color3.Black();
  material.maxSimultaneousLights = 2;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return {
    update(matrices) {
      if (!matrices.length) { mesh.setEnabled(false); return; }
      mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
      mesh.setEnabled(true);
      mesh.thinInstanceRefreshBoundingInfo();
    },
    dispose() { mesh.dispose(); material.dispose(); },
  };
}
