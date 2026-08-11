/**
 * Where the SUV meets the snow.
 *
 * The vehicle analogue of SnowContact: while driving it presses four tyre
 * tracks into the terrain deformation buffer and throws snow off the driven
 * wheels, scaled by speed and by how much the car is sliding. Deliberately
 * separate from the physics — the vehicle does not know a deform buffer exists,
 * and this does not know how the vehicle is integrated. Zero allocation per
 * frame: brushes and grains are pushed straight into the shared staging arrays.
 */

const TRACK_WIDTH = 0.16;
const TRACK_ELONG = 1.6;

export class VehicleContact {
    /**
     * @param {import("./vehicle.js").Vehicle} vehicle
     * @param {import("../terrain/deformation.js").DeformationField} field terrain.deform
     * @param {import("../vfx/particles.js").SprayField} [spray]
     */
    constructor(vehicle, field, spray) {
        this.vehicle = vehicle;
        this.field = field;
        this.spray = spray || null;
        this._prevX = vehicle.position.x;
        this._prevZ = vehicle.position.z;
    }

    /** @param {number} dt seconds */
    update(dt) {
        const v = this.vehicle;

        // Keep the travelled distance fresh every frame — including while the
        // player is on foot — so re-entering the car never sees a huge jump.
        const dx = v.position.x - this._prevX;
        const dz = v.position.z - this._prevZ;
        const moved = Math.hypot(dx, dz);
        this._prevX = v.position.x;
        this._prevZ = v.position.z;

        if (!v.active || !v.physics) return;
        const speed = Math.abs(v.speed);
        if (speed < 0.6) return;

        const fx = Math.sin(v.facing);
        const fz = Math.cos(v.facing);
        const rx = Math.cos(v.facing);
        const rz = -Math.sin(v.facing);
        const k = Math.min(moved, 0.4);
        const wheels = v.physics.wheels;
        for (let i = 0; i < 4; i++) {
            const wheel = wheels[i];
            if (!wheel.contact || wheel.normalLoad <= 0) continue;
            const slip = Math.min(1, Math.hypot(
                wheel.longitudinalSlip * 0.75,
                wheel.slipAngle * 2.5
            ));
            this.field.brush(
                wheel.contactPoint.x, wheel.contactPoint.z,
                TRACK_WIDTH,
                (0.05 + 0.06 * slip) * k,
                0.04 * k,
                0.85 * k,
                0,
                v.facing + wheel.steerAngle,
                TRACK_ELONG,
                0.6
            );
        }

        this._kick(fx, fz, rx, rz, speed);
    }

    /**
     * Snow thrown off the driven (rear) wheels — up and back while accelerating,
     * and out to the side as a rooster tail when the car slides.
     */
    _kick(fx, fz, rx, rz, speed) {
        const sp = this.spray;
        if (!sp) return;
        const v = this.vehicle;
        const speed01 = Math.min(1, speed / 16);
        const wheels = v.physics.wheels;

        for (let i = 2; i < 4; i++) {
            const wheel = wheels[i];
            if (!wheel.contact || wheel.normalLoad <= 0) continue;
            const side = wheel.side;
            const slip = Math.min(1, Math.hypot(
                wheel.longitudinalSlip * 0.75,
                wheel.slipAngle * 2.5
            ));
            const n = 2 + ((speed01 * 8 + slip * 16) | 0);
            const cx = wheel.contactPoint.x;
            const cy = wheel.contactPoint.y;
            const cz = wheel.contactPoint.z;

            for (let i = 0; i < n; i++) {
                const up = 0.8 + Math.random() * 1.8 * (0.5 + speed01);
                const back = 1.0 + Math.random() * 2.5 * speed01;
                const out = slip * (2 + Math.random() * 3) * side;
                // A fifth is heavier stuff that flies further and drops faster.
                const clod = Math.random() < 0.2 ? 1 : 0;
                sp.emit(
                    cx + rx * 0.05 * side,
                    cy + 0.04 + Math.random() * 0.05,
                    cz + rz * 0.05 * side,
                    -fx * back + rx * out + v.velocity.x * 0.2,
                    up * (clod ? 1.2 : 1.0),
                    -fz * back + rz * out + v.velocity.z * 0.2,
                    clod ? 0.014 + Math.random() * 0.012 : 0.020 + Math.random() * 0.030,
                    clod ? 0.5 + Math.random() * 0.4 : 0.5 + Math.random() * 0.6,
                    clod
                );
            }
        }
    }
}
