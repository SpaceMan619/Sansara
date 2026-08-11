import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/loaders/glTF";

import { input } from "../core/input.js";
import { S } from "../core/settings.js";
import { expDamp } from "../core/camera.js";
import { EngineSound } from "./engineSound.js";
import {
    VehiclePhysics, VEHICLE_SUSPENSION_REST,
} from "./vehiclePhysics.js";

// The SUV casts into the near cascades only; like the character, its shadow in
// cascade 2 (330 m at 32 cm/texel) is a smudge indistinguishable from the dune.
const VEHICLE_CASCADES = 2;

const CHARACTER_RADIUS = 0.52;

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
        this.wheelMeshes = new Array(4).fill(null);
        this.physics = null;
        this.fallbackAtlas = null;

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
        this.bodyHalfWidth = 1.05;
        this.bodyHalfLength = 2.18;
        this.frontAxle = 1.3;
        this.rearAxle = -0.96;
        this.halfTrack = 0.52;
        this.bodyFront = 2.3;
        this.bodyRear = -2.05;

        // Procedural engine + tyre audio, spun up on the first drive.
        this.engine = new EngineSound();

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
            let container;
            try {
                container = await LoadAssetContainerAsync(url, this.scene);
            } catch (_) {
                // Keep the checked-in geometry usable when its optional external
                // colour atlas is absent; a real atlas still takes the normal path.
                container = await LoadAssetContainerAsync(url, this.scene, {
                    pluginOptions: { gltf: { skipMaterials: true } },
                });
            }
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

            // The world is lit entirely in bespoke WGSL, with no stock lights and
            // a low camera exposure tuned for HDR-emitting surfaces. Rather than
            // bridge in Babylon lights the rest of the scene ignores (which left
            // the SUV a flat, post-processed silhouette and kept it out of the
            // depth prepass and shadow cascades), the car now shares that shading
            // path: one WGSL material lit by the same sun the sky solves, emitting
            // in the same pre-tonemap range. Follows the imported-character
            // precedent in character.js, one step further — the car also casts.
            const atlas = this._findAtlas(meshes);
            this.beautyMat = this._makeBeautyMaterial(atlas);
            for (const mesh of meshes) {
                mesh.renderingGroupId = 1;
                mesh.isPickable = false;
                mesh.receiveShadows = false;
                mesh.material = this.beautyMat;
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
            this.vehicleScale = scale;
            this._mapWheelMeshes(wheels);
            this.physics = new VehiclePhysics(this.terrain, this.position, this.facing, {
                halfWidth: this.bodyHalfWidth,
                halfLength: this.bodyHalfLength,
                frontAxle: this.frontAxle,
                rearAxle: this.rearAxle,
                halfTrack: this.halfTrack,
            });
            this.physics.settleOnTerrain(this.groundOffset);
            this.velocity = this.physics.velocity;
            this.position = this.physics.position;
            this.beautyMat.setVector3("sunDir", this.sky.sunDir);
            this.loaded = true;
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

    /** The Kenney SUV shares one `colormap.png` atlas across every mesh. */
    _findAtlas(meshes) {
        for (const mesh of meshes) {
            const src = mesh.material;
            const tex = src?.albedoTexture || src?.diffuseTexture;
            if (tex) return tex;
        }
        return null;
    }

    _makeBeautyMaterial(atlas) {
        const mat = new ShaderMaterial(
            "darkSnowVehicleBeauty", this.scene,
            { vertex: "vehicleColor", fragment: "vehicleColor" },
            {
                attributes: ["position", "normal", "uv"],
                uniforms: ["world", "viewProjection", "sunDir"],
                samplers: ["carTex"],
                shaderLanguage: ShaderLanguage.WGSL,
            }
        );
        // Kenney authors a closed body, but the low-poly windows are single-sided
        // quads; matching the old StandardMaterial keeps them from vanishing.
        mat.backFaceCulling = false;
        if (!atlas && !this.fallbackAtlas) {
            this.fallbackAtlas = RawTexture.CreateRGBATexture(
                new Uint8Array([154, 166, 184, 255]),
                1, 1, this.scene, false, false,
                Constants.TEXTURE_NEAREST_SAMPLINGMODE
            );
        }
        mat.setTexture("carTex", atlas || this.fallbackAtlas);
        return mat;
    }

    _mapWheelMeshes(wheels) {
        for (const mesh of wheels) {
            const name = mesh.name.toLowerCase();
            const front = name.includes("front");
            const left = name.includes("left");
            const index = front ? (left ? 0 : 1) : (left ? 2 : 3);
            this.wheelMeshes[index] = mesh;
        }
    }

    /**
     * Register every SUV mesh into the camera-space depth prepass, using the
     * same generic imported-mesh vertex program the character uses. Without
     * this the car is absent from the depth target every screen-space pass reads
     * — so SSR skips it, DOF mis-focuses it and the snow spray draws through it.
     *
     * @param {import("../render/depthPass.js").DepthPass} depth
     */
    registerPrepass(depth) {
        if (!this.loaded) return;
        this._prepassMats = [];
        for (const mesh of this.meshes) {
            const mat = new ShaderMaterial(
                `${mesh.name} · vehicle prepass`, this.scene,
                { vertex: "riggedPrepass", fragment: "prepass" },
                {
                    attributes: ["position"],
                    uniforms: ["world", "viewProjection"],
                    shaderLanguage: ShaderLanguage.WGSL,
                }
            );
            mat.backFaceCulling = false;
            this._prepassMats.push(mat);
            depth.registerCaster(mesh, mat);
        }
    }

    /**
     * Register the SUV as a shadow caster. A parked car with no contact shadow
     * is the loudest "floating object" cue on the snow; this grounds it.
     *
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     */
    registerShadows(shadows) {
        if (!this.loaded) return;
        this._depthMats = [];
        for (const mesh of this.meshes) {
            shadows.registerCaster(
                mesh, (c) => this._makeDepthMaterial(c), VEHICLE_CASCADES
            );
        }
    }

    _makeDepthMaterial(cascade) {
        const mat = new ShaderMaterial(
            "vehicleDepth" + cascade, this.scene,
            { vertex: "vehicleDepth", fragment: "terrainDepth" },
            {
                attributes: ["position"],
                uniforms: ["world", "lightViewProjection"],
                shaderLanguage: ShaderLanguage.WGSL,
                // A distinct Effect per cascade so each holds its own light
                // matrix without mid-frame uniform juggling (as charDepth does).
                defines: ["VEHICLE_CASCADE " + cascade],
            }
        );
        mat.backFaceCulling = false;
        this._depthMats.push(mat);
        return mat;
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
            if (!this.grounded || !this.physics.isUpright()) return false;
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
            this.physics.angularVelocity.setAll(0);
            for (const wheel of this.physics.wheels) wheel.angularSpeed = 0;
            this.throttle = 0;
            this.steer = 0;
            this.active = false;
            this.engine.stop();
            this._updateGauge();
            this._updatePrompt(character.position);
            return true;
        }
        if (!this.canEnter(character.position)) return false;
        character.velocity.setAll(0);
        character.prevVelocity.setAll(0);
        this.active = true;
        // The E keypress is the user gesture the AudioContext needs to resume.
        this.engine.start();
        this._updateGauge();
        this.prompt.textContent = "E  ·  step out";
        this.prompt.classList.add("show");
        return true;
    }

    /** GTA-style recovery: keep the location and heading, restore a safe pose. */
    recover() {
        if (!this.loaded || !this.active) return false;
        this.physics.resetUpright();
        this.throttle = 0;
        this.steer = 0;
        this.speed = 0;
        this.speed01 = 0;
        this.streak01 = 0;
        this.grounded = false;
        this._syncVisual(0);
        this._updateGauge();
        return true;
    }

    update(dt, characterPosition) {
        if (!this.loaded) return;
        this.beautyMat.setVector3("sunDir", this.sky.sunDir);
        const frameDt = Math.min(dt, 0.1);
        this.throttle = expDamp(this.throttle, this.active ? input.moveZ : 0, 7.0, frameDt);
        this.steer = expDamp(this.steer, this.active ? input.moveX : 0, 5.2, frameDt);
        this.physics.setTuning(
            S.vehicleMaxSpeed, S.vehicleAcceleration, S.vehicleBrake, S.vehicleFriction
        );
        this.physics.update(
            frameDt, this.throttle, this.steer,
            this.active ? input.surf : true
        );
        const q = this.physics.quaternion;
        rotateForward(q, _forward);
        this.facing = Math.atan2(_forward.x, _forward.z);
        this.speed = this.velocity.x * _forward.x + this.velocity.z * _forward.z;
        const maxForward = S.vehicleMaxSpeed / 3.6;
        this.speed01 = Scalar.Clamp(Math.abs(this.speed) / maxForward, 0, 1);
        this.streak01 = Scalar.Clamp((Math.abs(this.speed) - 12) / 14, 0, 1);
        this.lean = -this.steer * this.speed01 * 0.18;
        this.grounded = this.physics.grounded;
        if (this.active) this.engine.update(this.speed01, this.throttle, this.grounded);
        this._syncVisual(frameDt);
        this._updatePrompt(characterPosition);
        this._updateGauge();
    }

    _syncVisual(dt = 0) {
        if (!this.root) return;
        const pose = this.physics.visualPosition;
        this.root.position.set(
            pose.x,
            pose.y + this.physics.modelYOffset,
            pose.z
        );
        if (!this.root.rotationQuaternion) this.root.rotationQuaternion = new Quaternion();
        this.root.rotationQuaternion.copyFrom(this.physics.visualQuaternion);

        for (let i = 0; i < 4; i++) {
            const mesh = this.wheelMeshes[i];
            if (!mesh) continue;
            const state = this.physics.wheels[i];
            const base = mesh.metadata.baseRotation;
            const basePosition = mesh.metadata.basePosition;
            mesh.position.copyFrom(basePosition);
            const travel = VEHICLE_SUSPENSION_REST - state.compression;
            const restTravel = VEHICLE_SUSPENSION_REST;
            mesh.position.y += (restTravel - travel) / this.vehicleScale;
            mesh.rotation.x = base.x + state.rotation;
            mesh.rotation.y = base.y - state.steerAngle;
            mesh.rotation.z = base.z;
        }
    }

    _updateGauge() {
        if (!this.gauge) return;
        this.gauge.classList.toggle("show", this.active);
        const kmh = Math.round(Math.abs(this.speed) * 3.6);
        this.gaugeValue.textContent = String(kmh);
        this.gaugeFill.style.width = `${Math.min(100, kmh / S.vehicleMaxSpeed * 100)}%`;
        this.gaugeState.textContent = this.physics?.needsRecovery()
            ? "ROLL"
            : !this.grounded
            ? "AIR"
            : this.speed < -0.2 ? "R" : "D";
    }

    _updatePrompt(characterPosition) {
        if (!this.loaded) return;
        if (this.active) {
            this.prompt.textContent = this.physics.needsRecovery()
                ? "R  ·  recover SUV"
                : "E  ·  step out";
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

function rotateForward(q, out) {
    const x = 2 * (q.x * q.z + q.w * q.y);
    const y = 2 * (q.y * q.z - q.w * q.x);
    const z = 1 - 2 * (q.x * q.x + q.y * q.y);
    out.set(x, y, z);
}
