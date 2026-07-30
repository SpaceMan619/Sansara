/* Dune — procedural desert with a village in a basin.

   Built rather than loaded, so it supplies its own collision: the terrain
   height is an analytic function, and sampling the same grid the mesh was
   built from is both cheaper and more accurate than rasterising 180k
   triangles the way a downloaded scene has to be. */

export const meta = {
  label: 'dune',
  blurb: 'A desert built from noise, with a village in the hollow.',
  credit: 'Environment kit by Kenney (CC0)',
  creditUrl: 'https://kenney.nl',
  tint: '#e7c78d',
};

export async function build({ THREE, loadGLB }){
  const root = new THREE.Group();

  /* ---------------------------- noise ---------------------------- */
  const mulberry32 = a => () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const rand = mulberry32(20260729);
  const perm = new Uint8Array(512);
  {
    const p = [...Array(256).keys()];
    for (let i = 255; i > 0; i--){ const j = Math.floor(rand()*(i+1)); [p[i],p[j]] = [p[j],p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  const G = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  const fade = t => t*t*t*(t*(t*6-15)+10);
  function noise2(x,y){
    const X = Math.floor(x)&255, Y = Math.floor(y)&255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const g = (h,a,b) => { const q = G[h&7]; return q[0]*a + q[1]*b; };
    const A = perm[X]+Y, B = perm[X+1]+Y;
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(g(perm[A],x,y),     g(perm[B],x-1,y),   u),
      THREE.MathUtils.lerp(g(perm[A+1],x,y-1), g(perm[B+1],x-1,y-1), u), v);
  }
  function fbm(x,y,oct=4){
    let a=1,f=1,s=0,n=0;
    for (let i=0;i<oct;i++){ s += a*noise2(x*f,y*f); n += a; a *= 0.5; f *= 2; }
    return s/n;
  }

  /* ------------------------- dune profile -------------------------
     Barchan asymmetry: a long windward climb and a short steep slipface,
     domain-warped so the ridge lines meander. Symmetric noise reads as a
     lumpy beach; the asymmetry is what makes it a desert. */
  const BASIN_R = 34, BASIN_FALLOFF = 26;
  function rawDune(x,z){
    const warp = fbm(x*0.0032, z*0.0032, 3) * 46;
    const amp  = 3.4 + fbm(x*0.0055+90, z*0.0055, 3) * 5.2;
    const t = (x + warp) * 0.0165;
    const f = t - Math.floor(t);
    const CREST = 0.74;
    const profile = f < CREST
      ? Math.pow(f/CREST, 1.55)
      : 1 - Math.pow((f-CREST)/(1-CREST), 0.75);
    let h = profile * amp;
    h += fbm(x*0.026, z*0.026, 3) * 1.1;
    h += fbm(x*0.13,  z*0.13,  2) * 0.16;
    return h;
  }
  function duneHeight(x,z){
    const h = rawDune(x,z);
    const d = Math.hypot(x,z);
    if (d > BASIN_R + BASIN_FALLOFF) return h;
    const basin = rawDune(0,0) - 0.6
                + fbm(x*0.022, z*0.022, 3) * 0.55
                + fbm(x*0.13,  z*0.13,  2) * 0.10;
    const t = THREE.MathUtils.smoothstep(d, BASIN_R, BASIN_R + BASIN_FALLOFF);
    return THREE.MathUtils.lerp(basin, h, t);
  }
  function slopeAt(x,z){
    const e = 0.9;
    return Math.abs(duneHeight(x+e,z)-duneHeight(x-e,z))
         + Math.abs(duneHeight(x,z+e)-duneHeight(x,z-e));
  }

  /* --------------------------- terrain --------------------------- */
  const SIZE = 420, SEG = 300, CELL = SIZE/SEG, HALF = SIZE/2;
  const HGRID = new Float32Array((SEG+1)*(SEG+1));
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI/2);
  {
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count*3);
    const cShade = new THREE.Color(0xc9a06a), cSand = new THREE.Color(0xe2bd85),
          cCrest = new THREE.Color(0xf7e6c2), c = new THREE.Color();
    for (let i=0;i<pos.count;i++){
      const x = pos.getX(i), z = pos.getZ(i);
      const h = duneHeight(x,z);
      pos.setY(i,h);
      HGRID[i] = h;
      const steep = THREE.MathUtils.clamp(slopeAt(x,z)*0.7, 0, 1);
      const lift  = THREE.MathUtils.clamp((h+2)/10, 0, 1);
      c.copy(cSand).lerp(cCrest, lift*lift).lerp(cShade, steep*0.8);
      const grain = 1 + noise2(x*0.9, z*0.9)*0.045;
      colors[i*3] = c.r*grain; colors[i*3+1] = c.g*grain; colors[i*3+2] = c.b*grain;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
    geo.computeVertexNormals();
  }
  const sand = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors:true, roughness:0.92, metalness:0 }));
  sand.receiveShadow = true;
  root.add(sand);

  /* Query the rendered surface, not the analytic function: the mesh is a
     linear interpolation between grid vertices, so on a crest the analytic
     value sits above the visible triangle and the character hovers. */
  function groundAt(x,z){
    const fx = THREE.MathUtils.clamp((x+HALF)/CELL, 0, SEG-1e-4);
    const fz = THREE.MathUtils.clamp((z+HALF)/CELL, 0, SEG-1e-4);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx-i, tz = fz-j, row = SEG+1;
    const hA = HGRID[j*row+i],     hD = HGRID[j*row+i+1];
    const hB = HGRID[(j+1)*row+i], hC = HGRID[(j+1)*row+i+1];
    return (tx + tz <= 1)
      ? hA + tx*(hD-hA) + tz*(hB-hA)
      : hC + (1-tx)*(hB-hC) + (1-tz)*(hD-hC);
  }

  /* ---------------------------- sky ------------------------------ */
  root.add(new THREE.Mesh(
    new THREE.SphereGeometry(400, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite:false, fog:false,
      uniforms:{ top:{value:new THREE.Color(0x3f7fc4)},
                 mid:{value:new THREE.Color(0xbcd2e8)},
                 low:{value:new THREE.Color(0xf6d9a6)} },
      vertexShader:`varying vec3 vP; void main(){ vP=position;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader:`varying vec3 vP; uniform vec3 top, mid, low;
        void main(){ float h = normalize(vP).y;
          vec3 c = mix(low, mid, smoothstep(-0.05, 0.22, h));
          c = mix(c, top, smoothstep(0.18, 0.75, h));
          gl_FragColor = vec4(c, 1.0); }`
    })
  ));

  /* -------------------------- scatter ----------------------------
     One InstancedMesh per source geometry: hundreds of props in a
     handful of draw calls. */
  const TOWN   = 'assets/fantasy-town/Models/GLB format/';
  const NATURE = 'assets/nature/Models/GLTF format/';
  const occupied = [];
  const SPAWN = new THREE.Vector2(0, 6), SPAWN_CLEAR = 6;

  function sample({count, rMin, rMax, minDist, maxSlope=0.85, scale=[1,1], tries=60}){
    const out = [];
    for (let i=0;i<count;i++){
      for (let t=0;t<tries;t++){
        const a = rand()*Math.PI*2, r = rMin + Math.sqrt(rand())*(rMax-rMin);
        const x = Math.cos(a)*r, z = Math.sin(a)*r;
        if (Math.hypot(x-SPAWN.x, z-SPAWN.y) < SPAWN_CLEAR) continue;
        if (slopeAt(x,z) > maxSlope) continue;
        if (occupied.some(o => Math.hypot(o.x-x, o.z-z) < minDist)) continue;
        const p = { x, z, y: groundAt(x,z)-0.05, ry: rand()*Math.PI*2,
                    s: scale[0] + rand()*(scale[1]-scale[0]) };
        out.push(p); occupied.push(p); break;
      }
    }
    return out;
  }
  function scatter(gltf, placements, castShadow=false){
    if (!placements.length) return;
    const parts = [];
    gltf.scene.updateWorldMatrix(true, true);
    gltf.scene.traverse(o=>{ if (o.isMesh) parts.push({ geo:o.geometry, mat:o.material, mw:o.matrixWorld.clone() }); });
    for (const part of parts){
      const mat = part.mat.clone();
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      const inst = new THREE.InstancedMesh(part.geo, mat, placements.length);
      inst.castShadow = castShadow; inst.receiveShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      placements.forEach((p,i)=>{
        e.set(0,p.ry,0); q.setFromEuler(e);
        m.compose(new THREE.Vector3(p.x,p.y,p.z), q, new THREE.Vector3(p.s,p.s,p.s));
        m.multiply(part.mw);
        inst.setMatrixAt(i,m);
      });
      inst.instanceMatrix.needsUpdate = true;
      root.add(inst);
    }
  }

  const [hStone,hWood,hHut,well,lantern,stall,cart,cactusT,cactusS,
         rockL,rockS,bushL,bushS,grassT,fence,pathStone] = await Promise.all([
    loadGLB('assets/houses/house-stone.glb'),
    loadGLB('assets/houses/house-wood-tall.glb'),
    loadGLB('assets/houses/house-hut.glb'),
    loadGLB(TOWN+'fountain-round-detail.glb'),
    loadGLB(TOWN+'lantern.glb'),
    loadGLB(TOWN+'stall.glb'),
    loadGLB(TOWN+'cart.glb'),
    loadGLB(NATURE+'cactus_tall.glb'),
    loadGLB(NATURE+'cactus_short.glb'),
    loadGLB(NATURE+'rock_largeA.glb'),
    loadGLB(NATURE+'rock_smallA.glb'),
    loadGLB(NATURE+'plant_bushLarge.glb'),
    loadGLB(NATURE+'plant_bushSmall.glb'),
    loadGLB(NATURE+'grass_large.glb'),
    loadGLB(TOWN+'fence.glb'),
    loadGLB(NATURE+'path_stone.glb'),
  ]);

  scatter(well, [{x:0, z:0, y:groundAt(0,0)-0.05, ry:0, s:1.35}]);
  occupied.push({x:0,z:0});

  // Houses ring the plaza and face it, so it reads as a settlement.
  const homes = [hStone, hWood, hHut];
  const placements = new Map(homes.map(g=>[g,[]]));
  let idx = 0;
  for (const ring of [{r:15,n:9,s:2.4},{r:25,n:11,s:2.4}]){
    for (let i=0;i<ring.n;i++){
      const a = (i/ring.n)*Math.PI*2 + (rand()-0.5)*0.18;
      const r = ring.r + (rand()-0.5)*3.5;
      const x = Math.cos(a)*r, z = Math.sin(a)*r;
      const g = homes[(idx++ + (rand()<0.3?1:0)) % homes.length];
      placements.get(g).push({ x, z, y: groundAt(x,z)-0.08,
        ry: -a + Math.PI/2 + (rand()-0.5)*0.12, s: ring.s + (rand()-0.5)*0.25 });
      occupied.push({x,z});
    }
  }
  for (const [g,ps] of placements) scatter(g, ps, true);   // houses cast, ground cover doesn't

  scatter(stall,     sample({count:7,  rMin:8,  rMax:13, minDist:4,   scale:[1.7,1.9]}));
  scatter(cart,      sample({count:4,  rMin:9,  rMax:14, minDist:4.5, scale:[1.7,1.9]}));
  scatter(lantern,   sample({count:14, rMin:5,  rMax:28, minDist:3.5, scale:[2.0,2.3]}));
  scatter(fence,     sample({count:22, rMin:16, rMax:32, minDist:2.2, scale:[2.0,2.2]}));
  scatter(pathStone, sample({count:70, rMin:3,  rMax:30, minDist:1.4, scale:[2.0,2.6]}));
  scatter(cactusT,   sample({count:70, rMin:34, rMax:190, minDist:5,  maxSlope:1.1, scale:[1.6,2.6]}));
  scatter(cactusS,   sample({count:90, rMin:30, rMax:190, minDist:4,  maxSlope:1.2, scale:[1.5,2.4]}));
  scatter(rockL,     sample({count:45, rMin:30, rMax:195, minDist:7,  maxSlope:1.4, scale:[2.0,3.6]}));
  scatter(rockS,     sample({count:110,rMin:24, rMax:195, minDist:3,  maxSlope:1.4, scale:[1.6,3.0]}));
  scatter(bushL,     sample({count:70, rMin:20, rMax:170, minDist:4,  maxSlope:1.0, scale:[1.4,2.2]}));
  scatter(bushS,     sample({count:120,rMin:14, rMax:180, minDist:2.5,maxSlope:1.1, scale:[1.4,2.2]}));
  scatter(grassT,    sample({count:220,rMin:10, rMax:185, minDist:1.8,maxSlope:1.2, scale:[1.2,2.0]}));

  return {
    root,
    spawn: [0, 6],
    baked: false,
    fog: [0xe7cfa6, 0.0042],
    exposure: 0.92,
    charScale: 1.0,
    camDist: 7.5,
    env: { wall:0xc9b58c, panel:0xffeec6, floor:0xa88f63, intensity:0.45 },
    lights: { ambient:0.10, hemi:0.55, dir:1.9, sky:0xbfd8f5, ground:0xc79a5c },
    sun: { position:[-60, 46, 34], follow:true, shadow:true },
    collision: {
      ceiling: null,
      groundAt: (x,z,fb)=> (Math.abs(x)>HALF-2 || Math.abs(z)>HALF-2) ? (fb ?? 0) : groundAt(x,z),
      walkable: (x,z)=> Math.abs(x) < HALF-8 && Math.abs(z) < HALF-8,
    },
  };
}
