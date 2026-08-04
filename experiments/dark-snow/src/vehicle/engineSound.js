/**
 * Procedural engine + tyre audio for the SUV.
 *
 * No samples, matching the demo's zero-asset ethos: a small oscillator bank
 * whose pitch tracks speed through a fake gearbox, plus a filtered noise bed for
 * tyre/wind. The AudioContext is created lazily on the first drive so it starts
 * inside the `E` key's user gesture (browsers suspend contexts created cold).
 */
export class EngineSound {
    constructor() {
        this.ctx = null;
        this.started = false;
    }

    _ensure() {
        if (this.ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        this.ctx = ctx;

        this.master = ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(ctx.destination);

        // Engine: two detuned sawtooths + a square sub-octave through a lowpass
        // that opens with load. Sawtooths carry the harmonic buzz; the sub gives
        // it weight.
        this.filter = ctx.createBiquadFilter();
        this.filter.type = "lowpass";
        this.filter.frequency.value = 700;
        this.filter.Q.value = 6;
        this.filter.connect(this.master);

        this.oscs = [];
        for (const detune of [-7, 7]) {
            const o = ctx.createOscillator();
            o.type = "sawtooth";
            o.detune.value = detune;
            const g = ctx.createGain();
            g.gain.value = 0.5;
            o.connect(g);
            g.connect(this.filter);
            o.start();
            this.oscs.push(o);
        }
        this.sub = ctx.createOscillator();
        this.sub.type = "square";
        const subGain = ctx.createGain();
        subGain.gain.value = 0.32;
        this.sub.connect(subGain);
        subGain.connect(this.filter);
        this.sub.start();

        // Tyre / wind bed: a looped noise buffer through a bandpass that rises
        // with speed.
        const len = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this.noise = ctx.createBufferSource();
        this.noise.buffer = buf;
        this.noise.loop = true;
        this.noiseFilter = ctx.createBiquadFilter();
        this.noiseFilter.type = "bandpass";
        this.noiseFilter.frequency.value = 1200;
        this.noiseGain = ctx.createGain();
        this.noiseGain.gain.value = 0;
        this.noise.connect(this.noiseFilter);
        this.noiseFilter.connect(this.noiseGain);
        this.noiseGain.connect(this.master);
        this.noise.start();
    }

    /** Fade the engine in — call on entering the car (a user gesture). */
    start() {
        this._ensure();
        if (!this.ctx) return;
        if (this.ctx.state === "suspended") this.ctx.resume();
        this.started = true;
        this.master.gain.setTargetAtTime(1, this.ctx.currentTime, 0.2);
    }

    /** Fade the engine out — call on stepping out. */
    stop() {
        if (!this.ctx || !this.started) return;
        this.started = false;
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    }

    /**
     * @param {number} speed01 0..1 fraction of top speed
     * @param {number} throttle -1..1 damped pedal
     * @param {boolean} grounded
     */
    update(speed01, throttle, grounded) {
        if (!this.ctx || !this.started) return;
        const t = this.ctx.currentTime;

        // Fake 5-speed box: RPM sweeps within a gear then resets, so the pitch
        // rises and drops on upshifts instead of climbing in one long ramp.
        const gears = 5;
        const gear = Math.min(gears - 1, Math.floor(speed01 * gears));
        const within = speed01 * gears - gear;      // 0..1 through the gear
        const rpm = 0.28 + 0.72 * within;           // idle floor to redline
        const freq = 46 * (1 + rpm * 3.2);          // ~46 Hz idle upward
        for (const o of this.oscs) o.frequency.setTargetAtTime(freq, t, 0.04);
        this.sub.frequency.setTargetAtTime(freq * 0.5, t, 0.04);

        const load = Math.max(0, throttle);
        this.filter.frequency.setTargetAtTime(
            500 + 2600 * (rpm * 0.6 + load * 0.4), t, 0.06
        );
        // Engine note eases off in the air (no load on the wheels).
        const airborne = grounded ? 1 : 0.6;
        this.master.gain.setTargetAtTime((0.10 + 0.14 * rpm) * airborne, t, 0.08);

        // Tyre/wind rises with speed and drops when the wheels leave the snow.
        this.noiseGain.gain.setTargetAtTime(
            grounded ? 0.03 + 0.08 * speed01 : 0.01, t, 0.1
        );
        this.noiseFilter.frequency.setTargetAtTime(700 + 1800 * speed01, t, 0.1);
    }

    dispose() {
        if (this.ctx) this.ctx.close();
        this.ctx = null;
    }
}
