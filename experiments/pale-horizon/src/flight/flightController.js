import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";

const RAD = Math.PI / 180;
const RIGHT = new Vector3(1, 0, 0);
const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

/**
 * Numbers in this object use SI units. Keeping them together makes the aircraft
 * tune inspectable without mixing handling changes into the integrator.
 */
export const DEFAULT_FLIGHT_TUNING = Object.freeze({
  fixedStep: 1 / 120,
  maxSubSteps: 8,
  gravity: 9.81,

  mass: 19700,
  wingArea: 78,
  wingSpan: 13.6,
  meanChord: 4.1,
  inertiaPitch: 610000,
  inertiaYaw: 820000,
  inertiaRoll: 185000,

  dryThrust: 214000,
  afterburnerThrust: 312000,
  engineSpoolRate: 1.8,
  throttleUpRate: 0.34,
  throttleDownRate: 0.42,

  zeroLiftAoA: -2 * RAD,
  liftSlope: 4.45,
  maxLift: 1.5,
  stallStart: 16 * RAD,
  stallFull: 29 * RAD,
  baseDrag: 0.024,
  inducedDrag: 0.052,
  stallDrag: 0.52,
  sideDrag: 0.14,

  pitchControl: 0.31,
  yawControl: 0.085,
  rollControl: 0.13,
  pitchDamping: 0.43,
  yawDamping: 0.22,
  rollDamping: 0.085,
  staticAngularDamping: 0.045,
  pitchStability: 0.075,
  yawStability: 0.13,

  gearClearance: 2.48,
  bellyClearance: 1.18,
  gearSpring: 540000,
  gearDamping: 69000,
  gearMaxForce: 510000,
  gearMaxCompression: 0.48,
  tyreSideDamping: 52000,
  tyreFriction: 0.78,
  rollingResistance: 0.018,
  brakeForce: 105000,
  parkingBrakeForce: 16000,
  groundYawMoment: 250000,

  safeSinkRate: 7.2,
  safeBank: 24 * RAD,
  safePitchDown: -5 * RAD,
  safePitchUp: 19 * RAD,
  safeSideSpeed: 14,
  roughGroundSpeed: 34,
  recoveryDelay: 2.6,
});

const GEAR_POINTS = Object.freeze([
  Object.freeze({ name: "nose", local: new Vector3(0, -2.48, 5.35) }),
  Object.freeze({ name: "left-main", local: new Vector3(-2.65, -2.48, -1.7) }),
  Object.freeze({ name: "right-main", local: new Vector3(2.65, -2.48, -1.7) }),
]);

const HULL_PROBES = Object.freeze([
  new Vector3(0, -1.18, 0.2),
  new Vector3(0, -0.75, 8.1),
  new Vector3(0, -0.55, -7.7),
  new Vector3(-6.15, -0.35, -0.3),
  new Vector3(6.15, -0.35, -0.3),
]);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const damp = (current, target, rate, dt) =>
  target + (current - target) * Math.exp(-rate * dt);
const smoothstep = (a, b, value) => {
  const x = clamp((value - a) / Math.max(1e-6, b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

function makeState(position, rotation, tuning) {
  return {
    position: position.clone(),
    rotation: rotation.clone(),
    velocity: new Vector3(),
    // Body-space rates: X pitch, Y yaw, Z roll.
    angularVelocity: new Vector3(),
    mass: tuning.mass,
    throttle: 0,
    enginePower: 0,
    afterburner: false,
    brake: false,
    gear: true,
    onGround: true,
    contactCount: 3,
    crashed: false,
    crashReason: "",
    stall: false,
    airspeed: 0,
    forwardSpeed: 0,
    aoa: 0,
    sideslip: 0,
    verticalSpeed: 0,
    terrainClearance: 0,
    recoveryTimer: 0,
    airborneTime: 0,
  };
}

/**
 * Force-driven flight controller for Pale Horizon.
 *
 * `terrain` must expose `heightAt(x, z)`. It may also expose
 * `normalAt(x, z, out)` and `surfaceAt(x, z)`, where the latter returns
 * `"runway"` or another surface name.
 */
export class FlightController {
  constructor({
    terrain,
    spawnPosition = new Vector3(0, 2.35, -620),
    spawnRotation = Quaternion.Identity(),
    tuning = DEFAULT_FLIGHT_TUNING,
    onEvent = null,
  }) {
    if (!terrain?.heightAt) throw new Error("FlightController needs terrain.heightAt(x, z)");
    this.terrain = terrain;
    this.tuning = tuning;
    this.onEvent = onEvent;
    this.spawnPosition = spawnPosition.clone();
    this.spawnRotation = spawnRotation.clone();
    this.state = makeState(this.spawnPosition, this.spawnRotation, tuning);
    this.previousPosition = this.state.position.clone();
    this.previousRotation = this.state.rotation.clone();
    this.accumulator = 0;
    this.presentationAlpha = 0;
    this._wasStalling = false;

    this._matrix = Matrix.Identity();
    this._basis = {
      right: new Vector3(),
      up: new Vector3(),
      forward: new Vector3(),
    };
    this._force = new Vector3();
    this._moment = new Vector3();
    this._velocityDirection = new Vector3();
    this._liftDirection = new Vector3();
    this._sideForce = new Vector3();
    this._worldPoint = new Vector3();
    this._pointOffset = new Vector3();
    this._pointVelocity = new Vector3();
    this._worldOmega = new Vector3();
    this._cross = new Vector3();
    this._normal = new Vector3();
    this._wheelForward = new Vector3();
    this._wheelSide = new Vector3();
    this._friction = new Vector3();
    this._scratch = new Vector3();
    this._deltaRotation = Quaternion.Identity();
    this._renderPosition = new Vector3();
    this._renderRotation = Quaternion.Identity();
    this._presentationPose = {
      position: this._renderPosition,
      rotation: this._renderRotation,
    };
    this._inputState = {
      throttleUp: 0,
      throttleDown: 0,
      pitch: 0,
      roll: 0,
      yaw: 0,
      afterburner: false,
      brake: false,
    };
    this._contactState = { count: 0, maxPenetration: 0, runway: false };
  }

  reset({ silent = false } = {}) {
    const state = this.state;
    state.position.copyFrom(this.spawnPosition);
    state.rotation.copyFrom(this.spawnRotation);
    state.velocity.setAll(0);
    state.angularVelocity.setAll(0);
    state.throttle = 0;
    state.enginePower = 0;
    state.afterburner = false;
    state.brake = false;
    state.gear = true;
    state.onGround = true;
    state.contactCount = 3;
    state.crashed = false;
    state.crashReason = "";
    state.stall = false;
    state.airspeed = 0;
    state.forwardSpeed = 0;
    state.aoa = 0;
    state.sideslip = 0;
    state.verticalSpeed = 0;
    state.terrainClearance = 0;
    state.recoveryTimer = 0;
    state.airborneTime = 0;
    this.previousPosition.copyFrom(state.position);
    this.previousRotation.copyFrom(state.rotation);
    this.accumulator = 0;
    this.presentationAlpha = 0;
    this._wasStalling = false;
    if (!silent) this._emit("reset");
  }

  toggleGear() {
    const state = this.state;
    if (state.crashed) return false;
    if (state.onGround && state.gear) {
      this._emit("gear-blocked", { reason: "weight-on-wheels" });
      return false;
    }
    if (!state.gear && state.airspeed > 145) {
      this._emit("gear-blocked", { reason: "overspeed" });
      return false;
    }
    state.gear = !state.gear;
    this._emit("gear", { down: state.gear });
    return true;
  }

  /**
   * Advance with a render-frame delta. Physics runs in exact fixed increments;
   * `input` is a Set of KeyboardEvent.code strings.
   */
  update(frameDt, input, { sensitivity = 1, assists = true } = {}) {
    const dt = clamp(frameDt, 0, 0.05);
    const state = this.state;
    if (state.crashed) {
      state.recoveryTimer -= dt;
      if (state.recoveryTimer <= 0) this.reset();
      return;
    }

    this.accumulator = Math.min(
      this.accumulator + dt,
      this.tuning.fixedStep * this.tuning.maxSubSteps,
    );
    while (this.accumulator >= this.tuning.fixedStep) {
      this.previousPosition.copyFrom(state.position);
      this.previousRotation.copyFrom(state.rotation);
      this._step(this.tuning.fixedStep, input, sensitivity, assists);
      this.accumulator -= this.tuning.fixedStep;
      if (state.crashed) {
        this.previousPosition.copyFrom(state.position);
        this.previousRotation.copyFrom(state.rotation);
        this.accumulator = 0;
        break;
      }
    }
    this.presentationAlpha = this.accumulator / this.tuning.fixedStep;
  }

  getPresentationPose(positionOut = this._renderPosition, rotationOut = this._renderRotation) {
    Vector3.LerpToRef(
      this.previousPosition,
      this.state.position,
      this.presentationAlpha,
      positionOut,
    );
    Quaternion.SlerpToRef(
      this.previousRotation,
      this.state.rotation,
      this.presentationAlpha,
      rotationOut,
    );
    this._presentationPose.position = positionOut;
    this._presentationPose.rotation = rotationOut;
    return this._presentationPose;
  }

  _step(dt, keys, sensitivity, assists) {
    const state = this.state;
    const tune = this.tuning;
    const input = this._readInput(keys);

    state.throttle = clamp(
      state.throttle
        + input.throttleUp * tune.throttleUpRate * dt
        - input.throttleDown * tune.throttleDownRate * dt,
      0,
      1,
    );
    state.enginePower = damp(state.enginePower, state.throttle, tune.engineSpoolRate, dt);
    state.afterburner = input.afterburner && state.throttle > 0.7;
    state.brake = input.brake;

    this._writeBasis(state.rotation);
    const basis = this._basis;
    const speed = state.velocity.length();
    const forwardSpeed = Vector3.Dot(state.velocity, basis.forward);
    const upSpeed = Vector3.Dot(state.velocity, basis.up);
    const sideSpeed = Vector3.Dot(state.velocity, basis.right);
    const aoa = Math.atan2(-upSpeed, Math.max(1, Math.abs(forwardSpeed)));
    const beta = Math.atan2(sideSpeed, Math.max(1, Math.abs(forwardSpeed)));
    const density = 1.225 * Math.exp(-Math.max(0, state.position.y) / 9000);
    const dynamicPressure = 0.5 * density * speed * speed;

    this._force.set(0, -state.mass * tune.gravity, 0);
    this._moment.setAll(0);

    const absAoA = Math.abs(aoa);
    const stallBlend = smoothstep(tune.stallStart, tune.stallFull, absAoA);
    const linearLift = clamp(
      tune.liftSlope * (aoa - tune.zeroLiftAoA),
      -tune.maxLift,
      tune.maxLift,
    );
    const separatedLift = Math.sin(aoa * 2) * 0.72;
    const liftCoefficient = linearLift + (separatedLift - linearLift) * stallBlend;
    const dragCoefficient = tune.baseDrag
      + tune.inducedDrag * liftCoefficient * liftCoefficient
      + tune.stallDrag * stallBlend * stallBlend
      + tune.sideDrag * Math.abs(beta);

    if (speed > 0.1) {
      this._velocityDirection.copyFrom(state.velocity).scaleInPlace(1 / speed);
      this._liftDirection.copyFrom(basis.up);
      this._scratch.copyFrom(this._velocityDirection).scaleInPlace(
        Vector3.Dot(this._liftDirection, this._velocityDirection),
      );
      this._liftDirection.subtractInPlace(this._scratch);
      if (this._liftDirection.lengthSquared() > 1e-5) this._liftDirection.normalize();
      else this._liftDirection.copyFrom(basis.up);
      this._scratch.copyFrom(this._liftDirection).scaleInPlace(
        dynamicPressure * tune.wingArea * liftCoefficient,
      );
      this._force.addInPlace(this._scratch);
      this._scratch.copyFrom(this._velocityDirection).scaleInPlace(
        -dynamicPressure * tune.wingArea * dragCoefficient,
      );
      this._force.addInPlace(this._scratch);
      this._sideForce.copyFrom(basis.right).scaleInPlace(
        -dynamicPressure * tune.wingArea * clamp(beta * 0.85, -0.7, 0.7),
      );
      this._force.addInPlace(this._sideForce);
    }

    const thrust = state.enginePower
      * (state.afterburner ? tune.afterburnerThrust : tune.dryThrust);
    this._scratch.copyFrom(basis.forward).scaleInPlace(thrust);
    this._force.addInPlace(this._scratch);

    const qScale = clamp(dynamicPressure / 3100, 0.025, 1.35);
    this._moment.x += -input.pitch * tune.pitchControl
      * dynamicPressure * tune.wingArea * tune.meanChord * sensitivity;
    this._moment.y += input.yaw * tune.yawControl
      * dynamicPressure * tune.wingArea * tune.wingSpan * sensitivity;
    this._moment.z += -input.roll * tune.rollControl
      * dynamicPressure * tune.wingArea * tune.wingSpan * sensitivity;

    // Aerodynamic damping never disappears completely, otherwise a low-speed
    // tumble spins forever. Assists add weathercock and angle-of-attack recovery.
    this._moment.x -= state.angularVelocity.x
      * tune.pitchDamping * dynamicPressure * tune.wingArea * tune.meanChord;
    this._moment.y -= state.angularVelocity.y
      * tune.yawDamping * dynamicPressure * tune.wingArea * tune.wingSpan;
    this._moment.z -= state.angularVelocity.z
      * tune.rollDamping * dynamicPressure * tune.wingArea * tune.wingSpan;
    if (assists) {
      this._moment.x += aoa * tune.pitchStability
        * dynamicPressure * tune.wingArea * tune.meanChord;
      this._moment.y += beta * tune.yawStability
        * dynamicPressure * tune.wingArea * tune.wingSpan;
      this._moment.z -= state.angularVelocity.z * tune.inertiaRoll * 0.18 * qScale;
    }

    const contact = this._solveGearContacts(input);
    if (contact.count > 0) {
      const taxiAuthority = clamp(Math.abs(forwardSpeed) / 12, 0, 1);
      this._moment.y += input.yaw * tune.groundYawMoment * taxiAuthority;
    }

    this._scratch.copyFrom(this._force).scaleInPlace(dt / state.mass);
    state.velocity.addInPlace(this._scratch);
    this._integrateAngularVelocity(dt);
    this._scratch.copyFrom(state.velocity).scaleInPlace(dt);
    state.position.addInPlace(this._scratch);
    Quaternion.RotationYawPitchRollToRef(
      state.angularVelocity.y * dt,
      state.angularVelocity.x * dt,
      state.angularVelocity.z * dt,
      this._deltaRotation,
    );
    state.rotation.multiplyInPlace(this._deltaRotation).normalize();

    this._writeBasis(state.rotation);
    this._updateContactState(contact, speed, sideSpeed);
    if (!state.crashed) this._checkAirframeCollision();

    const ground = this.terrain.heightAt(state.position.x, state.position.z);
    const clearance = state.gear ? tune.gearClearance : tune.bellyClearance;
    state.terrainClearance = Math.max(0, state.position.y - ground - clearance);
    state.airspeed = state.velocity.length();
    state.forwardSpeed = Vector3.Dot(state.velocity, this._basis.forward);
    state.aoa = aoa;
    state.sideslip = beta;
    state.verticalSpeed = state.velocity.y;
    state.stall = !state.onGround
      && state.airspeed > 18
      && (stallBlend > 0.18 || (state.forwardSpeed < 49 && aoa > 5 * RAD));
    if (state.stall !== this._wasStalling) {
      this._wasStalling = state.stall;
      this._emit(state.stall ? "stall" : "stall-recovered");
    }
  }

  _readInput(keys) {
    const input = this._inputState;
    input.throttleUp = keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("Equal") ? 1 : 0;
    input.throttleDown = keys.has("ControlLeft") || keys.has("ControlRight") || keys.has("Minus") ? 1 : 0;
    // Positive pitch means nose up. Babylon's positive local-X rotation points
    // the nose down, so the control moment applies the inverse sign above.
    input.pitch = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0)
      - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
    input.roll = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0)
      - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    input.yaw = (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0);
    input.afterburner = keys.has("Space");
    input.brake = keys.has("KeyB");
    return input;
  }

  _solveGearContacts(input) {
    const state = this.state;
    const tune = this.tuning;
    const contact = this._contactState;
    contact.count = 0;
    contact.maxPenetration = 0;
    contact.runway = false;
    if (!state.gear) return contact;

    this._worldOmega.copyFrom(this._basis.right).scaleInPlace(state.angularVelocity.x);
    this._scratch.copyFrom(this._basis.up).scaleInPlace(state.angularVelocity.y);
    this._worldOmega.addInPlace(this._scratch);
    this._scratch.copyFrom(this._basis.forward).scaleInPlace(state.angularVelocity.z);
    this._worldOmega.addInPlace(this._scratch);

    let count = 0;
    let maxPenetration = 0;
    let runwayContacts = 0;
    for (const gear of GEAR_POINTS) {
      Vector3.TransformNormalToRef(gear.local, this._matrix, this._pointOffset);
      this._worldPoint.copyFrom(state.position).addInPlace(this._pointOffset);
      const groundHeight = this.terrain.heightAt(this._worldPoint.x, this._worldPoint.z);
      const penetration = groundHeight - this._worldPoint.y;
      if (penetration <= 0) continue;

      count++;
      maxPenetration = Math.max(maxPenetration, penetration);
      if (this.terrain.surfaceAt?.(this._worldPoint.x, this._worldPoint.z) === "runway") {
        runwayContacts++;
      }
      this._terrainNormal(this._worldPoint.x, this._worldPoint.z, this._normal);
      Vector3.CrossToRef(this._worldOmega, this._pointOffset, this._cross);
      this._pointVelocity.copyFrom(state.velocity).addInPlace(this._cross);
      const normalSpeed = Vector3.Dot(this._pointVelocity, this._normal);
      const normalForce = clamp(
        tune.gearSpring * Math.min(penetration, tune.gearMaxCompression)
          - tune.gearDamping * normalSpeed,
        0,
        tune.gearMaxForce,
      );
      this._friction.copyFrom(this._normal).scaleInPlace(normalForce);
      this._addForceAtPoint(this._friction, this._worldPoint);

      // The tyre can roll along its forward axis. It strongly resists side slip,
      // while rolling resistance and brakes oppose the longitudinal component.
      this._wheelForward.copyFrom(this._basis.forward);
      this._scratch.copyFrom(this._normal).scaleInPlace(
        Vector3.Dot(this._wheelForward, this._normal),
      );
      this._wheelForward.subtractInPlace(this._scratch);
      if (this._wheelForward.lengthSquared() < 1e-5) continue;
      this._wheelForward.normalize();
      Vector3.CrossToRef(this._normal, this._wheelForward, this._wheelSide);
      this._wheelSide.normalize();
      const sideVelocity = Vector3.Dot(this._pointVelocity, this._wheelSide);
      const forwardVelocity = Vector3.Dot(this._pointVelocity, this._wheelForward);
      const brake = input.brake
        ? tune.brakeForce / GEAR_POINTS.length
        : state.throttle < 0.015 ? tune.parkingBrakeForce / GEAR_POINTS.length : 0;
      const longitudinal = -Math.sign(forwardVelocity)
        * (normalForce * tune.rollingResistance + brake);
      const lateral = -sideVelocity * tune.tyreSideDamping;
      const maxFriction = normalForce * tune.tyreFriction;
      const magnitude = Math.hypot(longitudinal, lateral);
      const frictionScale = magnitude > maxFriction && magnitude > 0
        ? maxFriction / magnitude : 1;
      this._friction.copyFrom(this._wheelForward).scaleInPlace(longitudinal * frictionScale);
      this._scratch.copyFrom(this._wheelSide).scaleInPlace(lateral * frictionScale);
      this._friction.addInPlace(this._scratch);
      this._addForceAtPoint(this._friction, this._worldPoint);
    }
    contact.count = count;
    contact.maxPenetration = maxPenetration;
    contact.runway = count > 0 && runwayContacts === count;
    return contact;
  }

  _updateContactState(contact, preStepSpeed, sideSpeed) {
    const state = this.state;
    const tune = this.tuning;
    const hadContact = state.contactCount > 0;
    const hasContact = contact.count > 0;
    if (hasContact && !hadContact && state.airborneTime > 0.22) {
      const sinkRate = Math.max(0, -state.velocity.y);
      this._terrainNormal(state.position.x, state.position.z, this._normal);
      const bank = Math.acos(clamp(Vector3.Dot(this._basis.up, this._normal), -1, 1));
      const pitch = Math.asin(clamp(Vector3.Dot(this._basis.forward, this._normal), -1, 1));
      const unsafe = !state.gear
        || sinkRate > tune.safeSinkRate
        || bank > tune.safeBank
        || pitch < tune.safePitchDown
        || pitch > tune.safePitchUp
        || Math.abs(sideSpeed) > tune.safeSideSpeed
        || (!contact.runway && preStepSpeed > tune.roughGroundSpeed)
        || contact.maxPenetration > tune.gearMaxCompression;
      if (unsafe) {
        this._crash("landing");
        return;
      }
      this._emit("landed", { sinkRate, runway: contact.runway });
    }

    state.contactCount = contact.count;
    state.onGround = contact.count >= 2 || (contact.count === 1 && preStepSpeed < 24);
    if (hasContact) state.airborneTime = 0;
    else state.airborneTime += this.tuning.fixedStep;
  }

  _checkAirframeCollision() {
    const state = this.state;
    for (const probe of HULL_PROBES) {
      Vector3.TransformNormalToRef(probe, this._matrix, this._pointOffset);
      this._worldPoint.copyFrom(state.position).addInPlace(this._pointOffset);
      const ground = this.terrain.heightAt(this._worldPoint.x, this._worldPoint.z);
      if (this._worldPoint.y < ground - 0.04) {
        const lowEnergy = state.airspeed < 7 && Math.abs(state.velocity.y) < 2;
        if (lowEnergy) {
          state.position.y += ground - this._worldPoint.y;
          state.velocity.y = Math.max(0, state.velocity.y);
        } else {
          this._crash(state.gear ? "airframe-strike" : "gear-up landing");
        }
        return;
      }
    }
  }

  _integrateAngularVelocity(dt) {
    const state = this.state;
    const tune = this.tuning;
    const p = state.angularVelocity.x;
    const q = state.angularVelocity.y;
    const r = state.angularVelocity.z;
    // Euler's rigid-body equations in the aircraft's principal-axis frame.
    const pitchAcceleration = (
      this._moment.x - (tune.inertiaRoll - tune.inertiaYaw) * q * r
    ) / tune.inertiaPitch;
    const yawAcceleration = (
      this._moment.y - (tune.inertiaPitch - tune.inertiaRoll) * r * p
    ) / tune.inertiaYaw;
    const rollAcceleration = (
      this._moment.z - (tune.inertiaYaw - tune.inertiaPitch) * p * q
    ) / tune.inertiaRoll;
    state.angularVelocity.x += pitchAcceleration * dt;
    state.angularVelocity.y += yawAcceleration * dt;
    state.angularVelocity.z += rollAcceleration * dt;
    state.angularVelocity.scaleInPlace(Math.exp(-tune.staticAngularDamping * dt));
    state.angularVelocity.x = clamp(state.angularVelocity.x, -1.35, 1.35);
    state.angularVelocity.y = clamp(state.angularVelocity.y, -0.9, 0.9);
    state.angularVelocity.z = clamp(state.angularVelocity.z, -2.25, 2.25);
  }

  _addForceAtPoint(force, point) {
    this._force.addInPlace(force);
    this._pointOffset.copyFrom(point).subtractInPlace(this.state.position);
    Vector3.CrossToRef(this._pointOffset, force, this._cross);
    this._moment.x += Vector3.Dot(this._cross, this._basis.right);
    this._moment.y += Vector3.Dot(this._cross, this._basis.up);
    this._moment.z += Vector3.Dot(this._cross, this._basis.forward);
  }

  _writeBasis(rotation) {
    rotation.toRotationMatrix(this._matrix);
    Vector3.TransformNormalToRef(RIGHT, this._matrix, this._basis.right);
    Vector3.TransformNormalToRef(UP, this._matrix, this._basis.up);
    Vector3.TransformNormalToRef(FORWARD, this._matrix, this._basis.forward);
    this._basis.right.normalize();
    this._basis.up.normalize();
    this._basis.forward.normalize();
  }

  _terrainNormal(x, z, out) {
    if (this.terrain.normalAt) return this.terrain.normalAt(x, z, out);
    const e = 0.75;
    const dx = this.terrain.heightAt(x + e, z) - this.terrain.heightAt(x - e, z);
    const dz = this.terrain.heightAt(x, z + e) - this.terrain.heightAt(x, z - e);
    out.set(-dx / (2 * e), 1, -dz / (2 * e));
    return out.normalize();
  }

  _crash(reason) {
    const state = this.state;
    if (state.crashed) return;
    state.crashed = true;
    state.crashReason = reason;
    state.onGround = false;
    state.recoveryTimer = this.tuning.recoveryDelay;
    state.velocity.scaleInPlace(0.15);
    state.angularVelocity.scaleInPlace(0.35);
    this._emit("crash", { reason });
  }

  _emit(type, detail = {}) {
    this.onEvent?.(type, detail, this.state);
  }
}
