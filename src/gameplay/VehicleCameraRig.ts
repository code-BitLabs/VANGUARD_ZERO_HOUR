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

  resetForVehicleEntry(vehicle: VehicleCameraTarget, player: PlayerController): void {
    const isHeavy = vehicle.type === 'armored_truck' || vehicle.type === 'enemy_apc';
    this.smoothDist = this.mode === 'orbit' ? (isHeavy ? 12.2 : 10.8) : isHeavy ? 9.4 : 8.2;
    this.pivotInitialized = false;
    player.yaw = vehicle.yaw;
    player.pitch = -0.14;
    this.setFpvHiddenVisibility(vehicle, this.mode !== 'driver_fpv');
  }

  onVehicleExit(vehicle: VehicleCameraTarget | null): void {
    if (vehicle) {
      this.setFpvHiddenVisibility(vehicle, true);
    }
    this.pivotInitialized = false;
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
    baseFov: number
  ): void {
    vehicle.meshRoot.updateMatrixWorld(true);
    const isHeavy = vehicle.type === 'armored_truck' || vehicle.type === 'enemy_apc';
    let targetFov = baseFov;

    if (this.mode === 'driver_fpv') {
      this.setFpvHiddenVisibility(vehicle, false);
      this.debugRay.active = false;

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
      this.setFpvHiddenVisibility(vehicle, true);
      this.debugRay.active = false;

      player.pitch = THREE.MathUtils.clamp(player.pitch, -0.68, 0.58);
      targetFov = Math.max(54, baseFov * 0.84);

      this._opticWorld.copy(vehicle.turretOpticLocal).applyMatrix4(vehicle.meshRoot.matrixWorld);
      const cosP = Math.cos(player.pitch);
      this._fwdDir.set(
        -Math.sin(player.yaw) * cosP,
        Math.sin(player.pitch),
        -Math.cos(player.yaw) * cosP
      );
      // Offset sight slightly behind turret mount so gun barrel sits below lower crosshair without occluding view
      camera.position.set(
        this._opticWorld.x - this._fwdDir.x * 0.42,
        this._opticWorld.y - this._fwdDir.y * 0.28 + 0.14,
        this._opticWorld.z - this._fwdDir.z * 0.42
      );
      this._euler.set(player.pitch, player.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(this._euler);
      camera.updateMatrixWorld(true);
    } else {
      // 'chase' or 'orbit' spring-arm exterior camera
      this.setFpvHiddenVisibility(vehicle, true);

      const isOrbit = this.mode === 'orbit';
      player.pitch = THREE.MathUtils.clamp(player.pitch, -0.95, 0.34);

      const desiredDist = isOrbit ? (isHeavy ? 12.2 : 10.8) : isHeavy ? 9.4 : 8.2;
      const pivotHeight = isHeavy ? 2.65 : 2.35;
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

      // Spring-arm points behind aim direction with slight vertical elevation so roof never fills center screen
      this._armDir
        .set(-this._fwdDir.x, -this._fwdDir.y + (isOrbit ? 0.24 : 0.1), -this._fwdDir.z)
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

      const minOutsideHullDist = vehicle.halfLength + 0.72;
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
      let camZ = this.smoothPivot.z + this._armDir.z * this.smoothDist;

      // If tightly pinched against a wall right behind bumper, elevate cleanly above the cab roof
      if (pinchedNearWall || this.smoothDist < minOutsideHullDist) {
        camY = Math.max(camY, vehicle.position.y + (isHeavy ? 3.15 : 2.8));
      }

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
