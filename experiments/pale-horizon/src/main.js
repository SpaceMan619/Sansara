import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import "@babylonjs/loaders/glTF";

import { FlightController } from "./flight/flightController.js";
import { createFlightSound } from "./audio/flightSound.js";
import { EndlessTerrain } from "./world/endlessTerrain.js";
import { isRunwaySurface, terrainHeight, terrainNormal } from "./world/terrainField.js";
import { createAtmosphere } from "./world/atmosphere.js";

const canvas = document.getElementById("view");
const ui = Object.fromEntries([...document.querySelectorAll("[id]")].map((el) => [el.id, el]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const RAD = Math.PI / 180;

function openSansaraSelector(currentWorld) {
  const marker = "/experiments/";
  const markerAt = location.pathname.indexOf(marker);
  const rootPath = markerAt >= 0 ? location.pathname.slice(0, markerAt + 1) : "/";
  const target = new URL(`${rootPath}rooms.html`, location.origin);
  target.searchParams.set("travel", "1");
  target.searchParams.set("current", currentWorld);
  location.assign(target.href);
}

const defaults = Object.freeze({
  quality: 1,
  cameraDistance: 28,
  cameraResponse: 4.5,
  assists: true,
  sensitivity: 1,
  sun: 3.4,
  exposure: 0.82,
  fog: 0.00011,
  audio: true,
});
const settings = { ...defaults };

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("renderer timeout")), timeoutMs)),
  ]);
}

async function createEngine() {
  let gpu = null;
  if (navigator.gpu) {
    try {
      if (await withTimeout(WebGPUEngine.IsSupportedAsync, 1500)) {
        gpu = new WebGPUEngine(canvas, { antialias: true, powerPreference: "high-performance" });
        await withTimeout(gpu.initAsync(), 4000);
        return gpu;
      }
    } catch {
      // Some browsers expose navigator.gpu before the adapter or shader path is usable.
      gpu?.dispose();
    }
  }
  console.warn("[Pale Horizon] WebGPU unavailable or failed to initialize; using the WebGL test path.");
  return new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, powerPreference: "high-performance" });
}

const engine = await createEngine();
const scene = new Scene(engine);
scene.clearColor = new Color4(0.43, 0.51, 0.55, 1);
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogColor = new Color3(0.52, 0.58, 0.59);
scene.fogDensity = settings.fog;
scene.imageProcessingConfiguration.exposure = settings.exposure;
scene.imageProcessingConfiguration.contrast = 1.16;
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;

const camera = new FreeCamera("chase", new Vector3(0, 8, -24), scene);
camera.fov = 53 * RAD;
camera.minZ = 0.15;
camera.maxZ = 12000;
camera.inputs.clear();
scene.activeCamera = camera;

const atmosphere = createAtmosphere(scene, { azimuth: 118, elevation: 13 });
const hemi = new HemisphericLight("sky-fill", new Vector3(0.08, 1, 0.04), scene);
hemi.intensity = 0.76;
hemi.diffuse = new Color3(0.55, 0.66, 0.74);
hemi.groundColor = new Color3(0.15, 0.19, 0.20);
const sun = new DirectionalLight("low-sun", atmosphere.sunDirection.scale(-1), scene);
sun.position = atmosphere.sunDirection.scale(1800);
sun.diffuse = new Color3(1.0, 0.73, 0.48);
sun.intensity = settings.sun;
const shadows = new CascadedShadowGenerator(2048, sun);
shadows.numCascades = 4;
shadows.shadowMaxZ = 2800;
shadows.lambda = 0.72;
shadows.stabilizeCascades = true;
shadows.cascadeBlendPercentage = 0.12;
shadows.usePercentageCloserFiltering = true;
shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
shadows.bias = 0.00045;
shadows.normalBias = 0.025;

const terrain = new EndlessTerrain(scene);

const runway = MeshBuilder.CreateGround("runway", { width: 72, height: 1920 }, scene);
runway.position.set(0, 0.08, 180);
const runwayMat = new StandardMaterial("runway-mat", scene);
runwayMat.diffuseColor = new Color3(0.17, 0.2, 0.2);
runwayMat.specularColor = new Color3(0.12, 0.13, 0.12);
runway.material = runwayMat;
runway.receiveShadows = true;
for (let z = -700; z <= 1050; z += 100) {
  const mark = MeshBuilder.CreateGround(`center-${z}`, { width: 1.2, height: 38 }, scene);
  mark.position.set(0, 0.11, z);
  const material = new StandardMaterial(`center-mat-${z}`, scene);
  material.diffuseColor = new Color3(0.72, 0.72, 0.65);
  material.specularColor = Color3.Black();
  mark.material = material;
}

const aircraft = new TransformNode("aircraft-physics", scene);
aircraft.rotationQuaternion = Quaternion.Identity();
const visual = new TransformNode("aircraft-visual", scene);
visual.parent = aircraft;

ui.loadPhase.textContent = "loading full-resolution F-22";
let modelSize = "unknown";
try {
  const result = await SceneLoader.ImportMeshAsync("", "./models/", "f22_raptor_free.glb", scene);
  // The source file includes a demonstration clip for its ladder, gear and
  // panels. Babylon starts the first glTF animation by default, which made a
  // panel leave the aircraft and return during flight. Lock the model to its
  // authored first frame; flight state owns every moving part in this demo.
  for (const group of result.animationGroups || []) {
    group.stop();
    group.goToFrame(group.from);
    group.dispose();
  }
  const importedRoots = result.meshes.filter((m) => !m.parent);
  const normalize = new TransformNode("f22-normalize", scene);
  for (const root of importedRoots) root.parent = normalize;
  const bounds = normalize.getHierarchyBoundingVectors(true);
  const extent = bounds.max.subtract(bounds.min);
  const longAxis = extent.x > extent.z ? "x" : "z";
  const length = Math.max(extent.x, extent.z);
  const scale = 19 / Math.max(length, 0.001);
  const center = bounds.min.add(bounds.max).scale(0.5);
  normalize.position.copyFrom(center.scale(-1));
  normalize.scaling.setAll(scale);
  normalize.rotationQuaternion = Quaternion.RotationYawPitchRoll(longAxis === "x" ? Math.PI / 2 : 0, 0, 0);
  normalize.parent = visual;
  modelSize = `${extent.x.toFixed(2)}×${extent.y.toFixed(2)}×${extent.z.toFixed(2)}`;
  for (const mesh of result.meshes) {
    if (mesh.getTotalVertices?.() > 0) {
      mesh.receiveShadows = true;
      shadows.addShadowCaster(mesh, true);
    }
  }
  console.info(`[Pale Horizon] full-resolution aircraft loaded; source bounds ${modelSize}, scale ${scale.toFixed(4)}.`);
} catch (error) {
  console.error("[Pale Horizon] aircraft load failed", error);
  ui.loadPhase.textContent = "aircraft could not be loaded";
  throw error;
}

const keys = new Set();
let noticeTimer = 0;
const flightSound = createFlightSound({
  assetBase: new URL("audio/flight/", document.baseURI).href,
  autoTouchdown: false,
});
flightSound.preload();

const terrainQuery = {
  heightAt: terrainHeight,
  normalAt: terrainNormal,
  surfaceAt: (x, z) => isRunwaySurface(x, z) ? "runway" : "rough",
};
const flightController = new FlightController({
  terrain: terrainQuery,
  spawnPosition: new Vector3(0, 2.35, -620),
  spawnRotation: Quaternion.Identity(),
  onEvent(type, detail) {
    if (type === "crash") showNotice(`AIRFRAME LOST · ${detail.reason.toUpperCase()} · RESETTING`, 3000);
    if (type === "reset") {
      flightSound.resetState({ onGround: true });
      showNotice("FLIGHT RESET");
    }
    if (type === "landed") {
      flightSound.touchdown(detail.sinkRate);
      showNotice(detail.runway ? "RUNWAY CONTACT" : "FIELD LANDING");
    }
    if (type === "gear") showNotice(detail.down ? "GEAR DOWN" : "GEAR UP");
    if (type === "gear-blocked") {
      showNotice(detail.reason === "overspeed" ? "GEAR LOCKED · SLOW DOWN" : "GEAR LOCKED · WEIGHT ON WHEELS");
    }
  },
});
const flight = flightController.state;

function resetFlight() {
  flightController.reset();
}
function showNotice(text, ms = 1400) {
  ui.notice.textContent = text;
  ui.notice.classList.add("show");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ui.notice.classList.remove("show"), ms);
}
function axes(rotation) {
  const matrix = Matrix.Identity();
  rotation.toRotationMatrix(matrix);
  return {
    right: Vector3.TransformNormal(Vector3.Right(), matrix).normalize(),
    up: Vector3.TransformNormal(Vector3.Up(), matrix).normalize(),
    forward: Vector3.TransformNormal(Vector3.Forward(), matrix).normalize(),
  };
}
const renderPosition = new Vector3();
const renderRotation = Quaternion.Identity();
function updatePresentation(dt) {
  const pose = flightController.getPresentationPose(renderPosition, renderRotation);
  aircraft.position.copyFrom(pose.position);
  aircraft.rotationQuaternion.copyFrom(pose.rotation);
  const basis = axes(pose.rotation);
  const cameraTarget = pose.position.subtract(basis.forward.scale(settings.cameraDistance)).add(Vector3.Up().scale(7.2));
  camera.position.x = damp(camera.position.x, cameraTarget.x, settings.cameraResponse, dt);
  camera.position.y = damp(camera.position.y, cameraTarget.y, settings.cameraResponse, dt);
  camera.position.z = damp(camera.position.z, cameraTarget.z, settings.cameraResponse, dt);
  const look = pose.position.add(basis.forward.scale(12)).add(basis.up.scale(1.2));
  camera.setTarget(look);

  const knots = flight.airspeed * 1.94384;
  const feet = flight.terrainClearance * 3.28084;
  const fpm = flight.verticalSpeed * 196.85;
  ui.speed.textContent = String(Math.round(knots)).padStart(3, "0");
  ui.altitude.textContent = String(Math.round(feet)).padStart(4, "0");
  ui.vertical.textContent = `${fpm >= 0 ? "+" : "−"}${String(Math.round(Math.abs(fpm))).padStart(3, "0")}`;
  ui.throttle.textContent = String(Math.round(flight.throttle * 100)).padStart(2, "0");
  ui.throttleBar.style.width = `${flight.throttle * 100}%`;
  const state = flight.crashed ? "CRASHED" : flight.stall ? "STALL" : flight.onGround ? "GROUND" : "AIR";
  ui.state.textContent = state;
  ui.state.parentElement.classList.toggle("stall", flight.stall);
  ui.state.parentElement.classList.toggle("crashed", flight.crashed);
  ui.gearState.textContent = flight.gear ? "GEAR DOWN" : "GEAR UP";
  const euler = pose.rotation.toEulerAngles();
  ui.horizon.style.transform = `translate(-50%,-50%) rotate(${(-euler.z * 180 / Math.PI).toFixed(2)}deg) translateY(${clamp(euler.x * 34, -24, 24).toFixed(1)}px)`;
  flightSound.update({
    dt,
    throttle: flight.throttle,
    rpm: flight.enginePower,
    airspeed: flight.airspeed,
    groundSpeed: Math.abs(flight.forwardSpeed),
    afterburner: flight.afterburner,
    groundContact: flight.contactCount / 3,
    onGround: flight.onGround,
    verticalSpeed: flight.verticalSpeed,
    crashed: flight.crashed,
    enabled: settings.audio,
  });
}

function setSettingsOpen(open) {
  ui.settings.classList.toggle("open", open);
  ui.settings.setAttribute("aria-hidden", String(!open));
}
function applySettings() {
  engine.setHardwareScalingLevel(1 / settings.quality);
  scene.imageProcessingConfiguration.exposure = settings.exposure;
  scene.fogDensity = settings.fog;
  sun.intensity = settings.sun;
  ui.cameraDistance.value = settings.cameraDistance;
  ui.cameraDistanceOut.value = `${settings.cameraDistance} m`;
  ui.cameraResponse.value = settings.cameraResponse;
  ui.cameraResponseOut.value = settings.cameraResponse.toFixed(1);
  ui.sensitivity.value = settings.sensitivity;
  ui.sensitivityOut.value = settings.sensitivity.toFixed(2);
  ui.sun.value = settings.sun;
  ui.sunOut.value = settings.sun.toFixed(1);
  ui.exposure.value = settings.exposure;
  ui.exposureOut.value = settings.exposure.toFixed(2);
  ui.fog.value = settings.fog;
  ui.fogOut.value = settings.fog.toFixed(5);
  ui.quality.value = String(settings.quality);
  ui.assists.value = settings.assists ? "on" : "off";
  ui.audio.value = settings.audio ? "on" : "off";
  flightSound.setEnabled(settings.audio);
}
function bindRange(id, key, digits = 1, suffix = "") {
  ui[id].addEventListener("input", () => {
    settings[key] = Number(ui[id].value);
    ui[`${id}Out`].value = `${settings[key].toFixed(digits)}${suffix}`;
    applySettings();
  });
}
bindRange("cameraDistance", "cameraDistance", 0, " m");
bindRange("cameraResponse", "cameraResponse", 1);
bindRange("sensitivity", "sensitivity", 2);
bindRange("sun", "sun", 1);
bindRange("exposure", "exposure", 2);
bindRange("fog", "fog", 5);
ui.quality.addEventListener("change", () => { settings.quality = Number(ui.quality.value); applySettings(); });
ui.assists.addEventListener("change", () => { settings.assists = ui.assists.value === "on"; });
ui.audio.addEventListener("change", () => {
  settings.audio = ui.audio.value === "on";
  flightSound.setEnabled(settings.audio);
  if (settings.audio) flightSound.start();
});
ui.settingsButton.addEventListener("click", () => setSettingsOpen(!ui.settings.classList.contains("open")));
ui.closeSettings.addEventListener("click", () => setSettingsOpen(false));
ui.resetDefaults.addEventListener("click", () => { Object.assign(settings, defaults); applySettings(); showNotice("AUTHORED DEFAULTS RESTORED"); });
ui.resetFlight.addEventListener("click", resetFlight);
ui.settings.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });

addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "F1", "Tab"].includes(event.code)) event.preventDefault();
  if (event.code === "Tab") {
    if (!event.repeat) openSansaraSelector("paleHorizon");
    return;
  }
  if (event.code === "F1") { setSettingsOpen(!ui.settings.classList.contains("open")); return; }
  if (event.code === "KeyR") { resetFlight(); return; }
  if (event.code === "KeyG" && !event.repeat) { flightController.toggleGear(); return; }
  keys.add(event.code);
  if (settings.audio) flightSound.start();
});
canvas.addEventListener("pointerdown", () => {
  if (settings.audio) flightSound.start();
});
addEventListener("keyup", (event) => keys.delete(event.code));
addEventListener("blur", () => keys.clear());
addEventListener("resize", () => engine.resize());

applySettings();
aircraft.position.copyFrom(flight.position);
aircraft.rotationQuaternion.copyFrom(flight.rotation);
camera.position.set(0, 9, -650);
camera.setTarget(flight.position);
ui.loading.classList.add("hide");
console.info(`[Pale Horizon] ready; renderer=${engine.getClassName()}, aircraftBounds=${modelSize}`);

scene.onBeforeRenderObservable.add(() => {
  const frame = Math.min(engine.getDeltaTime() / 1000, .05);
  flightController.update(frame, keys, {
    sensitivity: settings.sensitivity,
    assists: settings.assists,
  });
  terrain.update(flight.position);
  updatePresentation(frame);
});
engine.runRenderLoop(() => scene.render());

window.__PALE_HORIZON__ = {
  flight,
  flightController,
  settings,
  reset: resetFlight,
  terrainHeight,
  terrainNormal,
  terrain,
  flightSound,
  renderer: () => engine.getClassName(),
};
