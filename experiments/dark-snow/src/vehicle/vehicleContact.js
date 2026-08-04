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

        if (!v.active || !v.grounded) return;
        const speed = Math.abs(v.speed);
        if (speed < 0.6) return;

        const fx = Math.sin(v.facing);
        const fz = Math.cos(v.facing);
        const rx = Math.cos(v.facing);
        const rz = -Math.sin(v.facing);
        // Sideways velocity component: how hard the car is drifting.
        const lateral = v.velocity.x * rx + v.velocity.z * rz;
        const slip = Math.min(1, Math.abs(lateral) / 5);

        // Four tyre tracks. Scaled by distance travelled, not dt, so a patch of
        // ground ends up at the same depth per metre at any speed or frame rate
        // (identical reasoning to the walking scuff in SnowContact).
        const k = Math.min(moved, 0.4);
        const contacts = [
            [v.frontAxle, v.halfTrack], [v.frontAxle, -v.halfTrack],
            [v.rearAxle, v.halfTrack], [v.rearAxle, -v.halfTrack],
        ];
        for (const [axle, track] of contacts) {
            const cx = v.position.x + fx * axle + rx * track;
            const cz = v.position.z + fz * axle + rz * track;
            this.field.brush(
                cx, cz,
                TRACK_WIDTH,
                (0.05 + 0.06 * slip) * k,   // deeper when the tyre is scrubbing
                0.04 * k,                    // a low berm at the rut edge
                0.85 * k,                    // packed track
                0,                           // no ice
                v.facing,
                TRACK_ELONG,
                0.6                          // tyres tear the edge less than boots
            );
        }

        this._kick(fx, fz, rx, rz, speed, slip);
    }

    /**
     * Snow thrown off the driven (rear) wheels — up and back while accelerating,
     * and out to the side as a rooster tail when the car slides.
     */
    _kick(fx, fz, rx, rz, speed, slip) {
        const sp = this.spray;
        if (!sp) return;
        const v = this.vehicle;
        const speed01 = Math.min(1, speed / 16);
        const n = 2 + ((speed01 * 8 + slip * 16) | 0);

        for (const side of [1, -1]) {
            const cx = v.position.x + fx * v.rearAxle + rx * v.halfTrack * side;
            const cz = v.position.z + fz * v.rearAxle + rz * v.halfTrack * side;
            const cy = v.terrain ? v.terrain.heightAt(cx, cz) : v.position.y;

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
