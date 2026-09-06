const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../rooms.html'), 'utf8');
const section = (a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
function fixture(query, hostname='127.0.0.1') {
  const elements = new Map(), events = {}, destinations = [], loaded = [];
  function element() {
    const attrs = {}, classes = new Set();
    return {dataset:{},style:{setProperty(){}},children:[],offsetLeft:0,offsetWidth:100,clientWidth:800,
      classList:{add(...v){v.forEach(x=>classes.add(x));},remove(...v){v.forEach(x=>classes.delete(x));},toggle(k,on){on?classes.add(k):classes.delete(k);},contains(k){return classes.has(k);}},
      setAttribute(k,v){attrs[k]=v;},getAttribute(k){return attrs[k];},scrollTo(){},
      querySelector(){return null;},appendChild(el){this.children.push(el);},set innerHTML(v){this.children=[];},set className(v){v.split(' ').forEach(x=>classes.add(x));}};
  }
  const document = {getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,querySelectorAll(){return document.getElementById('rail').children;}};
  const ctx = vm.createContext({URL,URLSearchParams,console,document,
    location:{hostname,search:query,href:`https://${hostname}/Sansara/rooms.html${query}`,assign:u=>destinations.push(u)},
    history:{replaceState(){}},matchMedia:()=>({matches:true}),addEventListener:(k,fn)=>events[k]=fn,
    requestAnimationFrame:fn=>{fn();},prefetchPaleHorizonAirframe(){},stopRoomLifecycle(){},setTimeout:fn=>{fn();},soundMove(){},soundEnter(){},audioReady(){},thumbFor(){return '';},panelShown:false,showPanel(){},flashHud(){},showLoader(){},
    loadAvatar:async()=>loaded.push('avatar'),loadRoom:async k=>loaded.push(k),buildPanel(){},renderer:{setAnimationLoop(){}},safeTick(){}});
  vm.runInContext(section('const ROOMS = {','/* ========================= tuning params'),ctx);
  vm.runInContext(section('const IS_LOCAL =','/* A tiny synthesized'),ctx);
  vm.runInContext(section('function tintFor(k)','// Keys must not stay'),ctx);
  const run = s=>vm.runInContext(s,ctx);
  const key=(type,code,repeat=false)=>events[type]({code,repeat,preventDefault(){}});
  return {run,key,elements,destinations,loaded};
}
(async()=>{
  let checks=0;
  for(const origin of ['dune2','paleHorizon']) {
    const f=fixture(`?travel=1&current=${origin}`);
    f.run('openTravel()');
    assert.equal(f.run('travelCurrentKey()'),origin);
    assert.equal(f.elements.get('rail').children.filter(e=>e.getAttribute('aria-current')==='true').length,1);
    f.key('keyup','Tab');
    assert.equal(f.run('travelOpen'),true);assert.equal(f.destinations.length,0);
    f.key('keydown','ArrowRight');f.key('keydown','ArrowLeft');
    assert.equal(f.run('roomKeys()[travelIdx]'),origin);
    f.key('keydown','Enter');await new Promise(setImmediate);
    assert.equal(f.destinations.length,1);
    assert.ok(f.destinations[0].endsWith(origin==='dune2'?'dark-snow/dist/index.html?from=sansara':'pale-horizon/dist/index.html?from=sansara'));
    assert.deepEqual(f.loaded,[]);checks+=5;
  }
  {
    const f=fixture('?travel=1&current=paleHorizon'); f.run('openTravel()');
    f.key('keydown','Tab');f.key('keyup','Tab');await new Promise(setImmediate);
    assert.equal(f.destinations.length,1);checks++;
  }
  {
    const f=fixture('');f.run('openTravel()');
    assert.equal(f.run('travelCurrentKey()'),null);
    f.key('keydown','Enter');await new Promise(setImmediate);
    assert.deepEqual(f.loaded,['avatar','dune']);assert.equal(f.run('worldReady'),true);
    f.run('openTravel()');f.key('keydown','Escape');assert.equal(f.run('travelOpen'),false);
    f.key('keydown','Tab');assert.equal(f.run('travelOpen'),true);
    f.key('keyup','Tab');assert.equal(f.run('travelOpen'),false);checks+=5;
  }
  {
    const f=fixture('?travel=1&current=paleHorizon');f.run('openTravel()');f.key('keydown','ArrowRight');
    const dark=f.elements.get('rail').children[1];dark.onpointerdown();
    assert.equal(f.run('travelIdx'),1);dark.onclick();await new Promise(setImmediate);
    assert.ok(f.destinations[0].includes('dark-snow'));assert.deepEqual(f.loaded,[]);checks+=3;
  }
  {
    const f=fixture('?travel=1&current=dune2');f.run('openTravel(); pointerX=100; pointerY=100');
    f.elements.get('rail').children[2].onpointermove({clientX:101,clientY:101});
    assert.equal(f.run('travelIdx'),1);
    f.elements.get('rail').children[2].onpointermove({clientX:130,clientY:100});
    assert.equal(f.run('travelIdx'),2);assert.equal(f.run('travelInput'),'pointer');checks+=3;
  }
  for(const k of ['dune','level0','backrooms','lobby','pool','dreamcore']) {
    const f=fixture('');await f.run(`goTo('${k}')`);assert.deepEqual(f.loaded,['avatar',k]);checks++;
  }
  {
    const f=fixture('');
    f.run('worldReady=true; loadRoom=async()=>{throw new Error("simulated network failure");}; console={error(){}}');
    await f.run('goTo("pool")');
    assert.equal(f.run('switching'),false);assert.equal(f.run('roomKey'),'dune');
    assert.equal(f.elements.get('loadPhase').children[0].href,'?travel=1');checks+=3;
  }
  {
    const f=fixture('', 'spaceman619.github.io');assert.equal(f.run('roomKeys().includes("lobby")'),false);
    assert.equal(f.run('roomKeys().length'),7);checks+=2;
  }
  {
    const f=fixture('?travel=1&current=dune2'); f.run('openTravel()');
    const block=section('  const pad = pollPad();','  if (!grid) { renderer.render(scene, camera); return; }');
    f.run("let padTravelHeld=false; let jumpBufT=0; const JUMP_BUFFER=0.15; let dancing=false, moonwalking=false; function notePadActivity(){}; let padPressed=new Set(); let squareDown=true; function pollPad(){return {moveMag:0,lookX:0,lookY:0,anyPressed:()=>false,pressed:k=>padPressed.has(k),down:()=>squareDown};}");
    f.run('(function(){'+block+'})()');
    f.run("padPressed=new Set(['right'])");
    f.run('(function(){'+block+'})()');
    assert.equal(f.run('roomKeys()[travelIdx]'),'paleHorizon');
    f.run("padPressed.clear(); squareDown=false");
    f.run('(function(){'+block+'})()');
    await new Promise(setImmediate);
    assert.ok(f.destinations[0].includes('pale-horizon')); checks+=2;
  }
  console.log(`PASS: ${checks} selector assertions; standalone routing keeps /Sansara/ prefix; six internal routes and hosted license filter preserved.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
