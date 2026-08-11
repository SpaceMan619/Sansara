import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector.js";

const FIXED_STEP = 1 / 120;
const MAX_STEPS = 12;
const GRAVITY = 9.81;
const AIR_DENSITY_DRAG = 0.42;
const REST_LENGTH = 0.38;
const MAX_COMPRESSION = 0.20;
const MAX_DROOP = 0.14;
const WHEEL_RADIUS = 0.48;
const WHEEL_INERTIA = 1.55;
const SPRING_RATE = 42000;
const DAMP_COMPRESSION = 6500;
const DAMP_REBOUND = 5200;
const BUMP_RATE = 180000;
const ANTI_ROLL = 8000;
const LONG_STIFFNESS = 62000;
const LAT_STIFFNESS = 52000;
const ROLLING_COEFFICIENT = 0.022;
const MAX_STEER_LOW = 0.52;
const MAX_STEER_HIGH = 0.15;
const MAX_REVERSE_SPEED = 8;
const CHASSIS_SKIN = 0.025;
const CHASSIS_FRICTION = 0.46;
const CHASSIS_RESTITUTION = 0.06;
const RECOVERY_CLEARANCE = 0.32;

const _down = new Vector3();
const _forward = new Vector3();
const _right = new Vector3();
const _r = new Vector3();
const _pointVelocity = new Vector3();
const _cross = new Vector3();
const _force = new Vector3();
const _torque = new Vector3();
const _localTorque = new Vector3();
const _localOmega = new Vector3();
const _localGyro = new Vector3();
const _angularAccel = new Vector3();
const _sample = new Vector3();
const _normal = new Vector3();
const _impulseAxis = new Vector3();
const _inertiaTerm = new Vector3();
const _tangent = new Vector3();
const _up = new Vector3();

function makeWheel(x, z, front, side) {
    return {
        localX: x,
        localY: 0,
        localZ: z,
        front,
        side,
        contact: false,
        contactPoint: new Vector3(),
        normal: new Vector3(0, 1, 0),
        hardpoint: new Vector3(),
        centre: new Vector3(),
        compression: -MAX_DROOP,
        suspensionVelocity: 0,
        normalLoad: 0,
        steerAngle: 0,
        angularSpeed: 0,
        rotation: 0,
        longitudinalSlip: 0,
        lateralSlip: 0,
        slipAngle: 0,
        longitudinalSpeed: 0,
        lateralSpeed: 0,
        springForce: 0,
        driveTorque: 0,
        brakeTorque: 0,
    };
}

/** Fixed-step raycast SUV rigid body. Rendering stays in Vehicle. */
export class VehiclePhysics {
    constructor(terrain, position, facing, dimensions) {
        this.terrain = terrain;
        this.position = position;
        // The integrated body origin is its centre of mass; keeping the alias
        // explicit makes force-at-point consumers unambiguous.
        this.centerOfMass = this.position;
        this.quaternion = new Quaternion();
        Quaternion.RotationYawPitchRollToRef(facing, 0, 0, this.quaternion);
        this.velocity = new Vector3();
        this.angularVelocity = new Vector3();
        this.mass = 1500;
        this.invMass = 1 / this.mass;
        this.bodyWidth = Math.max(1.7, dimensions.halfWidth * 1.72);
        this.bodyHeight = 1.42;
        this.bodyLength = Math.max(3.5, dimensions.halfLength * 1.84);
        this.inertia = new Vector3(
            this.mass * (this.bodyHeight ** 2 + this.bodyLength ** 2) / 12,
            this.mass * (this.bodyWidth ** 2 + this.bodyLength ** 2) / 12,
            this.mass * (this.bodyWidth ** 2 + this.bodyHeight ** 2) / 12
        );
        this.invInertia = new Vector3(
            1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z
        );
        this.wheels = [
            makeWheel(dimensions.halfTrack, dimensions.frontAxle, true, 1),
            makeWheel(-dimensions.halfTrack, dimensions.frontAxle, true, -1),
            makeWheel(dimensions.halfTrack, dimensions.rearAxle, false, 1),
            makeWheel(-dimensions.halfTrack, dimensions.rearAxle, false, -1),
        ];
        this.force = new Vector3();
        this.torque = new Vector3();
        this.previousPosition = position.clone();
        this.previousQuaternion = this.quaternion.clone();
        this.visualPosition = position.clone();
        this.visualQuaternion = this.quaternion.clone();
        this.accumulator = 0;
        this.alpha = 0;
        this.grounded = false;
        this.contactCount = 0;
        this.throttle = 0;
        this.steer = 0;
        this.handbrake = false;
        this.chassisContact = false;
        this.recoveredFromUnderworld = false;
        this.maxSpeed = 58 / 3.6;
        this.acceleration = 7.2;
        this.brake = 8.5;
        this.friction = 0.62;

        const halfWidth = this.bodyWidth * 0.5;
        const halfHeight = this.bodyHeight * 0.5;
        const halfLength = this.bodyLength * 0.5;
        this.chassisSamples = [];
        for (const y of [-halfHeight, halfHeight]) {
            for (const x of [-halfWidth, halfWidth]) {
                for (const z of [-halfLength, halfLength]) {
                    this.chassisSamples.push(new Vector3(x, y, z));
                }
            }
        }
        // Edge centres close the gaps that corners alone leave on sharp crests.
        for (const y of [-halfHeight, halfHeight]) {
            this.chassisSamples.push(
                new Vector3(0, y, -halfLength), new Vector3(0, y, halfLength),
                new Vector3(-halfWidth, y, 0), new Vector3(halfWidth, y, 0)
            );
        }
        this._deepestPoint = new Vector3();
        this._deepestNormal = new Vector3(0, 1, 0);
    }

    setTuning(maxSpeedKmh, acceleration, brake, friction) {
        this.maxSpeed = Math.max(1, maxSpeedKmh / 3.6);
        this.acceleration = acceleration;
        this.brake = brake;
        this.friction = friction;
    }

    update(dt, throttle, steer, handbrake) {
        this.throttle = throttle;
        this.steer = steer;
        this.handbrake = handbrake;
        this.accumulator = Math.min(this.accumulator + Math.min(dt, 0.1), FIXED_STEP * MAX_STEPS);
        let steps = 0;
        while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS) {
            this.previousPosition.copyFrom(this.position);
            this.previousQuaternion.copyFrom(this.quaternion);
            this._step(FIXED_STEP);
            this.accumulator -= FIXED_STEP;
            steps++;
        }
        this.alpha = this.accumulator / FIXED_STEP;
        Vector3.LerpToRef(this.previousPosition, this.position, this.alpha, this.visualPosition);
        Quaternion.SlerpToRef(
            this.previousQuaternion, this.quaternion, this.alpha, this.visualQuaternion
        );
    }

    settleOnTerrain(clearance) {
        this.position.y = this.terrain.heightAt(this.position.x, this.position.z)
            + WHEEL_RADIUS + REST_LENGTH;
        this.previousPosition.copyFrom(this.position);
        this.visualPosition.copyFrom(this.position);
        for (let i = 0; i < 180; i++) this._step(FIXED_STEP);
        this.velocity.setAll(0);
        this.angularVelocity.setAll(0);
        this.previousPosition.copyFrom(this.position);
        this.previousQuaternion.copyFrom(this.quaternion);
        this.visualPosition.copyFrom(this.position);
        this.visualQuaternion.copyFrom(this.quaternion);
        this.modelYOffset = clearance - (WHEEL_RADIUS + REST_LENGTH);
    }

    /** Put the body above the local terrain with a clean upright yaw. */
    resetUpright() {
        this._placeUpright(RECOVERY_CLEARANCE);
        this.accumulator = 0;
        this.alpha = 0;
        this.previousPosition.copyFrom(this.position);
        this.previousQuaternion.copyFrom(this.quaternion);
        this.visualPosition.copyFrom(this.position);
        this.visualQuaternion.copyFrom(this.quaternion);
    }

    isUpright() {
        rotateToRef(this.quaternion, 0, 1, 0, _up);
        return _up.y > 0.42;
    }

    needsRecovery() {
        if (!this._stateIsFinite()) return true;
        const ground = this.terrain.heightAt(this.position.x, this.position.z);
        return !Number.isFinite(ground)
            || !this.isUpright()
            || this.position.y < ground - 0.2
            || this._minimumChassisClearance() < -CHASSIS_SKIN;
    }

    _step(h) {
        const centreGround = this.terrain.heightAt(this.position.x, this.position.z);
        const invalid = !this._stateIsFinite()
            || !Number.isFinite(centreGround);
        if (invalid || this.position.y < centreGround - this.bodyHeight * 1.5) {
            // Last-resort guard for corrupted saves or a large browser hitch. The
            // regular chassis solver below handles normal flips and landings.
            this._placeUpright(RECOVERY_CLEARANCE);
            this.recoveredFromUnderworld = true;
            return;
        }
        this.recoveredFromUnderworld = false;
        this.force.set(0, -this.mass * GRAVITY, 0);
        this.torque.setAll(0);
        rotateToRef(this.quaternion, 0, -1, 0, _down);
        rotateToRef(this.quaternion, 0, 0, 1, _forward);
        rotateToRef(this.quaternion, 1, 0, 0, _right);

        const forwardSpeed = Vector3.Dot(this.velocity, _forward);
        const speedRatio = Math.min(1, Math.abs(forwardSpeed) / this.maxSpeed);
        const steerLimit = MAX_STEER_LOW + (MAX_STEER_HIGH - MAX_STEER_LOW) * speedRatio;
        const steerAngle = this.steer * steerLimit;
        const driveInput = Math.abs(this.throttle) > 0.02 ? this.throttle : 0;
        const opposing = driveInput !== 0 && forwardSpeed * driveInput < -0.5;
        const speedLimited = (driveInput > 0 && forwardSpeed >= this.maxSpeed)
            || (driveInput < 0 && forwardSpeed <= -MAX_REVERSE_SPEED);
        // A real SUV needs launch torque before the speed-based power taper
        // takes over. The old curve started fading almost immediately and the
        // 1,500 kg body felt stuck even at full pedal.
        const torqueBand = 1 - 0.72 * speedRatio ** 1.85;
        const launchBoost = 1 + 0.55 * (1 - smoothstep(0.10, 0.38, speedRatio));
        const engineForce = this.mass * this.acceleration * torqueBand * launchBoost;
        const totalDriveTorque = opposing || speedLimited
            ? 0 : engineForce * WHEEL_RADIUS * driveInput;
        const serviceBrake = opposing ? Math.abs(driveInput) : 0;

        this.contactCount = 0;
        for (let i = 0; i < 4; i++) {
            const wheel = this.wheels[i];
            wheel.steerAngle = wheel.front ? steerAngle : 0;
            wheel.driveTorque = totalDriveTorque * 0.25;
            wheel.brakeTorque = this.mass * this.brake * WHEEL_RADIUS * serviceBrake * 0.25;
            if (this.handbrake && !wheel.front) {
                wheel.brakeTorque += this.mass * 13 * WHEEL_RADIUS * 0.5;
            }
            this._castWheel(wheel, h);
            if (wheel.contact) this.contactCount++;
        }
        this.grounded = this.contactCount > 0;

        this._antiRoll(0, 1);
        this._antiRoll(2, 3);
        for (let i = 0; i < 4; i++) this._applyWheel(this.wheels[i], h);

        const speed = this.velocity.length();
        if (speed > 0.01) {
            const drag = AIR_DENSITY_DRAG * speed;
            this.force.x -= this.velocity.x * drag;
            this.force.y -= this.velocity.y * drag;
            this.force.z -= this.velocity.z * drag;
        }

        this.velocity.x += this.force.x * this.invMass * h;
        this.velocity.y += this.force.y * this.invMass * h;
        this.velocity.z += this.force.z * this.invMass * h;
        this.position.x += this.velocity.x * h;
        this.position.y += this.velocity.y * h;
        this.position.z += this.velocity.z * h;
        this._integrateAngular(h);
        this._solveChassisTerrain(h);
        this.grounded = this.contactCount > 0 || this.chassisContact;
    }

    /**
     * Terrain collision for the body itself. Suspension rays cannot protect an
     * upside-down roof or an underbody landing, so a small oriented box is
     * sampled against the same authoritative CPU heightfield as the tyres.
     */
    _solveChassisTerrain(h) {
        this.chassisContact = false;
        for (let pass = 0; pass < 4; pass++) {
            let deepest = 0;
            for (const local of this.chassisSamples) {
                rotateVectorToRef(this.quaternion, local, _sample);
                _sample.addInPlace(this.position);
                const terrainY = this.terrain.heightAt(_sample.x, _sample.z);
                const penetration = terrainY + CHASSIS_SKIN - _sample.y;
                if (penetration <= deepest) continue;
                deepest = penetration;
                this._deepestPoint.set(_sample.x, terrainY, _sample.z);
                this.terrain.normalAt(_sample.x, _sample.z, this._deepestNormal);
            }
            if (deepest <= 0) break;

            this.chassisContact = true;
            _normal.copyFrom(this._deepestNormal).normalize();
            // Resolve most of the overlap immediately. The velocity impulse
            // below removes the closing motion and carries the remaining slop.
            const correction = Math.max(0, deepest - 0.002) * 0.88;
            this.position.x += _normal.x * correction;
            this.position.y += _normal.y * correction;
            this.position.z += _normal.z * correction;
            this._applyChassisImpulse(this._deepestPoint, _normal, deepest, h);
        }
    }

    _applyChassisImpulse(point, normal, penetration, h) {
        _r.set(
            point.x - this.position.x,
            point.y - this.position.y,
            point.z - this.position.z
        );
        Vector3.CrossToRef(this.angularVelocity, _r, _cross);
        _pointVelocity.set(
            this.velocity.x + _cross.x,
            this.velocity.y + _cross.y,
            this.velocity.z + _cross.z
        );
        const normalSpeed = Vector3.Dot(_pointVelocity, normal);
        Vector3.CrossToRef(_r, normal, _impulseAxis);
        this._worldInvInertia(_impulseAxis, _inertiaTerm);
        Vector3.CrossToRef(_inertiaTerm, _r, _cross);
        const denominator = this.invMass + Vector3.Dot(normal, _cross);
        if (denominator <= 1e-8) return;

        const separation = Math.min(2.2, penetration * 0.16 / h);
        const bounce = normalSpeed < -1.5 ? -normalSpeed * CHASSIS_RESTITUTION : 0;
        const normalImpulse = Math.max(0, (Math.max(separation, bounce) - normalSpeed)
            / denominator);
        if (normalImpulse <= 0) return;
        this.velocity.x += normal.x * normalImpulse * this.invMass;
        this.velocity.y += normal.y * normalImpulse * this.invMass;
        this.velocity.z += normal.z * normalImpulse * this.invMass;
        this.angularVelocity.x += _inertiaTerm.x * normalImpulse;
        this.angularVelocity.y += _inertiaTerm.y * normalImpulse;
        this.angularVelocity.z += _inertiaTerm.z * normalImpulse;

        // A bounded tangential impulse stops the roof skating forever without
        // creating the old magnetic-to-ground behaviour in the air.
        Vector3.CrossToRef(this.angularVelocity, _r, _cross);
        _pointVelocity.set(
            this.velocity.x + _cross.x,
            this.velocity.y + _cross.y,
            this.velocity.z + _cross.z
        );
        const vn = Vector3.Dot(_pointVelocity, normal);
        _tangent.set(
            _pointVelocity.x - normal.x * vn,
            _pointVelocity.y - normal.y * vn,
            _pointVelocity.z - normal.z * vn
        );
        const tangentSpeed = _tangent.length();
        if (tangentSpeed < 1e-5) return;
        _tangent.scaleInPlace(1 / tangentSpeed);
        Vector3.CrossToRef(_r, _tangent, _impulseAxis);
        this._worldInvInertia(_impulseAxis, _inertiaTerm);
        Vector3.CrossToRef(_inertiaTerm, _r, _cross);
        const tangentDenominator = this.invMass + Vector3.Dot(_tangent, _cross);
        if (tangentDenominator <= 1e-8) return;
        const frictionImpulse = clamp(
            -tangentSpeed / tangentDenominator,
            -normalImpulse * CHASSIS_FRICTION,
            normalImpulse * CHASSIS_FRICTION
        );
        this.velocity.x += _tangent.x * frictionImpulse * this.invMass;
        this.velocity.y += _tangent.y * frictionImpulse * this.invMass;
        this.velocity.z += _tangent.z * frictionImpulse * this.invMass;
        this.angularVelocity.x += _inertiaTerm.x * frictionImpulse;
        this.angularVelocity.y += _inertiaTerm.y * frictionImpulse;
        this.angularVelocity.z += _inertiaTerm.z * frictionImpulse;
    }

    _worldInvInertia(vector, out) {
        inverseRotateToRef(this.quaternion, vector, _localTorque);
        _localTorque.set(
            _localTorque.x * this.invInertia.x,
            _localTorque.y * this.invInertia.y,
            _localTorque.z * this.invInertia.z
        );
        rotateVectorToRef(this.quaternion, _localTorque, out);
    }

    _stateIsFinite() {
        return Number.isFinite(this.position.x)
            && Number.isFinite(this.position.y)
            && Number.isFinite(this.position.z)
            && Number.isFinite(this.velocity.x)
            && Number.isFinite(this.velocity.y)
            && Number.isFinite(this.velocity.z)
            && Number.isFinite(this.angularVelocity.x)
            && Number.isFinite(this.angularVelocity.y)
            && Number.isFinite(this.angularVelocity.z)
            && Number.isFinite(this.quaternion.x)
            && Number.isFinite(this.quaternion.y)
            && Number.isFinite(this.quaternion.z)
            && Number.isFinite(this.quaternion.w);
    }

    _minimumChassisClearance() {
        let minimum = Infinity;
        for (const local of this.chassisSamples) {
            rotateVectorToRef(this.quaternion, local, _sample);
            const x = this.position.x + _sample.x;
            const z = this.position.z + _sample.z;
            const terrainY = this.terrain.heightAt(x, z);
            if (!Number.isFinite(terrainY)) return -Infinity;
            minimum = Math.min(minimum, this.position.y + _sample.y - terrainY);
        }
        return minimum;
    }

    _placeUpright(clearance) {
        if (!Number.isFinite(this.position.x)) this.position.x = 0;
        if (!Number.isFinite(this.position.z)) this.position.z = 0;
        rotateToRef(this.quaternion, 0, 0, 1, _forward);
        let yaw = Math.atan2(_forward.x, _forward.z);
        if (!Number.isFinite(yaw)) yaw = 0;
        const ground = this.terrain.heightAt(this.position.x, this.position.z);
        const safeGround = Number.isFinite(ground) ? ground : 0;
        Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, this.quaternion);
        this.position.y = safeGround + WHEEL_RADIUS + REST_LENGTH + clearance;
        for (const local of this.chassisSamples) {
            rotateVectorToRef(this.quaternion, local, _sample);
            const terrainY = this.terrain.heightAt(
                this.position.x + _sample.x, this.position.z + _sample.z
            );
            if (!Number.isFinite(terrainY)) continue;
            this.position.y = Math.max(
                this.position.y, terrainY + CHASSIS_SKIN - _sample.y
            );
        }
        this.velocity.setAll(0);
        this.angularVelocity.setAll(0);
        this.force.setAll(0);
        this.torque.setAll(0);
        this.contactCount = 0;
        this.chassisContact = false;
        this.grounded = false;
        for (const wheel of this.wheels) {
            wheel.contact = false;
            wheel.normalLoad = 0;
            wheel.springForce = 0;
            wheel.angularSpeed = 0;
            wheel.longitudinalSlip = 0;
            wheel.lateralSlip = 0;
            wheel.slipAngle = 0;
        }
    }

    _castWheel(wheel, h) {
        rotateToRef(
            this.quaternion, wheel.localX, wheel.localY, wheel.localZ, _r
        );
        wheel.hardpoint.set(
            this.position.x + _r.x,
            this.position.y + _r.y,
            this.position.z + _r.z
        );
        let distance = (wheel.hardpoint.y
            - this.terrain.heightAt(wheel.hardpoint.x, wheel.hardpoint.z))
            / Math.max(0.2, -_down.y);
        for (let j = 0; j < 2; j++) {
            const sx = wheel.hardpoint.x + _down.x * distance;
            const sz = wheel.hardpoint.z + _down.z * distance;
            distance = (wheel.hardpoint.y - this.terrain.heightAt(sx, sz))
                / Math.max(0.2, -_down.y);
        }
        const maxRay = WHEEL_RADIUS + REST_LENGTH + MAX_DROOP;
        const wasCompression = wheel.compression;
        wheel.contact = distance >= 0 && distance <= maxRay;
        if (!wheel.contact) {
            wheel.compression = -MAX_DROOP;
            wheel.suspensionVelocity = (wheel.compression - wasCompression) / h;
            wheel.normalLoad = 0;
            wheel.springForce = 0;
            wheel.longitudinalSlip = 0;
            wheel.lateralSlip = 0;
            wheel.slipAngle = 0;
            wheel.centre.set(
                wheel.hardpoint.x + _down.x * (REST_LENGTH + MAX_DROOP),
                wheel.hardpoint.y + _down.y * (REST_LENGTH + MAX_DROOP),
                wheel.hardpoint.z + _down.z * (REST_LENGTH + MAX_DROOP)
            );
            return;
        }
        const length = clamp(distance - WHEEL_RADIUS, REST_LENGTH - MAX_COMPRESSION,
            REST_LENGTH + MAX_DROOP);
        wheel.compression = REST_LENGTH - length;
        wheel.suspensionVelocity = (wheel.compression - wasCompression) / h;
        wheel.contactPoint.set(
            wheel.hardpoint.x + _down.x * distance,
            wheel.hardpoint.y + _down.y * distance,
            wheel.hardpoint.z + _down.z * distance
        );
        this.terrain.normalAt(wheel.contactPoint.x, wheel.contactPoint.z, wheel.normal);
        wheel.centre.set(
            wheel.contactPoint.x + wheel.normal.x * WHEEL_RADIUS,
            wheel.contactPoint.y + wheel.normal.y * WHEEL_RADIUS,
            wheel.contactPoint.z + wheel.normal.z * WHEEL_RADIUS
        );
        const damping = wheel.suspensionVelocity >= 0 ? DAMP_COMPRESSION : DAMP_REBOUND;
        let spring = SPRING_RATE * wheel.compression + damping * wheel.suspensionVelocity;
        const bumpStart = MAX_COMPRESSION * 0.72;
        if (wheel.compression > bumpStart) {
            const bump = wheel.compression - bumpStart;
            spring += BUMP_RATE * bump * bump / (MAX_COMPRESSION - bumpStart);
        }
        wheel.springForce = Math.max(0, spring);
        wheel.normalLoad = wheel.springForce;
    }

    _antiRoll(a, b) {
        const left = this.wheels[a];
        const right = this.wheels[b];
        if (!left.contact && !right.contact) return;
        const anti = (left.compression - right.compression) * ANTI_ROLL;
        if (left.contact) left.normalLoad = Math.max(0, left.normalLoad - anti);
        if (right.contact) right.normalLoad = Math.max(0, right.normalLoad + anti);
    }

    _applyWheel(wheel, h) {
        if (!wheel.contact) {
            wheel.angularSpeed += wheel.driveTorque / WHEEL_INERTIA * h;
            wheel.angularSpeed = approachZero(
                wheel.angularSpeed, wheel.brakeTorque / WHEEL_INERTIA * h
            );
            wheel.angularSpeed *= Math.exp(-0.15 * h);
            wheel.rotation += wheel.angularSpeed * h;
            return;
        }

        _force.set(
            wheel.normal.x * wheel.normalLoad,
            wheel.normal.y * wheel.normalLoad,
            wheel.normal.z * wheel.normalLoad
        );
        this._forceAtPoint(_force, wheel.contactPoint);

        rotateToRef(this.quaternion, Math.sin(wheel.steerAngle), 0,
            Math.cos(wheel.steerAngle), _forward);
        const normalDot = Vector3.Dot(_forward, wheel.normal);
        _forward.x -= wheel.normal.x * normalDot;
        _forward.y -= wheel.normal.y * normalDot;
        _forward.z -= wheel.normal.z * normalDot;
        _forward.normalize();
        Vector3.CrossToRef(wheel.normal, _forward, _right);
        _right.normalize();

        _r.set(
            wheel.contactPoint.x - this.position.x,
            wheel.contactPoint.y - this.position.y,
            wheel.contactPoint.z - this.position.z
        );
        Vector3.CrossToRef(this.angularVelocity, _r, _cross);
        _pointVelocity.set(
            this.velocity.x + _cross.x,
            this.velocity.y + _cross.y,
            this.velocity.z + _cross.z
        );
        const vx = Vector3.Dot(_pointVelocity, _forward);
        const vy = Vector3.Dot(_pointVelocity, _right);
        wheel.longitudinalSpeed = vx;
        wheel.lateralSpeed = vy;
        wheel.longitudinalSlip = (wheel.angularSpeed * WHEEL_RADIUS - vx)
            / Math.max(2, Math.abs(vx));
        wheel.slipAngle = Math.atan2(vy, Math.max(1, Math.abs(vx)));
        wheel.lateralSlip = vy;

        let fx = LONG_STIFFNESS * wheel.longitudinalSlip;
        let fy = -LAT_STIFFNESS * wheel.slipAngle;
        const limit = this.friction * wheel.normalLoad;
        const demand = Math.hypot(fx, fy);
        if (demand > limit && demand > 0) {
            const scale = limit / demand;
            fx *= scale;
            fy *= scale;
        }
        if (Math.abs(vx) > 0.05) fx -= Math.sign(vx) * ROLLING_COEFFICIENT * wheel.normalLoad;
        _force.set(
            _forward.x * fx + _right.x * fy,
            _forward.y * fx + _right.y * fy,
            _forward.z * fx + _right.z * fy
        );
        this._forceAtPoint(_force, wheel.contactPoint);

        wheel.angularSpeed += (wheel.driveTorque - fx * WHEEL_RADIUS)
            / WHEEL_INERTIA * h;
        wheel.angularSpeed = approachZero(
            wheel.angularSpeed, wheel.brakeTorque / WHEEL_INERTIA * h
        );
        wheel.rotation += wheel.angularSpeed * h;
    }

    _forceAtPoint(force, point) {
        this.force.addInPlace(force);
        _r.set(point.x - this.position.x, point.y - this.position.y, point.z - this.position.z);
        Vector3.CrossToRef(_r, force, _cross);
        this.torque.addInPlace(_cross);
    }

    _integrateAngular(h) {
        inverseRotateToRef(this.quaternion, this.angularVelocity, _localOmega);
        inverseRotateToRef(this.quaternion, this.torque, _localTorque);
        _localGyro.set(
            _localOmega.y * this.inertia.z * _localOmega.z
                - _localOmega.z * this.inertia.y * _localOmega.y,
            _localOmega.z * this.inertia.x * _localOmega.x
                - _localOmega.x * this.inertia.z * _localOmega.z,
            _localOmega.x * this.inertia.y * _localOmega.y
                - _localOmega.y * this.inertia.x * _localOmega.x
        );
        _localTorque.subtractInPlace(_localGyro);
        _angularAccel.set(
            _localTorque.x * this.invInertia.x,
            _localTorque.y * this.invInertia.y,
            _localTorque.z * this.invInertia.z
        );
        rotateVectorToRef(this.quaternion, _angularAccel, _torque);
        this.angularVelocity.x += _torque.x * h;
        this.angularVelocity.y += _torque.y * h;
        this.angularVelocity.z += _torque.z * h;
        const angularDamping = Math.exp(-0.025 * h);
        this.angularVelocity.scaleInPlace(angularDamping);
        integrateQuaternion(this.quaternion, this.angularVelocity, h);
    }
}

export const VEHICLE_WHEEL_RADIUS = WHEEL_RADIUS;
export const VEHICLE_SUSPENSION_REST = REST_LENGTH;
export const VEHICLE_SUSPENSION_DROOP = MAX_DROOP;

function approachZero(value, amount) {
    if (value > 0) return Math.max(0, value - amount);
    if (value < 0) return Math.min(0, value + amount);
    return 0;
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function smoothstep(lo, hi, value) {
    const t = clamp((value - lo) / Math.max(1e-6, hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
}

function rotateToRef(q, x, y, z, out) {
    const ix = q.w * x + q.y * z - q.z * y;
    const iy = q.w * y + q.z * x - q.x * z;
    const iz = q.w * z + q.x * y - q.y * x;
    const iw = -q.x * x - q.y * y - q.z * z;
    out.set(
        ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
        iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
        iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
    );
}

function rotateVectorToRef(q, v, out) {
    rotateToRef(q, v.x, v.y, v.z, out);
}

function inverseRotateToRef(q, v, out) {
    const x = -q.x;
    const y = -q.y;
    const z = -q.z;
    const ix = q.w * v.x + y * v.z - z * v.y;
    const iy = q.w * v.y + z * v.x - x * v.z;
    const iz = q.w * v.z + x * v.y - y * v.x;
    const iw = -x * v.x - y * v.y - z * v.z;
    out.set(
        ix * q.w + iw * -x + iy * -z - iz * -y,
        iy * q.w + iw * -y + iz * -x - ix * -z,
        iz * q.w + iw * -z + ix * -y - iy * -x
    );
}

function integrateQuaternion(q, omega, h) {
    const hx = omega.x * h * 0.5;
    const hy = omega.y * h * 0.5;
    const hz = omega.z * h * 0.5;
    const x = q.x;
    const y = q.y;
    const z = q.z;
    const w = q.w;
    q.x += hx * w + hy * z - hz * y;
    q.y += hy * w + hz * x - hx * z;
    q.z += hz * w + hx * y - hy * x;
    q.w += -hx * x - hy * y - hz * z;
    q.normalize();
}
