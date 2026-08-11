/**
 * Recorded SUV audio.
 *
 * A four-second stereo Opel engine loop carries the mechanical detail. Speed,
 * throttle and a smoothed gearbox drive playback rate, tone and load without
 * putting synthetic oscillators back at the centre of the mix.
 */
export class EngineSound {
    constructor() {
        this.ctx = null;
        this.started = false;
        this.loading = null;
        this.engineSource = null;
        this.engineGain = null;
        this.rpm = 0.12;
        this.lastUpdateTime = 0;
    }

    _ensure() {
        if (this.ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        let ctx;
        try { ctx = new AC({ latencyHint: "interactive" }); }
        catch (_) { ctx = new AC(); }
        this.ctx = ctx;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.knee.value = 12;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.008;
        compressor.release.value = 0.18;
        compressor.connect(ctx.destination);

        this.master = ctx.createGain();
        this.master.gain.value = 0.0001;
        this.master.connect(compressor);

        this.engineBus = ctx.createGain();
        this.engineBus.gain.value = 0.72;
        this.engineTone = ctx.createBiquadFilter();
        this.engineTone.type = "lowpass";
        this.engineTone.frequency.value = 2600;
        this.engineTone.Q.value = 0.55;
        this.engineBus.connect(this.engineTone).connect(this.master);

        // A quiet, filtered snow/road bed carries speed without pretending to
        // be the engine. A seeded buffer keeps recordings and tests repeatable.
        const frames = ctx.sampleRate * 2;
        const noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        let seed = 0x51f15e;
        for (let i = 0; i < frames; i++) {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            data[i] = seed / 0x80000000 - 1;
        }
        this.road = ctx.createBufferSource();
        this.road.buffer = noiseBuffer;
        this.road.loop = true;
        this.roadFilter = ctx.createBiquadFilter();
        this.roadFilter.type = "bandpass";
        this.roadFilter.frequency.value = 820;
        this.roadFilter.Q.value = 0.72;
        this.roadGain = ctx.createGain();
        this.roadGain.gain.value = 0;
        this.road.connect(this.roadFilter).connect(this.roadGain).connect(this.master);
        this.road.start();

        this.loading = this._loadRecording().catch((error) => {
            console.warn("[dark-snow] vehicle recording unavailable", error);
        });
    }

    async _loadRecording() {
        const name = "engine-loop.mp3";
        const url = new URL(`audio/vehicle/${name}`, document.baseURI);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
        const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
        if (!this.ctx || this.ctx.state === "closed") return;
        this._startRecording(buffer);
    }

    _startRecording(buffer) {
        this.engineSource = this.ctx.createBufferSource();
        this.engineSource.buffer = buffer;
        this.engineSource.loop = true;
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0.44;
        this.engineSource.connect(this.engineGain).connect(this.engineBus);
        this.engineSource.start();
    }

    /** Call from the E key gesture so Safari can resume audio immediately. */
    start() {
        this._ensure();
        if (!this.ctx) return;
        this.started = true;
        this.ctx.resume().catch(() => {});
        const t = this.ctx.currentTime;
        this.lastUpdateTime = t;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setTargetAtTime(1, t, 0.12);
    }

    stop() {
        if (!this.ctx || !this.started) return;
        this.started = false;
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setTargetAtTime(0.0001, t, 0.18);
    }

    /**
     * @param {number} speed01 fraction of authored top speed
     * @param {number} throttle damped pedal, -1..1
     * @param {boolean} grounded whether any tyre or chassis point has contact
     */
    update(speed01, throttle, grounded) {
        if (!this.ctx || !this.started) return;
        const t = this.ctx.currentTime;
        const dt = Math.max(1 / 240, Math.min(0.1, t - this.lastUpdateTime));
        this.lastUpdateTime = t;
        const pedal = Math.min(1, Math.abs(throttle));
        const gears = 4;
        const gearPosition = Math.min(gears - 0.001, speed01 * gears);
        const withinGear = gearPosition - Math.floor(gearPosition);
        const speedRpm = speed01 < 0.035 ? 0.12 : 0.3 + withinGear * 0.62;
        const rpmTarget = Math.min(1, speedRpm + pedal * (grounded ? 0.16 : 0.27));
        const rpmRate = rpmTarget > this.rpm ? 8.5 : 5.2;
        this.rpm += (rpmTarget - this.rpm) * (1 - Math.exp(-rpmRate * dt));
        if (this.engineSource) {
            this.engineSource.playbackRate.setTargetAtTime(0.7 + this.rpm * 0.7, t, 0.065);
            this.engineGain.gain.setTargetAtTime(0.38 + pedal * 0.18, t, 0.07);
        }
        this.engineBus.gain.setTargetAtTime(0.62 + pedal * 0.24, t, 0.07);
        this.engineTone.frequency.setTargetAtTime(1700 + this.rpm * 3900, t, 0.08);

        const roadLevel = grounded ? 0.008 + speed01 * 0.09 : speed01 * 0.012;
        this.roadGain.gain.setTargetAtTime(roadLevel, t, 0.1);
        this.roadFilter.frequency.setTargetAtTime(620 + speed01 * 1450, t, 0.1);
    }

    dispose() {
        try { this.engineSource?.stop(); } catch (_) { /* already stopped */ }
        try { this.road?.stop(); } catch (_) { /* already stopped */ }
        this.ctx?.close();
        this.ctx = null;
        this.engineSource = null;
        this.engineGain = null;
    }
}
