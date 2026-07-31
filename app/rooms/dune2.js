/* Dune 2.0 — Sand Memory.

   A Snowflow-inspired second pass on the procedural desert. The terrain keeps
   Sansara's accessible Three.js path, but its surface is now a shader rather
   than a flat vertex-colour mesh: wind-swept bands, micro-grain, warm rim light,
   atmospheric distance, and a persistent trace field make the place feel like
   a material with a memory.

   The mechanic is deliberately quiet. Walking leaves a readable path, sprinting
   deepens it, and the wind slowly softens it. The world records that somebody
   was here without turning the room into a checklist or HUD objective.
*/

export const meta = {
  label: 'dune 2.0',
  blurb: 'Sand remembers every step. Wind decides what remains.',
  credit: 'Procedural tech demo — Sansara',
  tint: '#d9b27c',
};

export async function build({ THREE, loadGLB }) {
  const root = new THREE.Group();

  // --------------------------------------------------------------- noise
  const mulberry32 = seed => () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const rand = mulberry32(204012);
  const perm = new Uint8Array(512);
  {
    const p = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  const grads = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  const fade = t => t*t*t*(t*(t*6-15)+10);
  const noise2 = (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const g = (h, a, b) => { const q = grads[h & 7]; return q[0]*a + q[1]*b; };
    const A = perm[X] + Y, B = perm[X + 1] + Y;
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(g(perm[A], x, y), g(perm[B], x - 1, y), u),
      THREE.MathUtils.lerp(g(perm[A + 1], x, y - 1), g(perm[B + 1], x - 1, y - 1), u), v
    );
  };
  const fbm = (x, y, oct = 4) => {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise2(x * freq, y * freq);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  };

  // --------------------------------------------------------- sand profile
  const SIZE = 520, SEG = 360, CELL = SIZE / SEG, HALF = SIZE / 2;
  const HGRID = new Float32Array((SEG + 1) * (SEG + 1));
  const basinRadius = 42;
  function rawSand(x, z) {
    // Wind comes from the south-west. The asymmetric profile gives the dunes a
    // readable lee face instead of a generic noise field.
    const warp = fbm(x * 0.0025 + 18, z * 0.0025 - 8, 3) * 38;
    const ridge = (x * 0.014 + z * 0.004 + warp * 0.012);
    const phase = ridge - Math.floor(ridge);
    const crest = 0.67;
    const profile = phase < crest
      ? Math.pow(phase / crest, 1.5)
      : 1 - Math.pow((phase - crest) / (1 - crest), 0.7);
    const amp = 3.8 + fbm(x * 0.004 + 70, z * 0.004, 3) * 4.5;
    return profile * amp
      + fbm(x * 0.022, z * 0.022, 3) * 0.9
      + fbm(x * 0.11, z * 0.11, 2) * 0.12;
  }
  function sandHeight(x, z) {
    const h = rawSand(x, z);
    const d = Math.hypot(x + 4, z - 2);
    if (d > basinRadius + 30) return h;
    const basin = rawSand(-4, 2) - 0.75 + fbm(x * 0.018, z * 0.018, 3) * 0.45;
    return THREE.MathUtils.lerp(basin, h, THREE.MathUtils.smoothstep(d, basinRadius, basinRadius + 30));
  }
  function slopeAt(x, z) {
    const e = 0.85;
    return Math.abs(sandHeight(x + e, z) - sandHeight(x - e, z))
      + Math.abs(sandHeight(x, z + e) - sandHeight(x, z - e));
  }

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = sandHeight(x, z);
      pos.setY(i, h); HGRID[i] = h;
    }
    geo.computeVertexNormals();
  }

  function groundAt(x, z) {
    const fx = THREE.MathUtils.clamp((x + HALF) / CELL, 0, SEG - 1e-4);
    const fz = THREE.MathUtils.clamp((z + HALF) / CELL, 0, SEG - 1e-4);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, row = SEG + 1;
    const a = HGRID[j * row + i], d = HGRID[j * row + i + 1];
    const b = HGRID[(j + 1) * row + i], c = HGRID[(j + 1) * row + i + 1];
    return tx + tz <= 1 ? a + tx * (d - a) + tz * (b - a) : c + (1 - tx) * (b - c) + (1 - tz) * (d - c);
  }

  // ------------------------------------------------------- sand memory map
  const TRACE_RES = 160, TRACE_SIZE = 260;
  const traceData = new Uint8Array(TRACE_RES * TRACE_RES * 4);
  const traceTex = new THREE.DataTexture(traceData, TRACE_RES, TRACE_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  traceTex.wrapS = traceTex.wrapT = THREE.ClampToEdgeWrapping;
  traceTex.magFilter = THREE.LinearFilter; traceTex.minFilter = THREE.LinearFilter;
  traceTex.colorSpace = THREE.NoColorSpace; traceTex.needsUpdate = true;
  let traceCenterX = 0, traceCenterZ = 0, previousX = 0, previousZ = 6;
  let traceClock = 0;
  const traceIndex = (x, z) => {
    const u = (x - traceCenterX) / TRACE_SIZE + 0.5;
    const v = (z - traceCenterZ) / TRACE_SIZE + 0.5;
    return { x: Math.floor(u * TRACE_RES), y: Math.floor(v * TRACE_RES), u, v };
  };
  function clearTrace() { traceData.fill(0); traceTex.needsUpdate = true; }
  function stampTrace(x, z, strength, radius) {
    const p = traceIndex(x, z);
    const r = Math.max(1, Math.ceil(radius / TRACE_SIZE * TRACE_RES));
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
      const tx = p.x + xx, ty = p.y + yy;
      if (tx < 0 || ty < 0 || tx >= TRACE_RES || ty >= TRACE_RES) continue;
      const d = Math.hypot(xx, yy) / r;
      if (d > 1) continue;
      const k = (ty * TRACE_RES + tx) * 4;
      traceData[k] = Math.max(traceData[k], Math.min(255, strength * (1 - d * d)));
      traceData[k + 1] = 255;
    }
  }
  function stampSegment(x0, z0, x1, z1, speed) {
    const len = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.ceil(len / 0.28));
    const depth = THREE.MathUtils.clamp(28 + speed * 22, 26, 128);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      stampTrace(THREE.MathUtils.lerp(x0, x1, t), THREE.MathUtils.lerp(z0, z1, t), depth, speed > 3 ? 1.0 : 0.68);
    }
  }

  const sandVert = `
    varying vec3 vWorld;
    varying vec3 vNormalWorld;
    varying float vDistance;
    void main(){
      vec4 world = modelMatrix * vec4(position,1.0);
      vWorld = world.xyz;
      vNormalWorld = normalize(mat3(modelMatrix) * normal);
      vDistance = distance(cameraPosition, world.xyz);
      gl_Position = projectionMatrix * viewMatrix * world;
    }`;
  const sandFrag = `
    precision highp float;
    varying vec3 vWorld;
    varying vec3 vNormalWorld;
    varying float vDistance;
    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform sampler2D uTrace;
    uniform vec2 uTraceCenter;
    uniform float uTraceSize;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
    }
    void main(){
      vec3 N=normalize(vNormalWorld), L=normalize(uSunDir), V=normalize(cameraPosition-vWorld);
      float bands=noise(vWorld.xz*0.34 + vec2(uTime*0.006,-uTime*0.003));
      float grain=noise(vWorld.xz*3.8)+0.5*noise(vWorld.xz*11.0);
      vec2 tuv=(vWorld.xz-uTraceCenter)/uTraceSize+0.5;
      float trace=texture2D(uTrace,tuv).r;
      vec3 base=mix(vec3(0.52,0.29,0.115),vec3(0.78,0.52,0.23),bands*0.46+grain*0.12);
      base=mix(base,vec3(0.24,0.115,0.045),trace*0.72);
      float ndl=max(dot(N,L),0.0);
      float rim=pow(1.0-max(dot(N,V),0.0),2.2);
      float warm=pow(max(dot(reflect(-L,N),V),0.0),28.0);
      vec3 color=base*(0.22+ndl*0.9)*uSunColor;
      color+=vec3(0.92,0.56,0.28)*rim*0.18;
      color+=vec3(1.0,0.72,0.38)*warm*0.22;
      float fog=1.0-exp(-vDistance*vDistance*uFogDensity*0.00032);
      color=mix(color,uFogColor,clamp(fog,0.0,1.0));
      gl_FragColor=vec4(color,1.0);
    }`;
  const sandMat = new THREE.ShaderMaterial({
    vertexShader: sandVert, fragmentShader: sandFrag,
    uniforms: {
      uTime:{value:0}, uSunDir:{value:new THREE.Vector3(-0.45,0.72,0.28).normalize()},
      uSunColor:{value:new THREE.Color(1.0,0.72,0.42)}, uFogColor:{value:new THREE.Color(0x4c3024)},
      uFogDensity:{value:0.55}, uTrace:{value:traceTex}, uTraceCenter:{value:new THREE.Vector2(0,0)}, uTraceSize:{value:TRACE_SIZE},
    },
    side:THREE.DoubleSide,
  });
  const sand = new THREE.Mesh(geo, sandMat);
  sand.receiveShadow = true; root.add(sand);

  // --------------------------------------------------------------- sky
  const skyMat = new THREE.ShaderMaterial({
    side:THREE.BackSide, depthWrite:false, fog:false,
    uniforms:{ top:{value:new THREE.Color(0x253857)}, mid:{value:new THREE.Color(0x7696ad)}, low:{value:new THREE.Color(0xd9a878)}, time:{value:0} },
    vertexShader:`varying vec3 vP; void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec3 vP; uniform vec3 top,mid,low; uniform float time;
      float hsh(vec2 p){return fract(sin(dot(p,vec2(14.7,53.1)))*43758.5);}
      void main(){float h=normalize(vP).y;vec3 c=mix(low,mid,smoothstep(-.08,.24,h));c=mix(c,top,smoothstep(.18,.78,h));float dust=smoothstep(.2,.8,h)*(.025+.02*hsh(vP.xz*.01+time*.004));gl_FragColor=vec4(c+vec3(dust,.7*dust,.35*dust),1.);}`,
  });
  root.add(new THREE.Mesh(new THREE.SphereGeometry(430, 32, 20), skyMat));

  // --------------------------------------------------------- structures
  const solid = [];
  function addFootprint(gltf, p, pad=0) {
    const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const c = Math.cos(p.ry), s = Math.sin(p.ry);
    solid.push({ x:p.x+(center.x*c+center.z*s)*p.s, z:p.z+(-center.x*s+center.z*c)*p.s,
      hx:Math.max(.35,size.x*p.s*.5+pad), hz:Math.max(.35,size.z*p.s*.5+pad), c, s });
  }
  function hitsStructure(x,z,pad=0){
    for (const b of solid){ const dx=x-b.x,dz=z-b.z,lx=b.c*dx-b.s*dz,lz=b.s*dx+b.c*dz;
      if(Math.abs(lx)<=b.hx+pad&&Math.abs(lz)<=b.hz+pad)return true; }
    return false;
  }
  function scatter(gltf, placements, cast=false){
    if (!placements.length) return;
    const parts=[]; gltf.scene.updateWorldMatrix(true,true);
    gltf.scene.traverse(o=>{if(o.isMesh)parts.push({geo:o.geometry,mat:o.material,mw:o.matrixWorld.clone()});});
    for(const part of parts){
      const mat=part.mat.clone();
      const inst=new THREE.InstancedMesh(part.geo,mat,placements.length); inst.castShadow=cast; inst.receiveShadow=true;
      const m=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler();
      placements.forEach((p,i)=>{e.set(0,p.ry,0);q.setFromEuler(e);m.compose(new THREE.Vector3(p.x,p.y,p.z),q,new THREE.Vector3(p.s,p.s,p.s));m.multiply(part.mw);inst.setMatrixAt(i,m);});
      inst.instanceMatrix.needsUpdate=true; root.add(inst);
    }
  }
  const TOWN='assets/fantasy-town/Models/GLB format/', NATURE='assets/nature/Models/GLTF format/';
  const [stone,wood,hut,well,rock,cactus,grass,path] = await Promise.all([
    loadGLB('assets/houses/house-stone.glb'), loadGLB('assets/houses/house-wood-tall.glb'), loadGLB('assets/houses/house-hut.glb'),
    loadGLB(TOWN+'fountain-round-detail.glb'), loadGLB(NATURE+'rock_largeA.glb'), loadGLB(NATURE+'cactus_tall.glb'),
    loadGLB(NATURE+'grass_large.glb'), loadGLB(NATURE+'path_stone.glb'),
  ]);
  const homes=[stone,wood,hut], homePs=[];
  for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2 + (rand()-.5)*.16, r=16+(rand()-.5)*3;
    homePs.push({x:Math.cos(a)*r,z:Math.sin(a)*r,y:groundAt(Math.cos(a)*r,Math.sin(a)*r)-.08,ry:-a+Math.PI/2,s:2.25+(rand()-.5)*.18});
  }
  homes.forEach((g,i)=>{const ps=homePs.filter((_,j)=>j%3===i);scatter(g,ps,true);ps.forEach(p=>addFootprint(g,p,.1));});
  const wellP={x:0,z:0,y:groundAt(0,0)-.05,ry:0,s:1.25}; scatter(well,[wellP]); addFootprint(well,wellP,.15);
  const scatterRing=(g,count,r0,r1,minDist,sMin,sMax)=>{const ps=[];for(let i=0;i<count;i++){const a=rand()*Math.PI*2,r=r0+Math.sqrt(rand())*(r1-r0),x=Math.cos(a)*r,z=Math.sin(a)*r;if(ps.some(p=>Math.hypot(p.x-x,p.z-z)<minDist))continue;ps.push({x,z,y:groundAt(x,z)-.06,ry:rand()*Math.PI*2,s:sMin+rand()*(sMax-sMin)});}scatter(g,ps);};
  scatterRing(rock,55,30,230,5,1.6,3.3); scatterRing(cactus,85,28,220,5,1.5,2.4); scatterRing(grass,150,10,180,2,1.2,2.0); scatterRing(path,80,3,34,1.5,1.8,2.4);

  previousX=0; previousZ=6; traceCenterX=0; traceCenterZ=0; clearTrace();
  function update(dt,pos){
    const dx=pos.x-previousX,dz=pos.z-previousZ,moved=Math.hypot(dx,dz);
    if (Math.abs(pos.x-traceCenterX)>TRACE_SIZE*.38||Math.abs(pos.z-traceCenterZ)>TRACE_SIZE*.38){traceCenterX=pos.x;traceCenterZ=pos.z;clearTrace();}
    if(moved>.012)stampSegment(previousX,previousZ,pos.x,pos.z,Math.min(6,moved/Math.max(dt,.001)));
    previousX=pos.x;previousZ=pos.z; traceClock+=dt;
    if(traceClock>.08){traceClock=0;for(let i=0;i<traceData.length;i+=4){traceData[i]=Math.max(0,traceData[i]-1);traceData[i+1]=255;}traceTex.needsUpdate=true;}
    sandMat.uniforms.uTime.value+=dt; skyMat.uniforms.time.value+=dt; sandMat.uniforms.uTraceCenter.value.set(traceCenterX,traceCenterZ);
  }
  return {
    root, spawn:[0,6], baked:false, update,
    fog:[0x4c3024,0.0032], exposure:0.72, charScale:1.0, camDist:7.7,
    env:{wall:0x5b3c2c,panel:0xf3c28d,floor:0x6b3e25,intensity:0.42},
    lights:{ambient:0.28,hemi:0.45,dir:1.3,fill:0.15,sky:0xf2bd83,ground:0x321b12},
    sun:{position:[-70,62,42],follow:true,shadow:true},
    collision:{ceiling:null,groundAt:(x,z,fb)=>Math.abs(x)>HALF-2||Math.abs(z)>HALF-2?(fb??0):groundAt(x,z),
      walkable:(x,z)=>Math.abs(x)<HALF-8&&Math.abs(z)<HALF-8&&!hitsStructure(x,z,.12),
      occludes:(x,z)=>Math.abs(x)>=HALF-8||Math.abs(z)>=HALF-8||hitsStructure(x,z,.04)},
  };
}
