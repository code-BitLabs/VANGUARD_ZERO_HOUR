import * as THREE from 'three';
import { PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { SpatialAABB } from '@/src/physics/SpatialHash';
import { VehicleCameraMode } from '@/src/schemas/events.schema';
import { VehicleType } from '@/src/schemas/mission.schema';
import { PlayerController } from './PlayerController';

export const VEHICLE_CAMERA_MODE_ORDER: readonly VehicleCameraMode[] = [
  'chase',
  'driver_fpv',
  'turret',
  'orbit',
];

export const VEHICLE_CAMERA_MODE_LABELS: Record<VehicleCameraMode, string> = {
  chase: 'CHASE CAM',
  driver_fpv: 'DRIVER FPV',
  turret: 'GUNNER TURRET',
  orbit: 'TACTICAL ORBIT',
};

export interface VehicleCameraTarget {
  id: string;
  type: VehicleType;
  position: THREE.Vector3;
  yaw: number;
  chassisPitch: number;
  chassisRoll: number;
  speed: number;
  halfWidth: number;
  halfLength: number;
  collider: SpatialAABB;
  meshRoot: THREE.Group;
  turret: THREE.Object3D;
  driverSeatLocal: THREE.Vector3;
  turretOpticLocal: THREE.Vector3;
  fpvHiddenMeshes: THREE.Object3D[];
}

export interface CameraSpringDebugRay {
  active: boolean;
  originX: number;
  originY: number;
  originZ: number;
  endX: number;
  endY: number;
  endZ: number;
  clamped: boolean;
}

function wrapAngleRad(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class VehicleCameraRig {
  private mode: VehicleCameraMode = 'chase';
  private smoothDist = 8.2;
  private smoothPivot = new THREE.Vector3();
  private pivotInitialized = false;
  private lastVehicleYaw = 0;
  private manualLookHoldTimer = 0;

  private readonly _pivot = new THREE.Vector3();
  private readonly _armDir = new THREE.Vector3();
  private readonly _fwdDir = new THREE.Vector3();
  private readonly _lookTarget = new THREE.Vector3();
  private readonly _seatWorld = new THREE.Vector3();
  private readonly _opticWorld = new THREE.Vector3();
  private readonly _euler = new THREE.Euler(0, 0, 0, 'YXZ');

  private readonly _rayHit: RayHit = {
    hit: false,
    distance: 0,
    pointX: 0,
    pointY: 0,
    pointZ: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    collider: null,
  };

  private readonly debugRay: CameraSpringDebugRay = {
    active: false,
    originX: 0,
    originY: 0,
    originZ: 0,
    endX: 0,
    endY: 0,
    endZ: 0,
    clamped: false,
  };

  getMode(): VehicleCameraMode {
    return this.mode;
  }

  setMode(mode: VehicleCameraMode): void {
    this.mode = mode;
  }

  cycleMode(): VehicleCameraMode {
    const idx = VEHICLE_CAMERA_MODE_ORDER.indexOf(this.mode);
    const next = VEHICLE_CAMERA_MODE_ORDER[(idx + 1) % VEHICLE_CAMERA_MODE_ORDER.length];
    this.mode = next;
    return next;
  }

  notifyManualLookInput(): void {
    this.manualLookHoldTimer = 1.15;
  }

  getManualLookHoldTimer(): number {
    return this.manualLookHoldTimer;
  }

  resetForVehicleEntry(vehicle: VehicleCameraTarget, player: PlayerController): void {
    const isHeavy = vehicle.type === 'armored_truck' || vehicle.type === 'enemy_apc';
    this.smoothDist = this.mode === 'orbit' ? (isHeavy ? 12.2 : 10.8) : isHeavy ? 9.4 : 8.2;
    this.pivotInitialized = false;
    this.lastVehicleYaw = vehicle.yaw;
    this.manualLookHoldTimer = 0;
    player.yaw = vehicle.yaw;
    player.pitch = -0.14;
    this.setFpvHiddenVisibility(vehicle, this.mode !== 'driver_fpv');
  }

  onVehicleExit(vehicle: VehicleCameraTarget | null): void {
    if (vehicle) {
      this.setFpvHiddenVisibility(vehicle, true);
    }
    this.pivotInitialized = false;
    this.manualLookHoldTimer = 0;
    this.debugRay.active = false;
  }

  getDebugRay(): CameraSpringDebugRay {
    return this.debugRay;
  }

  private setFpvHiddenVisibility(vehicle: VehicleCameraTarget, visible: boolean): void {
    for (let i = 0; i < vehicle.fpvHiddenMeshes.length; i++) {
      vehicle.fpvHiddenMeshes[i].visible = visible;
    }
  }

  updateCamera(
    dt: number,
    vehicle: VehicleCameraTarget,
    player: PlayerController,
    camera: THREE.PerspectiveCamera,
    collision: CollisionWorld,
    baseFov: number,
    hasManualLookInput = false
  ): void {
    vehicle.meshRoot.updateMatrixWorld(true);
    const isHeavy = vehicle.type === 'armored_truck' || vehicle.type === 'enemy_apc';
    let targetFov = baseFov;

    const vehYawDelta = this.pivotInitialized
      ? wrapAngleRad(vehicle.yaw - this.lastVehicleYaw)
      : 0;
    this.lastVehicleYaw = vehicle.yaw;

    if (hasManualLookInput) {
      this.manualLookHoldTimer = 1.15;
    } else {
      this.manualLookHoldTimer = Math.max(0, this.manualLookHoldTimer - dt);
    }

    if (this.mode === 'driver_fpv') {
      this.setFpvHiddenVisibility(vehicle, false);
      this.debugRay.active = false;

      if (!hasManualLookInput) {
        player.yaw = wrapAngleRad(player.yaw + vehYawDelta);
      }
      // Clamp head look smoothly to ±106 deg around vehicle forward heading
      const relYaw = THREE.MathUtils.clamp(wrapAngleRad(player.yaw - vehicle.yaw), -1.85, 1.85);
      player.yaw = vehicle.yaw + relYaw;
      player.pitch = THREE.MathUtils.clamp(player.pitch, -0.52, 0.65);

      this._seatWorld.copy(vehicle.driverSeatLocal).applyMatrix4(vehicle.meshRoot.matrixWorld);
      camera.position.copy(this._seatWorld);

      this._euler.set(
        player.pitch + vehicle.chassisPitch * 0.55,
        player.yaw,
        vehicle.chassisRoll * 0.55,
        'YXZ'
      );
      camera.quaternion.setFromEuler(this._euler);
      camera.updateMatrixWorld(true);
    } else if (this.mode === 'turret') {
      this.debugRay.active = false;

      player.pitch = THREE.MathUtils.clamp(player.pitch, -0.68, 0.58);
      // Hide cabin/roof if looking steeply down so turret base never clips lower frustum
      this.setFpvHiddenVisibility(vehicle, player.pitch > -0.35);
      targetFov = Math.max(54, baseFov * 0.84);

      this._opticWorld.copy(vehicle.turretOpticLocal).applyMatrix4(vehicle.meshRoot.matrixWorld);
      const horizFwdX = -Math.sin(player.yaw);
      const horizFwdZ = -Math.cos(player.yaw);
      // Position gunner sight cleanly above and slightly ahead of turret ring so barrel/roof never occlude forward sightline
      camera.position.set(
        this._opticWorld.x + horizFwdX * 0.14,
        Math.max(this._opticWorld.y + 0.16, vehicle.position.y + (isHeavy ? 3.08 : 2.86)),
        this._opticWorld.z + horizFwdZ * 0.14
      );
      this._euler.set(player.pitch, player.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(this._euler);
      camera.updateMatrixWorld(true);
    } else {
      // 'chase' or 'orbit' spring-arm exterior camera
      const isOrbit = this.mode === 'orbit';
      player.pitch = THREE.MathUtils.clamp(player.pitch, -0.95, 0.34);

      // In Chase mode, smoothly follow vehicle heading when the player is not actively dragging look
      if (!isOrbit && !hasManualLookInput && this.manualLookHoldTimer <= 0) {
        player.yaw = wrapAngleRad(player.yaw + vehYawDelta * 0.88);
        if (Math.abs(vehicle.speed) > 0.35) {
          const diff = wrapAngleRad(vehicle.yaw - player.yaw);
          const followRate = 3.2 + Math.min(1, Math.abs(vehicle.speed) / 14) * 3.8;
          player.yaw = wrapAngleRad(player.yaw + diff * Math.min(1, dt * followRate));
        }
      }

      const desiredDist = isOrbit ? (isHeavy ? 12.2 : 10.8) : isHeavy ? 9.4 : 8.2;
      const pivotHeight = isHeavy ? 2.88 : 2.64;
      this._pivot.set(vehicle.position.x, vehicle.position.y + pivotHeight, vehicle.position.z);

      if (!this.pivotInitialized) {
        this.smoothPivot.copy(this._pivot);
        this.smoothDist = desiredDist;
        this.pivotInitialized = true;
      } else {
        const pivotAlpha = Math.min(1, dt * 18);
        this.smoothPivot.lerp(this._pivot, pivotAlpha);
      }

      const cosP = Math.cos(player.pitch);
      this._fwdDir.set(
        -Math.sin(player.yaw) * cosP,
        Math.sin(player.pitch),
        -Math.cos(player.yaw) * cosP
      );

      // Spring-arm always maintains positive vertical elevation above roof plane even when pitching upward
      this._armDir
        .set(
          -this._fwdDir.x,
          Math.max(0.08, -this._fwdDir.y + (isOrbit ? 0.24 : 0.14)),
          -this._fwdDir.z
        )
        .normalize();

      const hitWall = collision.sweptSphereTest(
        this.smoothPivot.x,
        this.smoothPivot.y,
        this.smoothPivot.z,
        this._armDir.x,
        this._armDir.y,
        this._armDir.z,
        desiredDist,
        0.28,
        PHYSICS_MASKS.CAMERA_SPRING,
        this._rayHit,
        vehicle.collider.id
      );

      const minOutsideHullDist = vehicle.halfLength + 0.85;
      let targetDist = desiredDist;
      let pinchedNearWall = false;

      if (hitWall) {
        const wallSafeDist = this._rayHit.distance - 0.32;
        if (wallSafeDist < minOutsideHullDist) {
          targetDist = Math.max(0.85, wallSafeDist);
          pinchedNearWall = true;
        } else {
          targetDist = wallSafeDist;
        }
      }

      // Pull inward rapidly to prevent any 1-frame wall clip; relax outward smoothly
      if (targetDist < this.smoothDist) {
        this.smoothDist = THREE.MathUtils.lerp(this.smoothDist, targetDist, Math.min(1, dt * 26));
      } else {
        this.smoothDist = THREE.MathUtils.lerp(this.smoothDist, targetDist, Math.min(1, dt * 8));
      }

      let camX = this.smoothPivot.x + this._armDir.x * this.smoothDist;
      let camY = this.smoothPivot.y + this._armDir.y * this.smoothDist;
      const camZ = this.smoothPivot.z + this._armDir.z * this.smoothDist;

      // Never allow exterior chase/orbit camera to dip below the vehicle roof/turret plane
      const minRoofClearY = vehicle.position.y + (isHeavy ? 2.82 : 2.58);
      camY = Math.max(camY, minRoofClearY);

      // If tightly pinched against a wall right behind bumper, elevate cleanly above the cab roof and hide self-occluding cab meshes if within hull footprint
      if (pinchedNearWall || this.smoothDist < minOutsideHullDist + 0.6) {
        camY = Math.max(camY, vehicle.position.y + (isHeavy ? 3.2 : 2.88));
      }
      this.setFpvHiddenVisibility(vehicle, this.smoothDist >= vehicle.halfLength + 0.55);

      // Ground terrain floor clearance clamp
      const terrainY = collision.getGroundHeightAt(camX, camZ);
      camY = Math.max(camY, terrainY + 0.55);

      camera.position.set(camX, camY, camZ);
      this._lookTarget
        .copy(this.smoothPivot)
        .addScaledVector(this._fwdDir, 36);
      camera.lookAt(this._lookTarget);
      camera.updateMatrixWorld(true);

      this.debugRay.active = true;
      this.debugRay.originX = this.smoothPivot.x;
      this.debugRay.originY = this.smoothPivot.y;
      this.debugRay.originZ = this.smoothPivot.z;
      this.debugRay.endX = camX;
      this.debugRay.endY = camY;
      this.debugRay.endZ = camZ;
      this.debugRay.clamped = hitWall;
    }


    const speedFovBoost = this.mode === 'chase' ? Math.min(6, Math.abs(vehicle.speed) * 0.22) : 0;
    const desiredFov = targetFov + speedFovBoost;
    const nextFov = THREE.MathUtils.lerp(camera.fov, desiredFov, Math.min(1, dt * 10));
    if (Math.abs(nextFov - camera.fov) > 0.04) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
  }
}
