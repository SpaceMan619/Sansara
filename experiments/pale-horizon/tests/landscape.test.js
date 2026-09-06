import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FlightController } from '../src/flight/flightController.js';
import { terrainHeight, terrainNormal, riverCenterXAt, WATER_LEVEL, isRunwaySurface } from '../src/world/terrainField.js';
import { buildTerrainTiles, buildForest, TILE_SIDE, TILE_SIZE, TILE_SEGMENTS } from '../src/world/terrainGeometry.js';
import { EndlessTerrain } from '../src/world/endlessTerrain.js';

const tiles = buildTerrainTiles(0, 0);
test('landscape remains within the original vertex and triangle budgets', () => {
  const vertices = tiles.reduce((sum, t) => sum + t.positions.length / 3, 0);
  const triangles = TILE_SEGMENTS ** 2 * 8 + tiles.slice(4).reduce((sum,t)=>sum+t.indices.length/3,0);
  assert.ok(vertices <= 103684, String(vertices));
  assert.ok(triangles <= 204800, String(triangles));
  for (const tile of tiles) assert.ok(tile.positions.length / 3 < 65536);
});
test('all streamed geometry and material attributes are finite', () => {
  for (const tile of tiles) for (const array of Object.values(tile)) {
    for (const value of array) assert.ok(Number.isFinite(value));
  }
});
test('mesh heights match the collision field at sampled vertices', () => {
  for (let i=0;i<4;i++) {
    const [tx,tz] = [[-1,-1],[1,-1],[-1,1],[1,1]][i], p=tiles[i].positions;
    for(let v=0;v<p.length/3;v+=137) {
      const expected=terrainHeight(p[v*3]+tx*TILE_SIZE/2,p[v*3+2]+tz*TILE_SIZE/2);
      assert.ok(Math.abs(expected-p[v*3+1])<0.01);
    }
  }
});
test('near tile seams have identical heights and normals', () => {
  for (const [a,b] of [[0,1],[2,3]]) for(let row=0;row<TILE_SIDE;row++) {
    const left=(row*TILE_SIDE+TILE_SEGMENTS)*3,right=row*TILE_SIDE*3;
    assert.equal(tiles[a].positions[left+1],tiles[b].positions[right+1]);
    for(let c=0;c<3;c++)assert.equal(tiles[a].normals[left+c],tiles[b].normals[right+c]);
  }
});
test('far ring shares the near field boundary, with valid 16-bit indices', () => {
  const ring=tiles[4], side=TILE_SEGMENTS*2;
  for(let col=0;col<=side;col++) {
    const tile=col<=TILE_SEGMENTS?tiles[2]:tiles[3];
    const local=col<=TILE_SEGMENTS?col:col-TILE_SEGMENTS;
    assert.ok(Math.abs(ring.positions[col*3+1]-tile.positions[(TILE_SEGMENTS*TILE_SIDE+local)*3+1])<0.001);
  }
  for(const tile of tiles.slice(4))for(const index of tile.indices)assert.ok(index<tile.positions.length/3);
});
test('runway remains flat, dry and smooth enough for departure', () => {
  for(let z=-780;z<=1140;z+=40)for(const x of [-36,0,36])assert.equal(terrainHeight(x,z),0);
  for(let z=1140;z<=2300;z+=20)assert.ok(terrainHeight(0,z)<30);
});
test('river centres remain below their visible water surface', () => {
  for(let z=-20000;z<=20000;z+=500)assert.ok(terrainHeight(riverCenterXAt(z),z)<WATER_LEVEL);
});
test('terrain normals are finite unit vectors at runway, river and summits', () => {
  for(const [x,z] of [[0,0],[-2600,1200],[2250,3600],[-4200,-2000],[18000,18000]]) {
    const n=terrainNormal(x,z);
    assert.ok(Math.abs(Math.hypot(n.x,n.y,n.z)-1)<1e-10);
    assert.ok(n.y>0);
  }
});
test('stream requests coalesce and disposal terminates the worker', async () => {
  const original=globalThis.Worker;
  const messages=[];
  class FakeWorker { postMessage(m){messages.push(m);} terminate(){this.terminated=true;} }
  globalThis.Worker=FakeWorker;
  const engine=new NullEngine();const scene=new Scene(engine);const terrain=new EndlessTerrain(scene);
  try {
    assert.equal(messages.length,1);assert.ok(Number.isNaN(terrain.centerX));
    terrain.update({x:2200,z:1500});terrain.update({x:3500,z:2800});
    assert.equal(messages.length,1);
    const worker=terrain.worker;
    worker.onmessage({data:{x:0,z:-1024,tiles,generationMs:100}});
    await terrain.ready;
    assert.deepEqual(messages[1],{x:3072,z:3072});
    terrain.dispose();assert.equal(worker.terminated,true);
    assert.equal(scene.meshes.length,0);
  } finally { scene.dispose();engine.dispose();globalThis.Worker=original; }
});
test('flight physics stays settled on the runway after the terrain change', () => {
  const controller=new FlightController({terrain:{heightAt:terrainHeight,normalAt:terrainNormal,surfaceAt:(x,z)=>isRunwaySurface(x,z)?'runway':'rough'}});
  for(let frame=0;frame<600;frame++)controller.update(1/60,new Set());
  assert.equal(controller.state.crashed,false);assert.equal(controller.state.onGround,true);
  assert.ok(Math.abs(controller.state.position.x)<0.01);
  assert.ok(controller.state.position.y>1 && controller.state.position.y<4);
});
test('departure clears the new valley without changing flight tuning', () => {
  const controller=new FlightController({terrain:{heightAt:terrainHeight,normalAt:terrainNormal,surfaceAt:(x,z)=>isRunwaySurface(x,z)?'runway':'rough'}});
  const keys=new Set(['ShiftLeft','Space']);let liftAt=-1;
  for(let frame=0;frame<1500;frame++) {
    if(controller.state.airspeed>65 && liftAt<0)liftAt=frame;
    if(liftAt>=0 && frame-liftAt<90)keys.add('KeyS');else keys.delete('KeyS');
    controller.update(1/60,keys);
    assert.equal(controller.state.crashed,false);
  }
  assert.ok(controller.state.terrainClearance>100);
});
test('forest instances are bounded, deterministic and outside the runway', () => {
  const instances=buildForest(0,0);
  assert.deepEqual(instances,buildForest(0,0));
  assert.ok(instances.length<=700*16);
  for(let i=0;i<instances.length;i+=16) {
    assert.equal(isRunwaySurface(instances[i+12],instances[i+14],100),false);
    assert.ok(Number.isFinite(instances[i+13]));
  }
});
