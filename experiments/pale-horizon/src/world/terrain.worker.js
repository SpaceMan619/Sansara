import { buildTerrainTiles, buildForest } from './terrainGeometry.js';

self.onmessage = ({ data: { x, z } }) => {
  const start = performance.now();
  const tiles = buildTerrainTiles(x, z);
  const forest = buildForest(x, z);
  const buffers = tiles.flatMap(tile => Object.values(tile).map(array => array.buffer));
  buffers.push(forest.buffer);
  self.postMessage({ x, z, tiles, forest, generationMs: performance.now() - start }, buffers);
};
