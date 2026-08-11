const DEFAULT_ASSET_BASE = "./audio/flight/";

const FILES = Object.freeze({
  engine: "engine-core-loop.mp3",
  airflow: "airflow-loop.mp3",
  afterburner: "afterburner-loop.mp3",
  runway: "runway-roll-loop.mp3",
  touchdown: "touchdown.mp3",
});

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const damp = (current, target, rate, dt) =>
  current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)));

function makeBaseUrl(value) {
  const base = value || DEFAULT_ASSET_BASE;
  return base.endsWith("/") ? base : `${base}/`;
}

/**
 * Layered, non-spatial cockpit/exterior flight sound for Pale Horizon.
 *
 * The controller owns no flight physics. Feed it normalized throttle/RPM plus
 * physical airspeed and ground state once per rendered frame. RPM is optional;
 * when omitted, the controller models turbine spool lag from throttle.
 */
export class FlightSound {
  constructor({
    assetBase = DEFAULT_ASSET_BASE,
    context = null,
    destination = null,
    volume = 0.72,
    autoTouchdown = true,
  } = {}) {
    this.assetBase = makeBaseUrl(assetBase);
    this.context = context;
    this.destination = destination;
    this.volume = clamp01(volume);
    this.autoTouchdown = Boolean(autoTouchdown);
    this.enabled = true;
    this.started = false;
    this.disposed = false;

    this.raw = new Map();
    this.buffers = new Map();
    this.loadErrors = new Map();
    this.sources = new Map();
    this.nodes = {};

    this.spool = 0.12;
    this.burnerMix = 0;
    this.lastState = {
      dt: 1 / 60,
      throttle: 0,
      rpm: null,
      airspeed: 0,
      groundSpeed: 0,
      afterburner: 0,
      groundContact: 1,
      onGround: true,
      verticalSpeed: 0,
      crashed: false,
      enabled: true,
    };
    this.wasOnGround = null;
    this.previousVerticalSpeed = 0;
    this.preloadPromise = null;
    this.startPromise = null;
  }

  /** Fetches files without creating or resuming an AudioContext. */
  preload() {
    if (this.preloadPromise) return this.preloadPromise;
    this.preloadPromise = Promise.allSettled(
      Object.entries(FILES).map(async ([name, file]) => {
        const response = await fetch(`${this.assetBase}${file}`);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        this.raw.set(name, await response.arrayBuffer());
      }),
    ).then((results) => {
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const name = Object.keys(FILES)[index];
          this.loadErrors.set(name, result.reason);
          console.warn(`[Pale Horizon audio] ${name} layer unavailable`, result.reason);
        }
      });
      return this.raw.size;
    });
    return this.preloadPromise;
  }

  /** Call from a user gesture. Safe to call more than once. */
  start() {
    if (this.disposed) return Promise.resolve(false);
    if (this.startPromise) {
      const resume = this.context?.state === "suspended"
        ? this.context.resume().catch(() => undefined)
        : Promise.resolve();
      return Promise.all([this.startPromise, resume]).then(([started]) => started);
    }

    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!this.context && !AudioContextClass) {
      this.loadErrors.set("context", new Error("Web Audio is unavailable"));
      return Promise.resolve(false);
    }
    this.context ||= new AudioContextClass({ latencyHint: "interactive" });
    const resume = this.context.state === "suspended"
      ? this.context.resume().catch(() => undefined)
      : Promise.resolve();

    this.startPromise = Promise.all([resume, this.preload()])
      .then(() => this.#decode())
      .then(() => {
        if (this.disposed || this.started) return !this.disposed;
        this.#buildGraph();
        this.started = true;
        this.#apply(this.lastState, true);
        return true;
      })
      .catch((error) => {
        this.loadErrors.set("start", error);
        console.warn("[Pale Horizon audio] flight mix could not start", error);
        this.startPromise = null;
        return false;
      });
    return this.startPromise;
  }

  async #decode() {
    await Promise.all([...this.raw].map(async ([name, bytes]) => {
      if (this.buffers.has(name)) return;
      try {
        this.buffers.set(name, await this.context.decodeAudioData(bytes.slice(0)));
      } catch (error) {
        this.loadErrors.set(name, error);
        console.warn(`[Pale Horizon audio] ${name} layer could not decode`, error);
      }
    }));
  }

  #buildGraph() {
    const ctx = this.context;
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    master.gain.value = 0;
    compressor.threshold.value = -13;
    compressor.knee.value = 16;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;
    master.connect(compressor).connect(this.destination || ctx.destination);
    this.nodes.master = master;
    this.nodes.compressor = compressor;

    this.#createLoop("engine", {
      gain: 0,
      filterType: "lowpass",
      filterFrequency: 1800,
      filterQ: 0.35,
    });
    this.#createLoop("airflow", {
      gain: 0,
      filterType: "highpass",
      filterFrequency: 170,
      filterQ: 0.3,
    });
    this.#createLoop("afterburner", {
      gain: 0,
      filterType: "lowpass",
      filterFrequency: 5200,
      filterQ: 0.25,
    });
    this.#createLoop("runway", {
      gain: 0,
      filterType: "lowpass",
      filterFrequency: 2600,
      filterQ: 0.45,
    });

    // A restrained turbine fundamental fills the hole below the recorded core.
    // It stays quiet enough that the sample, not the oscillator, defines the jet.
    const turbine = ctx.createOscillator();
    const turbineFilter = ctx.createBiquadFilter();
    const turbineGain = ctx.createGain();
    turbine.type = "triangle";
    turbine.frequency.value = 54;
    turbineFilter.type = "lowpass";
    turbineFilter.frequency.value = 240;
    turbineGain.gain.value = 0;
    turbine.connect(turbineFilter).connect(turbineGain).connect(master);
    turbine.start();
    this.nodes.turbine = turbine;
    this.nodes.turbineFilter = turbineFilter;
    this.nodes.turbineGain = turbineGain;
  }

  #createLoop(name, { gain, filterType, filterFrequency, filterQ }) {
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const ctx = this.context;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const layerGain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = filterType;
    filter.frequency.value = filterFrequency;
    filter.Q.value = filterQ;
    layerGain.gain.value = gain;
    source.connect(filter).connect(layerGain).connect(this.nodes.master);
    source.start();
    this.sources.set(name, source);
    this.nodes[`${name}Filter`] = filter;
    this.nodes[`${name}Gain`] = layerGain;
  }

  /**
   * @param {object} state
   * @param {number} state.dt Frame delta in seconds.
   * @param {number} state.throttle Normalized 0..1 throttle.
   * @param {number|null} [state.rpm] Optional normalized engine RPM/spool.
   * @param {number} state.airspeed Airspeed in metres per second.
   * @param {number} [state.groundSpeed] Ground speed in metres per second.
   * @param {boolean|number} state.afterburner Boolean or normalized burner mix.
   * @param {boolean|number} [state.groundContact] Wheel contact amount.
   * @param {boolean} state.onGround Whether the undercarriage touches terrain.
   * @param {number} state.verticalSpeed Vertical speed in metres per second.
   * @param {boolean} [state.crashed] Mutes sustained flight layers when true.
   * @param {boolean} [state.enabled] Master sound setting.
   */
  update(state = {}) {
    const next = { ...this.lastState, ...state };
    next.dt = Math.min(0.1, Math.max(0, Number(next.dt) || 0));
    next.throttle = clamp01(next.throttle);
    next.airspeed = Math.max(0, Number(next.airspeed) || 0);
    next.groundSpeed = Math.max(0, Number(next.groundSpeed ?? next.airspeed) || 0);
    next.afterburner = typeof next.afterburner === "boolean"
      ? Number(next.afterburner)
      : clamp01(next.afterburner);
    next.groundContact = next.groundContact == null
      ? Number(Boolean(next.onGround))
      : clamp01(next.groundContact);
    this.lastState = next;

    if (this.autoTouchdown && this.wasOnGround === false && next.onGround && !next.crashed) {
      this.touchdown(Math.max(0, -this.previousVerticalSpeed));
    }
    this.wasOnGround = Boolean(next.onGround);
    this.previousVerticalSpeed = Number(next.verticalSpeed) || 0;

    const rpmTarget = next.rpm == null
      ? 0.1 + next.throttle * 0.9
      : clamp01(next.rpm);
    const spoolRate = rpmTarget > this.spool ? 1.45 : 0.72;
    this.spool = damp(this.spool, rpmTarget, spoolRate, next.dt);
    this.burnerMix = damp(this.burnerMix, next.afterburner, 4.8, next.dt);

    if (this.started) this.#apply(next, false);
  }

  #apply(state, immediate) {
    const ctx = this.context;
    const now = ctx.currentTime;
    const timeConstant = immediate ? 0.008 : 0.06;
    const audible = this.enabled && state.enabled !== false && !state.crashed;
    const spool = this.spool;
    const speedMix = smoothstep(28, 285, state.airspeed);
    const runwayMix = state.groundContact * smoothstep(3, 82, state.groundSpeed);

    this.#target(this.nodes.master?.gain, audible ? this.volume : 0, now, 0.08);
    this.#target(this.nodes.engineGain?.gain, 0.075 + spool * 0.28, now, timeConstant);
    this.#target(this.sources.get("engine")?.playbackRate, 0.68 + spool * 0.68, now, 0.075);
    this.#target(this.nodes.engineFilter?.frequency, 1200 + spool * 5700, now, 0.09);

    this.#target(this.nodes.airflowGain?.gain, speedMix * (0.03 + speedMix * 0.29), now, 0.11);
    this.#target(this.sources.get("airflow")?.playbackRate, 0.76 + speedMix * 0.58, now, 0.12);
    this.#target(this.nodes.airflowFilter?.frequency, 140 + speedMix * 1050, now, 0.12);

    this.#target(this.nodes.afterburnerGain?.gain, this.burnerMix * 0.38, now, 0.045);
    this.#target(this.sources.get("afterburner")?.playbackRate, 0.82 + spool * 0.34, now, 0.06);
    this.#target(this.nodes.afterburnerFilter?.frequency, 3200 + this.burnerMix * 4200, now, 0.07);

    this.#target(this.nodes.runwayGain?.gain, runwayMix * (0.04 + runwayMix * 0.27), now, 0.035);
    this.#target(this.sources.get("runway")?.playbackRate, 0.62 + smoothstep(0, 90, state.groundSpeed) * 1.12, now, 0.055);
    this.#target(this.nodes.runwayFilter?.frequency, 900 + runwayMix * 3600, now, 0.06);

    this.#target(this.nodes.turbine?.frequency, 48 + spool * 104 + this.burnerMix * 14, now, 0.07);
    this.#target(this.nodes.turbineGain?.gain, (0.004 + spool * 0.018) * (1 - speedMix * 0.35), now, 0.08);
  }

  #target(parameter, value, now, timeConstant) {
    if (!parameter) return;
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(value, now, Math.max(0.005, timeConstant));
  }

  /** Plays a wheel-strike transient. impactMps is downward speed at contact. */
  touchdown(impactMps = 2.5) {
    if (!this.started || !this.enabled || this.lastState.enabled === false) return;
    const buffer = this.buffers.get("touchdown");
    if (!buffer) return;
    const ctx = this.context;
    const impact = smoothstep(0.7, 8.5, Math.max(0, Number(impactMps) || 0));
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = 0.94 + impact * 0.1;
    filter.type = "lowpass";
    filter.frequency.value = 1100 + impact * 1700;
    gain.gain.value = 0.12 + impact * 0.5;
    source.connect(filter).connect(gain).connect(this.nodes.master);
    source.addEventListener("ended", () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    }, { once: true });
    source.start();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.started) this.#apply(this.lastState, false);
  }

  setVolume(volume) {
    this.volume = clamp01(volume);
    if (this.started) this.#apply(this.lastState, false);
  }

  /** Prevents a reset/teleport from being mistaken for a landing. */
  resetState({ onGround = true, verticalSpeed = 0, spool = 0.12 } = {}) {
    this.wasOnGround = Boolean(onGround);
    this.previousVerticalSpeed = Number(verticalSpeed) || 0;
    this.spool = clamp01(spool);
    this.burnerMix = 0;
  }

  diagnostics() {
    return {
      started: this.started,
      contextState: this.context?.state || "unavailable",
      loadedLayers: [...this.buffers.keys()],
      failedLayers: [...this.loadErrors.keys()],
      autoTouchdown: this.autoTouchdown,
      spool: this.spool,
      afterburner: this.burnerMix,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const source of this.sources.values()) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    try { this.nodes.turbine?.stop(); } catch { /* already stopped */ }
    Object.values(this.nodes).forEach((node) => node?.disconnect?.());
    this.sources.clear();
    this.started = false;
  }
}

export function createFlightSound(options) {
  return new FlightSound(options);
}
