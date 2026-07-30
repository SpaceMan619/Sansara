/* Level 0 — an endless procedural backrooms.

   Nothing is downloaded: every texture is drawn on a canvas at load, and
   the normal and roughness maps are derived from those same canvases.
   Without them light has nothing to react to and no amount of relighting
   reads as real. */

export const meta = {
  label: 'level 0',
  blurb: 'Endless yellow rooms, generated fresh each time.',
  credit: 'Procedural — no assets',
  tint: '#a89a52',
};

export async function build({ THREE }){
  const root = new THREE.Group();

  const GRID = 42, CELL = 6, WALL_H = 7.5, HALF = GRID*CELL/2;
  const mulberry32 = a => () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const rand = mulberry32(Math.floor(Math.random()*1e9));   // a new floor each visit

  /* Random walk with long straight runs rather than a perfect maze:
     Level 0 should read as a badly-partitioned office floor with dead ends
     and rooms opening into rooms, not as a puzzle. */
  const open = new Uint8Array(GRID*GRID);
  const at = (x,y) => (x<0||y<0||x>=GRID||y>=GRID) ? 0 : open[y*GRID+x];
  {
    let x = GRID>>1, y = GRID>>1;
    for (let i=0;i<GRID*GRID*0.11;i++){
      open[y*GRID+x] = 1;
      if (rand() < 0.22){ const d = rand()<0.5?1:-1; if (rand()<0.5) x+=d; else y+=d; }
      else {
        const run = 2 + Math.floor(rand()*5), horiz = rand()<0.5, d = rand()<0.5?1:-1;
        for (let s=0;s<run;s++){
          if (horiz) x+=d; else y+=d;
          x = THREE.MathUtils.clamp(x,1,GRID-2); y = THREE.MathUtils.clamp(y,1,GRID-2);
          open[y*GRID+x] = 1;
        }
      }
      x = THREE.MathUtils.clamp(x,1,GRID-2); y = THREE.MathUtils.clamp(y,1,GRID-2);
    }
    for (let r=0;r<7;r++){
      const w = 2+Math.floor(rand()*3), h = 2+Math.floor(rand()*3);
      const ox = 1+Math.floor(rand()*(GRID-w-2)), oy = 1+Math.floor(rand()*(GRID-h-2));
      for (let j=0;j<h;j++) for (let i=0;i<w;i++) open[(oy+j)*GRID+ox+i] = 1;
    }
  }
  const cellToWorld = i => i*CELL - HALF + CELL/2;
  const isOpenAtWorld = (x,z) => at(Math.floor((x+HALF)/CELL), Math.floor((z+HALF)/CELL));

  /* ------------------------- textures --------------------------- */
  // 512 keeps the wall grain and carpet relief crisp at native Retina
  // rendering; the previous 256 source became visibly soft at close range.
  const makeCanvas = (draw, size=512) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size); return c;
  };
  const texFrom = (canvas, repeat=1, srgb=true) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  // Sobel the luminance into a tangent-space normal map — surface relief is
  // what lets light rake across a plane instead of flatly filling it.
  function deriveNormal(src, strength=2.2){
    const s = src.width, sd = src.getContext('2d').getImageData(0,0,s,s).data;
    const lum = new Float32Array(s*s);
    for (let i=0;i<s*s;i++) lum[i] = (sd[i*4]*0.299 + sd[i*4+1]*0.587 + sd[i*4+2]*0.114)/255;
    const out = makeCanvas(()=>{}, s);
    const ctx = out.getContext('2d'), img = ctx.createImageData(s,s), d = img.data;
    const L = (x,y) => lum[((y+s)%s)*s + ((x+s)%s)];
    for (let y=0;y<s;y++) for (let x=0;x<s;x++){
      const dx = (L(x-1,y-1)+2*L(x-1,y)+L(x-1,y+1)) - (L(x+1,y-1)+2*L(x+1,y)+L(x+1,y+1));
      const dy = (L(x-1,y-1)+2*L(x,y-1)+L(x+1,y-1)) - (L(x-1,y+1)+2*L(x,y+1)+L(x+1,y+1));
      const nx = dx*strength, ny = dy*strength, len = Math.hypot(nx,ny,1), i = (y*s+x)*4;
      d[i] = ((nx/len)*0.5+0.5)*255; d[i+1] = ((ny/len)*0.5+0.5)*255;
      d[i+2] = ((1/len)*0.5+0.5)*255; d[i+3] = 255;
    }
    ctx.putImageData(img,0,0);
    return out;
  }
  function deriveRoughness(src, lo=0.9, hi=1.0){
    const s = src.width, sd = src.getContext('2d').getImageData(0,0,s,s).data;
    const out = makeCanvas(()=>{}, s);
    const ctx = out.getContext('2d'), img = ctx.createImageData(s,s), d = img.data;
    for (let i=0;i<s*s;i++){
      const l = (sd[i*4]*0.299 + sd[i*4+1]*0.587 + sd[i*4+2]*0.114)/255;
      const r = (hi - (hi-lo)*l)*255;
      d[i*4] = d[i*4+1] = d[i*4+2] = r; d[i*4+3] = 255;
    }
    ctx.putImageData(img,0,0);
    return out;
  }
  const noiseInto = (ctx,size,amount) => {
    const img = ctx.getImageData(0,0,size,size), d = img.data;
    for (let i=0;i<d.length;i+=4){
      const n = (Math.random()-0.5)*amount;
      d[i]+=n; d[i+1]+=n; d[i+2]+=n*0.8;
    }
    ctx.putImageData(img,0,0);
  };

  // Documented Level 0 palette: muted yellows over brown-orange carpet.
  const wallCanvas = makeCanvas((ctx,s)=>{
    ctx.fillStyle = '#8e8744'; ctx.fillRect(0,0,s,s);
    for (let x=0;x<s;x+=8){
      ctx.fillStyle = (x/8)%2 ? 'rgba(158,149,88,.22)' : 'rgba(139,130,70,.18)';
      ctx.fillRect(x,0,4,s);
    }
    for (let i=0;i<22;i++){
      const cx = Math.random()*s, cy = Math.random()*s, r = 14+Math.random()*34;
      const g = ctx.createRadialGradient(cx,cy,r*0.15, cx,cy,r);
      g.addColorStop(0,'rgba(108,100,52,.20)'); g.addColorStop(1,'rgba(108,100,52,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(133,124,65,.55)'; ctx.lineWidth = 1;
    for (let x=0;x<s;x+=64){ ctx.beginPath(); ctx.moveTo(x+.5,0); ctx.lineTo(x+.5,s); ctx.stroke(); }
    ctx.fillStyle = 'rgba(120,110,58,.75)'; ctx.fillRect(0, s-14, s, 10);
    noiseInto(ctx,s,26);
  });
  const carpetCanvas = makeCanvas((ctx,s)=>{
    ctx.fillStyle = '#74602c'; ctx.fillRect(0,0,s,s);
    for (let i=0;i<9000;i++){
      ctx.fillStyle = `rgba(${104+Math.random()*44|0},${84+Math.random()*36|0},${38+Math.random()*24|0},.55)`;
      ctx.fillRect(Math.random()*s, Math.random()*s, 2, 1);
    }
    for (let i=0;i<10;i++){
      const cx=Math.random()*s, cy=Math.random()*s, r=18+Math.random()*40;
      const g=ctx.createRadialGradient(cx,cy,r*0.1,cx,cy,r);
      g.addColorStop(0,'rgba(64,52,22,.34)'); g.addColorStop(1,'rgba(64,52,22,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    }
    noiseInto(ctx,s,18);
  });
  const ceilCanvas = makeCanvas((ctx,s)=>{
    ctx.fillStyle = '#d4cfa5'; ctx.fillRect(0,0,s,s);
    for (let i=0;i<2600;i++){
      ctx.fillStyle = `rgba(150,143,105,${Math.random()*0.5})`;
      ctx.fillRect(Math.random()*s, Math.random()*s, 2, 2);
    }
    ctx.strokeStyle = '#9d9570'; ctx.lineWidth = 4;
    ctx.strokeRect(0,0,s,s); ctx.beginPath();
    ctx.moveTo(s/2,0); ctx.lineTo(s/2,s); ctx.moveTo(0,s/2); ctx.lineTo(s,s/2); ctx.stroke();
  });
  const glowCanvas = makeCanvas((ctx,s)=>{
    const g = ctx.createRadialGradient(s/2,s/2,0, s/2,s/2,s/2);
    g.addColorStop(0,'rgba(255,246,214,0.95)');
    g.addColorStop(0.35,'rgba(255,240,190,0.34)');
    g.addColorStop(1,'rgba(255,235,170,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,s,s);
  }, 128);

  /* ------------------------- geometry ---------------------------- */
  const FLOOR = GRID*CELL;
  const floorMat = new THREE.MeshStandardMaterial({
    map: texFrom(carpetCanvas, GRID*1.4),
    normalMap: texFrom(deriveNormal(carpetCanvas,1.1), GRID*1.4, false),
    roughnessMap: texFrom(deriveRoughness(carpetCanvas,0.95,1.0), GRID*1.4, false),
    roughness:1, metalness:0 });
  floorMat.normalScale.set(0.30,0.30);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR,FLOOR), floorMat);
  floor.rotation.x = -Math.PI/2;
  root.add(floor);

  const ceilMat = new THREE.MeshStandardMaterial({
    map: texFrom(ceilCanvas, GRID),
    normalMap: texFrom(deriveNormal(ceilCanvas,2.6), GRID, false),
    roughnessMap: texFrom(deriveRoughness(ceilCanvas,0.86,1.0), GRID, false),
    roughness:1, metalness:0 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR,FLOOR), ceilMat);
  ceil.rotation.x = Math.PI/2; ceil.position.y = WALL_H;
  root.add(ceil);

  // Damp wallpaper is matte: real specular response reads as wet plastic.
  const wallMat = new THREE.MeshStandardMaterial({
    map: texFrom(wallCanvas, 1),
    normalMap: texFrom(deriveNormal(wallCanvas,1.3), 1, false),
    roughnessMap: texFrom(deriveRoughness(wallCanvas,0.90,1.0), 1, false),
    roughness:1, metalness:0, vertexColors:true });
  for (const k of ['map','normalMap','roughnessMap']) wallMat[k].repeat.set(1, WALL_H/CELL);
  wallMat.normalScale.set(0.16,0.16);

  // AO baked into vertex colours: corner darkening is most of what AO buys.
  const wallGeo = new THREE.PlaneGeometry(CELL, WALL_H, 1, 6);
  {
    const pos = wallGeo.attributes.position, col = new Float32Array(pos.count*3);
    for (let i=0;i<pos.count;i++){
      const yN = (pos.getY(i) + WALL_H/2)/WALL_H;
      const v = (0.72 + 0.28*THREE.MathUtils.smoothstep(yN,0,0.30))
              * (1 - 0.35*THREE.MathUtils.smoothstep(yN,0.82,1));
      col[i*3] = col[i*3+1] = col[i*3+2] = v;
    }
    wallGeo.setAttribute('color', new THREE.BufferAttribute(col,3));
  }

  const faces = [];
  for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++){
    if (!at(x,y)) continue;
    const wx = cellToWorld(x), wz = cellToWorld(y);
    if (!at(x+1,y)) faces.push([wx+CELL/2, wz, -Math.PI/2]);
    if (!at(x-1,y)) faces.push([wx-CELL/2, wz,  Math.PI/2]);
    if (!at(x,y+1)) faces.push([wx, wz+CELL/2, Math.PI]);
    if (!at(x,y-1)) faces.push([wx, wz-CELL/2, 0]);
  }
  {
    const inst = new THREE.InstancedMesh(wallGeo, wallMat, faces.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    faces.forEach(([x,z,ry],i)=>{
      e.set(0,ry,0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, WALL_H/2, z), q, new THREE.Vector3(1,1,1));
      inst.setMatrixAt(i,m);
    });
    inst.instanceMatrix.needsUpdate = true;
    root.add(inst);
  }

  /* ------------------------- fixtures ---------------------------- */
  const lampCells = [];
  for (let y=1;y<GRID-1;y+=2) for (let x=1;x<GRID-1;x+=2)
    if (at(x,y) && rand()<0.55) lampCells.push([cellToWorld(x), cellToWorld(y)]);

  const lampMat = new THREE.MeshBasicMaterial({ color:0xfff2c0, fog:true, toneMapped:false });
  const lampInst = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(CELL*0.55, CELL*0.55), lampMat, lampCells.length);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(Math.PI/2,0,0));
    const white = new THREE.Color(1,1,1);
    lampCells.forEach(([x,z],i)=>{
      m.compose(new THREE.Vector3(x, WALL_H-0.06, z), q, new THREE.Vector3(1,1,1));
      lampInst.setMatrixAt(i,m); lampInst.setColorAt(i, white);
    });
    lampInst.instanceMatrix.needsUpdate = true;
    root.add(lampInst);
  }
  // Additive glow: the look of bloom without paying for a post pass.
  {
    const glowMat = new THREE.MeshBasicMaterial({ map:texFrom(glowCanvas,1), transparent:true,
      blending:THREE.AdditiveBlending, depthWrite:false, fog:true, toneMapped:false, opacity:0.55 });
    const inst = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(CELL*2.1, CELL*2.1), glowMat, lampCells.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(Math.PI/2,0,0));
    lampCells.forEach(([x,z],i)=>{
      m.compose(new THREE.Vector3(x, WALL_H-0.10, z), q, new THREE.Vector3(1,1,1));
      inst.setMatrixAt(i,m);
    });
    inst.instanceMatrix.needsUpdate = true;
    root.add(inst);
  }

  /* A pool of real lights follows the player; the emissive panels carry the
     look everywhere else. One fixture buzzes, and its panel dims with it —
     a flickering light over a steadily lit panel reads as fake. */
  const POOL = 7, lampPool = [];
  for (let i=0;i<POOL;i++){
    const l = new THREE.PointLight(0xffe6a2, 0, 19, 2);
    root.add(l); lampPool.push(l);
  }
  const _c = new THREE.Color();
  let flicker = 0;

  let spawn = null;
  for (let y=GRID>>1; y<GRID-1 && !spawn; y++)
    if (at(GRID>>1,y)) spawn = [cellToWorld(GRID>>1), cellToWorld(y)];

  return {
    root,
    spawn: spawn || [0,0],
    baked: false,
    fog: [0x3b3318, 0.019],
    exposure: 0.3,
    charScale: 1.6,
    camDist: 8.286,
    env: { wall:0xb0a468, panel:0xffefc4, floor:0x6b5a34, intensity:0.7 },
    lights: { ambient:0.95, hemi:0.65, dir:0.3, fill:0.55, sky:0xe0d69e, ground:0x6b5d29 },
    collision: {
      ceiling: WALL_H,
      groundAt: ()=>0,
      walkable: (x,z)=> !!isOpenAtWorld(x,z),
      occludes: (x,z)=> !isOpenAtWorld(x,z),
    },
    update(dt, pos){
      flicker += dt;
      const near = lampCells
        .map(([x,z],idx)=>({x,z,idx,d:(x-pos.x)**2 + (z-pos.z)**2}))
        .sort((a,b)=>a.d-b.d).slice(0,POOL);
      lampPool.forEach((l,i)=>{
        if (i<near.length){
          l.position.set(near[i].x, WALL_H-0.35, near[i].z);
          const buzz = (i===2)
            ? (0.42 + 0.58*Math.abs(Math.sin(flicker*17.3)*Math.sin(flicker*3.1)))
            : 1;
          l.intensity = 13*buzz;
          _c.setScalar(0.25 + 0.75*buzz);
          lampInst.setColorAt(near[i].idx, _c);
          if (lampInst.instanceColor) lampInst.instanceColor.needsUpdate = true;
        } else l.intensity = 0;
      });
    },
  };
}
