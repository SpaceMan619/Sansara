import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import "@babylonjs/loaders/glTF";

import { input } from "../core/input.js";
import { S } from "../core/settings.js";
import { expDamp } from "../core/camera.js";

// The SUV casts into the near cascades only; like the character, its shadow in
// cascade 2 (330 m at 32 cm/texel) is a smudge indistinguishable from the dune.
const VEHICLE_CASCADES = 2;

const MAX_REVERSE = 8;
const REVERSE_ACCEL = 3.1;
const HANDBRAKE_ACCEL = 13;
const ROLLING_DRAG = 0.24;
const AERO_DRAG = 0.0018;
const GRAVITY = 9.81;
const WHEEL_BASE = 2.55;
const MAX_STEER_LOW_SPEED = 0.52;
const MAX_STEER_HIGH_SPEED = 0.15;
const WHEEL_RADIUS = 0.48;
const CHARACTER_RADIUS = 0.52;
const PHYSICS_STEP = 1 / 120;
const CHASSIS_CLEARANCE = 0.32;

const _forward = new Vector3();
const _right = new Vector3();

/**
 * Lightweight terrain-following vehicle prototype.
 *
 * It intentionally owns no character state. Entering merely hands camera and
 * input focus to this controller; leaving returns them to CharacterController.
 * That boundary keeps vehicle experiments from destabilising footsteps,
 * spells or the procedural Snowflow figure.
 */
export class Vehicle {
    constructor(scene, terrain, sky) {
        this.scene = scene;
        this.terrain = terrain;
        this.sky = sky;
        this.root = null;
        this.meshes = [];
        this.wheels = [];
        this.frontWheels = [];

        // Close enough to discover, far enough to keep the opening composition
        // focused on the character and the snow field.
        this.position = new Vector3(7.2, 0, 4.8);
        this.velocity = new Vector3();
        this.facing = Math.PI * 0.15;
        this.speed = 0;
        this.speed01 = 0;
        this.streak01 = 0;
        this.lean = 0;
        this.active = false;
        this.loaded = false;
        this.groundOffset = 0;
        this.steer = 0;
        this.throttle = 0;
        this.grounded = true;
        this.verticalVelocity = 0;
        this.pitch = 0;
        this.roll = 0;
        this.suspensionCompression = 0;
        this.suspensionVelocity = 0;
        this._supportA = { height: 0, pitch: 0, roll: 0 };
        this._supportB = { height: 0, pitch: 0, roll: 0 };
        this._wheelRoll = 0;
        this.bodyHalfWidth = 1.05;
        this.bodyHalfLength = 2.18;
        this.frontAxle = 1.3;
        this.rearAxle = -0.96;
        this.halfTrack = 0.52;
        this.bodyFront = 2.3;
        this.bodyRear = -2.05;

        this.prompt = document.createElement("div");
        this.prompt.id = "vehicle-prompt";
        this.prompt.setAttribute("role", "status");
        document.body.appendChild(this.prompt);

        this.gauge = document.createElement("div");
        this.gauge.id = "vehicle-speed";
        this.gauge.setAttribute("aria-live", "off");
        const gaugeCaption = document.createElement("span");
        gaugeCaption.className = "vehicle-speed-caption";
        gaugeCaption.textContent = "SUV";
        this.gaugeValue = document.createElement("strong");
        this.gaugeValue.textContent = "0";
        const gaugeUnit = document.createElement("span");
        gaugeUnit.className = "vehicle-speed-unit";
        gaugeUnit.textContent = "km/h";
        const gaugeTrack = document.createElement("span");
        gaugeTrack.className = "vehicle-speed-track";
        this.gaugeFill = document.createElement("i");
        gaugeTrack.appendChild(this.gaugeFill);
        this.gaugeState = document.createElement("span");
        this.gaugeState.className = "vehicle-speed-state";
        this.gaugeState.textContent = "P";
        this.gauge.append(
            gaugeCaption, this.gaugeValue, gaugeUnit, gaugeTrack, this.gaugeState
        );
        document.body.appendChild(this.gauge);
    }

    async load(url) {
        try {
            const container = await LoadAssetContainerAsync(url, this.scene);
            container.addAllToScene();

            const root = new TransformNode("darkSnowVehicleRoot", this.scene);
            const candidates = [
                ...(container.transformNodes || []),
                ...(container.meshes || []),
            ];
            for (const node of candidates) {
                if (!node.parent) node.parent = root;
            }

            const meshes = (container.meshes || []).filter((mesh) =>
                mesh.getTotalVertices?.() > 0
            );

            // Snowflow's world is lit entirely in bespoke shaders. Imported
            // GLBs need a small, isolated stock-light bridge or they render as
            // flat charcoal silhouettes under the same post-processing.
            const fill = new HemisphericLight(
                "darkSnowVehicleFill", new Vector3(0, 1, 0), this.scene
            );
            fill.intensity = 1.15;
            fill.diffuse = new Color3(0.72, 0.80, 1.0);
            fill.groundColor = new Color3(0.12, 0.16, 0.23);
            const sun = new DirectionalLight(
                "darkSnowVehicleSun", this.sky.sunDir.scale(-1), this.scene
            );
            sun.intensity = 2.6;
            sun.diffuse = new Color3(1.0, 0.71, 0.40);

            for (const mesh of meshes) {
                mesh.renderingGroupId = 1;
                mesh.isPickable = false;
                mesh.receiveShadows = false;
                const sourceMaterial = mesh.material;
                const material = new StandardMaterial(
                    `${mesh.name} · Dark Snow vehicle`, this.scene
                );
                material.backFaceCulling = false;
                material.diffuseTexture = sourceMaterial?.albedoTexture
                    || sourceMaterial?.diffuseTexture
                    || null;
                material.emissiveTexture = material.diffuseTexture;
                material.diffuseColor = new Color3(0.95, 0.97, 1.0);
                material.emissiveColor = new Color3(0.34, 0.37, 0.43);
                material.specularColor = new Color3(0.12, 0.14, 0.18);
                mesh.material = material;
                fill.includedOnlyMeshes.push(mesh);
                sun.includedOnlyMeshes.push(mesh);
            }

            const bounds = root.getHierarchyBoundingVectors(true);
            const width = bounds.max.x - bounds.min.x;
            const length = bounds.max.z - bounds.min.z;
            const scale = 4.35 / Math.max(width, length, 0.001);
            root.scaling.setAll(scale);
            // Exact authored pivots/bounds from the Kenney GLB, converted to
            // the world scale chosen above. These replace guessed contacts.
            this.frontAxle = 0.76 * scale;
            this.rearAxle = -0.56 * scale;
            this.halfTrack = 0.30 * scale;
            this.bodyFront = 1.35 * scale;
            this.bodyRear = -1.20 * scale;
            this.bodyHalfWidth = Math.max(0.8, width * scale * 0.5);
            this.bodyHalfLength = Math.max(1.45, length * scale * 0.5);
            const scaledBounds = root.getHierarchyBoundingVectors(true);
            this.groundOffset = -scaledBounds.min.y + 0.02;

            const wheels = meshes.filter((mesh) =>
                /^wheel-(front|back)-(left|right)$/i.test(mesh.name)
            );
            for (const wheel of wheels) {
                if (wheel.rotationQuaternion) {
                    wheel.rotation.copyFrom(wheel.rotationQuaternion.toEulerAngles());
                    wheel.rotationQuaternion = null;
                }
                wheel.metadata = {
                    ...(wheel.metadata || {}),
                    baseRotation: wheel.rotation.clone(),
                    basePosition: wheel.position.clone(),
                };
            }

            this.root = root;
            this.meshes = meshes;
            this.wheels = wheels;
            this.frontWheels = wheels.filter((wheel) =>
                wheel.name.toLowerCase().includes("front")
            );
            this.sun = sun;
            this.loaded = true;
            this._sampleSupport(
                this.position.x, this.position.z, this._supportA
            );
            this.position.y = this._supportA.height;
            this._syncVisual(0);
            console.info("[dark-snow] prototype vehicle loaded", {
                meshes: meshes.map((mesh) => mesh.name),
                wheels: wheels.map((mesh) => mesh.name),
            });
            return true;
        } catch (err) {
            console.warn("[dark-snow] prototype vehicle unavailable", err);
            this.prompt.textContent = "vehicle asset unavailable";
            this.prompt.classList.add("show");
            return false;
        }
    }

    canEnter(characterPosition) {
        if (!this.loaded || this.active) return false;
        const dx = characterPosition.x - this.position.x;
        const dz = characterPosition.z - this.position.z;
        // The vehicle is intentionally discoverable from the opening spawn.
        // Driving hands the camera to the parked SUV, so this generous radius
        // feels like a quick character/vehicle switch rather than a hunt for
        // an interaction hotspot on an unmarked snow field.
        return dx * dx + dz * dz <= 144;
    }

    toggle(character) {
        if (!this.loaded) return false;
        if (this.active) {
            if (!this.grounded) return false;
            _right.set(Math.cos(this.facing), 0, -Math.sin(this.facing));
            const exitDistance = this.bodyHalfWidth + CHARACTER_RADIUS + 0.75;
            character.position.set(
                this.position.x + _right.x * exitDistance,
                0,
                this.position.z + _right.z * exitDistance
            );
            character.groundY = this.terrain.heightAt(character.position.x, character.position.z);
            character.position.y = character.groundY;
            character.velocity.setAll(0);
            character.prevVelocity.setAll(0);
            character.speed = 0;
            this.speed = 0;
            this.velocity.setAll(0);
            this.throttle = 0;
            this.steer = 0;
            this.active = false;
            this._updateGauge();
            this._updatePrompt(character.position);
            return true;
        }
        if (!this.canEnter(character.position)) return false;
        character.velocity.setAll(0);
        character.prevVelocity.setAll(0);
        this.active = true;
        this._updateGauge();
        this.prompt.textContent = "E  ·  step out";
        this.prompt.classList.add("show");
        return true;
    }

    update(dt, characterPosition) {
        if (!this.loaded) return;
        this.sun.direction.copyFrom(this.sky.sunDir).scaleInPlace(-1);
        const frameDt = Math.min(dt, 0.1);
        if (!this.active) {
            this._updatePrompt(characterPosition);
            this._updateGauge();
            this._syncVisual(0);
            return;
        }

        const steps = Math.max(1, Math.ceil(frameDt / PHYSICS_STEP));
        const h = frameDt / steps;
        for (let i = 0; i < steps; i++) this._stepPhysics(h);

        _forward.set(Math.sin(this.facing), 0, Math.cos(this.facing));
        this.speed = this.velocity.x * _forward.x + this.velocity.z * _forward.z;
        const maxForward = S.vehicleMaxSpeed / 3.6;
        this.speed01 = Scalar.Clamp(Math.abs(this.speed) / maxForward, 0, 1);
        this.streak01 = Scalar.Clamp((Math.abs(this.speed) - 12) / 14, 0, 1);
        this.lean = -this.steer * this.speed01 * 0.18;
        this._wheelRoll += (this.speed * frameDt) / WHEEL_RADIUS;
        this._syncVisual(frameDt);
        this._updatePrompt(characterPosition);
        this._updateGauge();
    }

    _stepPhysics(h) {
        _forward.set(Math.sin(this.facing), 0, Math.cos(this.facing));
        _right.set(Math.cos(this.facing), 0, -Math.sin(this.facing));
        let longitudinal = this.velocity.x * _forward.x + this.velocity.z * _forward.z;
        let lateral = this.velocity.x * _right.x + this.velocity.z * _right.z;

        this.throttle = expDamp(this.throttle, input.moveZ, 3.8, h);
        this.steer = expDamp(this.steer, input.moveX, 5.2, h);
        const maxForward = Math.max(1, S.vehicleMaxSpeed / 3.6);
        const ratio = Scalar.Clamp(Math.abs(longitudinal) / maxForward, 0, 1);

        if (this.grounded) {
            if (this.throttle > 0.02) {
                if (longitudinal < -0.35) {
                    longitudinal = approach(longitudinal, 0, S.vehicleBrake * this.throttle * h);
                } else {
                    const engine = S.vehicleAcceleration
                        * (1 - 0.72 * Math.pow(ratio, 1.65));
                    longitudinal += engine * this.throttle * h;
                }
            } else if (this.throttle < -0.02) {
                if (longitudinal > 0.35) {
                    longitudinal = approach(longitudinal, 0, S.vehicleBrake * -this.throttle * h);
                } else {
                    const reverseRatio = Scalar.Clamp(Math.abs(longitudinal) / MAX_REVERSE, 0, 1);
                    longitudinal -= REVERSE_ACCEL * (1 - 0.7 * reverseRatio) * -this.throttle * h;
                }
            } else {
                const drag = ROLLING_DRAG + AERO_DRAG * longitudinal * longitudinal;
                longitudinal = approach(longitudinal, 0, drag * h);
            }

            // Space becomes a handbrake in the SUV. Normal tyre grip scrubs
            // sideslip progressively; the handbrake releases the rear so a
            // turn rotates into a drift instead of snapping like a toy car.
            if (input.surf) longitudinal = approach(longitudinal, 0, HANDBRAKE_ACCEL * h);
            const grip = input.surf
                ? 1.35
                : Scalar.Lerp(S.vehicleGrip * 1.3, S.vehicleGrip * 0.5, ratio);
            lateral *= Math.exp(-grip * h);

            const frontGround = this.terrain.heightAt(
                this.position.x + _forward.x, this.position.z + _forward.z
            );
            const rearGround = this.terrain.heightAt(
                this.position.x - _forward.x, this.position.z - _forward.z
            );
            const grade = (frontGround - rearGround) * 0.5;
            longitudinal -= 9.81 * grade * h;

            const steerLimit = Scalar.Lerp(
                MAX_STEER_LOW_SPEED, MAX_STEER_HIGH_SPEED, ratio
            );
            const steerAngle = this.steer * steerLimit;
            if (Math.abs(longitudinal) > 0.25) {
                this.facing += (longitudinal / WHEEL_BASE)
                    * Math.tan(steerAngle) * (input.surf ? 1.35 : 1) * h;
            }

            longitudinal = Scalar.Clamp(longitudinal, -MAX_REVERSE, maxForward);
            _forward.set(Math.sin(this.facing), 0, Math.cos(this.facing));
            _right.set(Math.cos(this.facing), 0, -Math.sin(this.facing));
            this.velocity.x = _forward.x * longitudinal + _right.x * lateral;
            this.velocity.z = _forward.z * longitudinal + _right.z * lateral;

            this._sampleSupport(
                this.position.x, this.position.z, this._supportA
            );
            const currentSupport = this._supportA.height;
            const nextX = this.position.x + this.velocity.x * h;
            const nextZ = this.position.z + this.velocity.z * h;
            this._sampleSupport(nextX, nextZ, this._supportB);
            const nextSupport = this._supportB.height;
            const surfaceVelocity = (nextSupport - currentSupport) / h;

            // Look ahead along the current tangent. If the physical ballistic
            // path sits above the upcoming support surface, the normal force
            // has vanished and the tyres must release from the snow.
            const lookTime = Scalar.Lerp(0.10, 0.22, ratio);
            this._sampleSupport(
                nextX + this.velocity.x * lookTime,
                nextZ + this.velocity.z * lookTime,
                this._supportA
            );
            const tangentAhead = this.position.y
                + this.verticalVelocity * lookTime
                // Deliberately lighter anticipation than the airborne gravity
                // step. This approximates suspension unloading at a crest and
                // gives readable GTA-like airtime on the broad snow dunes.
                - 0.5 * GRAVITY * lookTime * lookTime * 0.28;
            const releaseAtCrest = Math.abs(longitudinal) > 5
                && tangentAhead > this._supportA.height + S.vehicleCrestRelease;

            this.position.x = nextX;
            this.position.z = nextZ;
            this.verticalVelocity -= GRAVITY * h;
            const ballisticY = this.position.y + this.verticalVelocity * h;
            if (!releaseAtCrest && ballisticY <= nextSupport) {
                this.position.y = nextSupport;
                this.verticalVelocity = surfaceVelocity;
            } else {
                this.position.y = ballisticY;
                this.grounded = false;
            }
        } else {
            this._sampleSupport(
                this.position.x, this.position.z, this._supportA
            );
            const nextX = this.position.x + this.velocity.x * h;
            const nextZ = this.position.z + this.velocity.z * h;
            this._sampleSupport(nextX, nextZ, this._supportB);
            const surfaceVelocity = (
                this._supportB.height - this._supportA.height
            ) / h;
            this.position.x = nextX;
            this.position.z = nextZ;
            this.verticalVelocity -= GRAVITY * h;
            this.position.y += this.verticalVelocity * h;
            if (
                this.position.y <= this._supportB.height
                && this.verticalVelocity <= surfaceVelocity
            ) {
                const impact = surfaceVelocity - this.verticalVelocity;
                this.position.y = this._supportB.height;
                this.grounded = true;
                this.suspensionVelocity += Math.min(0.48, impact * 0.045);
                this.verticalVelocity = surfaceVelocity;
                const landingLoss = Math.max(0.72, 1 - impact * 0.012);
                this.velocity.x *= landingLoss;
                this.velocity.z *= landingLoss;
            }
        }

        this.suspensionVelocity += (-28 * this.suspensionCompression
            - 7.5 * this.suspensionVelocity) * h;
        this.suspensionCompression += this.suspensionVelocity * h;
        this.suspensionCompression = Scalar.Clamp(
            this.suspensionCompression, -0.06, 0.32
        );
    }

    _sampleSupport(x, z, out) {
        _forward.set(Math.sin(this.facing), 0, Math.cos(this.facing));
        _right.set(Math.cos(this.facing), 0, -Math.sin(this.facing));
        const heightAt = (forwardOffset, rightOffset) => this.terrain.heightAt(
            x + _forward.x * forwardOffset + _right.x * rightOffset,
            z + _forward.z * forwardOffset + _right.z * rightOffset
        );
        const frontPlus = heightAt(this.frontAxle, this.halfTrack);
        const frontMinus = heightAt(this.frontAxle, -this.halfTrack);
        const rearPlus = heightAt(this.rearAxle, this.halfTrack);
        const rearMinus = heightAt(this.rearAxle, -this.halfTrack);
        const frontY = (frontPlus + frontMinus) * 0.5;
        const rearY = (rearPlus + rearMinus) * 0.5;
        const plusY = (frontPlus + rearPlus) * 0.5;
        const minusY = (frontMinus + rearMinus) * 0.5;
        const wheelbase = this.frontAxle - this.rearAxle;
        const rawForwardSlope = (frontY - rearY) / wheelbase;
        const rawSideSlope = (plusY - minusY) / (this.halfTrack * 2);

        // Limit only the rendered attitude, then recompute the vertical support
        // required by that exact limited plane. Visual pose and collision can
        // no longer disagree on steep slopes.
        out.pitch = Scalar.Clamp(-Math.atan(rawForwardSlope), -0.46, 0.46);
        out.roll = Scalar.Clamp(Math.atan(rawSideSlope), -0.28, 0.28);
        const forwardSlope = -Math.tan(out.pitch);
        const sideSlope = Math.tan(out.roll);
        const contribution = (forwardOffset, rightOffset) =>
            forwardSlope * forwardOffset + sideSlope * rightOffset;
        const wheelClearance = 0.015;

        // Solve the minimum root height satisfying every authored tyre pivot.
        // The additional body probes use the GLB's real bumper extents and its
        // measured 0.32 m underbody clearance.
        out.height = Math.max(
            frontPlus - contribution(this.frontAxle, this.halfTrack) + wheelClearance,
            frontMinus - contribution(this.frontAxle, -this.halfTrack) + wheelClearance,
            rearPlus - contribution(this.rearAxle, this.halfTrack) + wheelClearance,
            rearMinus - contribution(this.rearAxle, -this.halfTrack) + wheelClearance,
            heightAt(0, 0) - CHASSIS_CLEARANCE,
            heightAt(this.bodyFront, 0)
                - contribution(this.bodyFront, 0) - CHASSIS_CLEARANCE,
            heightAt(this.bodyRear, 0)
                - contribution(this.bodyRear, 0) - CHASSIS_CLEARANCE,
            heightAt(this.bodyFront, this.bodyHalfWidth)
                - contribution(this.bodyFront, this.bodyHalfWidth) - CHASSIS_CLEARANCE,
            heightAt(this.bodyFront, -this.bodyHalfWidth)
                - contribution(this.bodyFront, -this.bodyHalfWidth) - CHASSIS_CLEARANCE,
            heightAt(this.bodyRear, this.bodyHalfWidth)
                - contribution(this.bodyRear, this.bodyHalfWidth) - CHASSIS_CLEARANCE,
            heightAt(this.bodyRear, -this.bodyHalfWidth)
                - contribution(this.bodyRear, -this.bodyHalfWidth) - CHASSIS_CLEARANCE
        );
        return out;
    }

    _syncVisual() {
        if (!this.root) return;
        this._sampleSupport(
            this.position.x, this.position.z, this._supportA
        );

        this.root.position.set(
            this.position.x,
            this.position.y + this.groundOffset,
            this.position.z
        );
        const targetPitch = this.grounded
            ? this._supportA.pitch
            : Scalar.Clamp(-this.verticalVelocity * 0.018, -0.16, 0.16);
        const targetRoll = this.grounded ? this._supportA.roll : -this.steer * 0.08;
        if (this.grounded) {
            // Collision was solved for this exact plane; easing toward it would
            // temporarily put the rendered bumper below the solved collider.
            this.pitch = targetPitch;
            this.roll = targetRoll;
        } else {
            this.pitch = expDamp(this.pitch, targetPitch, 2.2, 1 / 60);
            this.roll = expDamp(this.roll, targetRoll, 2.2, 1 / 60);
        }
        this.root.rotation.x = this.pitch;
        // Kenney's SUV points down +Z. Keeping the visual and physical forward
        // axes identical makes W/ArrowUp visibly drive through the windscreen,
        // rather than moving the model boot-first.
        this.root.rotation.y = this.facing;
        this.root.rotation.z = this.roll;

        for (const wheel of this.wheels) {
            const base = wheel.metadata.baseRotation;
            const basePosition = wheel.metadata.basePosition;
            // Wheels stay rigidly attached to their authored axle positions.
            // A future high-resolution rig can expose suspension bones; this
            // low-poly GLB cannot safely fake them through mesh-local offsets.
            wheel.position.copyFrom(basePosition);
            wheel.rotation.x = base.x + this._wheelRoll;
            wheel.rotation.y = base.y + (this.frontWheels.includes(wheel) ? -this.steer * 0.48 : 0);
            wheel.rotation.z = base.z;
        }
    }

    _updateGauge() {
        if (!this.gauge) return;
        this.gauge.classList.toggle("show", this.active);
        const kmh = Math.round(Math.abs(this.speed) * 3.6);
        this.gaugeValue.textContent = String(kmh);
        this.gaugeFill.style.width = `${Math.min(100, kmh / S.vehicleMaxSpeed * 100)}%`;
        this.gaugeState.textContent = !this.grounded
            ? "AIR"
            : this.speed < -0.2 ? "R" : "D";
    }

    _updatePrompt(characterPosition) {
        if (!this.loaded) return;
        if (this.active) {
            this.prompt.textContent = "E  ·  step out";
            this.prompt.classList.add("show");
        } else if (this.canEnter(characterPosition)) {
            this.prompt.textContent = "E  ·  drive SUV";
            this.prompt.classList.add("show");
        } else {
            this.prompt.classList.remove("show");
        }
    }

    /**
     * Keep the walking controller outside a cheap oriented body collider.
     * A rounded box is a much better gameplay approximation for the SUV than
     * per-triangle collision and remains correct as the vehicle rotates.
     */
    resolveCharacterCollision(character) {
        if (!this.loaded || this.active) return false;

        _forward.set(Math.sin(this.facing), 0, Math.cos(this.facing));
        _right.set(Math.cos(this.facing), 0, -Math.sin(this.facing));
        const dx = character.position.x - this.position.x;
        const dz = character.position.z - this.position.z;
        const localRight = dx * _right.x + dz * _right.z;
        const localForward = dx * _forward.x + dz * _forward.z;
        const extentRight = this.bodyHalfWidth + CHARACTER_RADIUS;
        const extentForward = this.bodyHalfLength + CHARACTER_RADIUS;

        if (
            Math.abs(localRight) >= extentRight
            || Math.abs(localForward) >= extentForward
        ) return false;

        const rightPenetration = extentRight - Math.abs(localRight);
        const forwardPenetration = extentForward - Math.abs(localForward);
        let nx;
        let nz;
        let penetration;
        if (rightPenetration < forwardPenetration) {
            const side = localRight === 0 ? 1 : Math.sign(localRight);
            nx = _right.x * side;
            nz = _right.z * side;
            penetration = rightPenetration;
        } else {
            const side = localForward === 0 ? 1 : Math.sign(localForward);
            nx = _forward.x * side;
            nz = _forward.z * side;
            penetration = forwardPenetration;
        }

        character.position.x += nx * (penetration + 0.015);
        character.position.z += nz * (penetration + 0.015);
        character.groundY = this.terrain.heightAt(
            character.position.x, character.position.z
        );
        character.position.y = character.groundY;

        // Remove only velocity aimed into the vehicle, preserving tangential
        // motion so walking along its side feels smooth rather than sticky.
        const inward = character.velocity.x * nx + character.velocity.z * nz;
        if (inward < 0) {
            character.velocity.x -= nx * inward;
            character.velocity.z -= nz * inward;
        }
        const prevInward = character.prevVelocity.x * nx
            + character.prevVelocity.z * nz;
        if (prevInward < 0) {
            character.prevVelocity.x -= nx * prevInward;
            character.prevVelocity.z -= nz * prevInward;
        }
        return true;
    }
}

function approach(value, target, amount) {
    if (value < target) return Math.min(target, value + amount);
    if (value > target) return Math.max(target, value - amount);
    return target;
}
