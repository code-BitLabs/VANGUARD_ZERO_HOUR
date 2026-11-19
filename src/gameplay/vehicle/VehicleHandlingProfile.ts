import * as THREE from 'three';
import { MapId } from '@/src/schemas/common.schema';
import { VehicleDriveGear } from '@/src/schemas/events.schema';
import { VehicleType } from '@/src/schemas/mission.schema';

export interface VehicleHandlingSpec {
  readonly wheelbaseM: number;
  readonly maxSteerAngleRad: number;
  readonly steerResponseRate: number;
  readonly steerCenterRate: number;
  readonly highSpeedSteerFloor: number;
  readonly forwardAccel: number;
  readonly reverseAccel: number;
  readonly maxReverseSpeed: number;
  readonly serviceBrakeDecel: number;
  readonly handbrakeDecel: number;
  readonly rollingDrag: number;
  readonly aeroDrag: number;
  readonly lowGearClimbBoost: number;
  readonly handbrakeTurnBoost: number;
  readonly maxTurretAmmo: number;
}

export interface SurfaceTractionSpec {
  readonly gripMultiplier: number;
  readonly rollingResistanceMultiplier: number;
  readonly steerAuthorityMultiplier: number;
}

export const VEHICLE_HANDLING_SPECS: Record<VehicleType, VehicleHandlingSpec> = {
  military_jeep: {
    wheelbaseM: 2.75,
    maxSteerAngleRad: 0.56,
    steerResponseRate: 9.2,
    steerCenterRate: 7.4,
    highSpeedSteerFloor: 0.54,
    forwardAccel: 23.5,
    reverseAccel: 15.5,
    maxReverseSpeed: 11.5,
    serviceBrakeDecel: 30.0,
    handbrakeDecel: 36.0,
    rollingDrag: 1.9,
    aeroDrag: 0.012,
    lowGearClimbBoost: 1.42,
    handbrakeTurnBoost: 1.38,
    maxTurretAmmo: 180,
  },
  armored_truck: {
    wheelbaseM: 4.1,
    maxSteerAngleRad: 0.46,
    steerResponseRate: 6.8,
    steerCenterRate: 6.2,
    highSpeedSteerFloor: 0.58,
    forwardAccel: 17.0,
    reverseAccel: 12.2,
    maxReverseSpeed: 9.2,
    serviceBrakeDecel: 24.5,
    handbrakeDecel: 30.0,
    rollingDrag: 2.25,
    aeroDrag: 0.015,
    lowGearClimbBoost: 1.55,
    handbrakeTurnBoost: 1.24,
    maxTurretAmmo: 240,
  },
  enemy_technical: {
    wheelbaseM: 3.05,
    maxSteerAngleRad: 0.52,
    steerResponseRate: 8.4,
    steerCenterRate: 7.0,
    highSpeedSteerFloor: 0.54,
    forwardAccel: 21.0,
    reverseAccel: 14.0,
    maxReverseSpeed: 10.5,
    serviceBrakeDecel: 27.0,
    handbrakeDecel: 33.0,
    rollingDrag: 2.0,
    aeroDrag: 0.013,
    lowGearClimbBoost: 1.38,
    handbrakeTurnBoost: 1.32,
    maxTurretAmmo: 160,
  },
  enemy_apc: {
    wheelbaseM: 3.85,
    maxSteerAngleRad: 0.44,
    steerResponseRate: 6.2,
    steerCenterRate: 5.8,
    highSpeedSteerFloor: 0.62,
    forwardAccel: 15.5,
    reverseAccel: 11.5,
    maxReverseSpeed: 8.8,
    serviceBrakeDecel: 23.0,
    handbrakeDecel: 28.0,
    rollingDrag: 2.4,
    aeroDrag: 0.016,
    lowGearClimbBoost: 1.6,
    handbrakeTurnBoost: 1.18,
    maxTurretAmmo: 220,
  },
};

export const MAP_SURFACE_TRACTION: Record<MapId, SurfaceTractionSpec> = {
  warzone_city: {
    gripMultiplier: 1.0,
    rollingResistanceMultiplier: 1.0,
    steerAuthorityMultiplier: 1.0,
  },
  desert_base: {
    gripMultiplier: 0.92,
    rollingResistanceMultiplier: 1.12,
    steerAuthorityMultiplier: 0.95,
  },
  jungle_zone: {
    gripMultiplier: 0.88,
    rollingResistanceMultiplier: 1.2,
    steerAuthorityMultiplier: 0.92,
  },
  industrial_complex: {
    gripMultiplier: 0.97,
    rollingResistanceMultiplier: 1.02,
    steerAuthorityMultiplier: 0.98,
  },
};

export function getVehicleHandlingSpec(type: VehicleType): VehicleHandlingSpec {
  return VEHICLE_HANDLING_SPECS[type] ?? VEHICLE_HANDLING_SPECS.military_jeep;
}

export function getSurfaceTractionForMap(mapId: MapId): SurfaceTractionSpec {
  return MAP_SURFACE_TRACTION[mapId] ?? MAP_SURFACE_TRACTION.warzone_city;
}

export interface VehicleHandlingStepInput {
  type: VehicleType;
  mapId: MapId;
  dt: number;
  gas: number;
  brakeReverse: number;
  steer: number;
  handbrake: boolean;
  speed: number;
  maxSpeed: number;
  steerAngle: number;
  driveGear: VehicleDriveGear;
  reverseConfirmTimer: number;
  /** Positive slopePitchRad means nose is pitched UP (climbing forward, descending in reverse). */
  slopePitchRad: number;
  reverseEnterSpeed: number;
  reverseExitSpeed: number;
  reverseConfirmSec: number;
}

export interface VehicleHandlingStepResult {
  speed: number;
  steerAngle: number;
  driveGear: VehicleDriveGear;
  reverseConfirmTimer: number;
  yawDeltaRad: number;
  effectiveTurnRadiusM: number;
}

/**
 * Pure, deterministic Ackermann + longitudinal slope-torque vehicle step.
 * Guarantees:
 * - Predictable low-speed maneuverability and stable high-speed steering.
 * - True gravity pull on slopes without stalling or uncontrolled rolling when parked.
 * - Consistent forward/brake/reverse hysteresis across keyboard, gamepad, and touch inputs.
 */
export function stepVehicleHandling(input: VehicleHandlingStepInput): VehicleHandlingStepResult {
  const spec = getVehicleHandlingSpec(input.type);
  const surf = getSurfaceTractionForMap(input.mapId);
  const dt = Math.max(0.0001, Math.min(0.1, input.dt));

  let speed = input.speed;
  let steerAngle = input.steerAngle;
  let driveGear = input.driveGear;
  let reverseConfirmTimer = input.reverseConfirmTimer;

  const gas = THREE.MathUtils.clamp(input.gas, 0, 1);
  const brakeReverse = THREE.MathUtils.clamp(input.brakeReverse, 0, 1);
  const steerCmd = THREE.MathUtils.clamp(input.steer, -1, 1);
  const speedRatio = Math.min(1, Math.abs(speed) / Math.max(1, input.maxSpeed));

  // 1. Speed-sensitive progressive steering with self-centering
  const speedAuthority =
    1.0 - (1.0 - spec.highSpeedSteerFloor) * Math.pow(speedRatio, 1.35);
  const targetSteer = steerCmd * speedAuthority * surf.steerAuthorityMultiplier;
  if (Math.abs(steerCmd) > 0.02) {
    steerAngle = THREE.MathUtils.lerp(
      steerAngle,
      targetSteer,
      Math.min(1, dt * spec.steerResponseRate)
    );
  } else {
    const returnRate = spec.steerCenterRate + speedRatio * 4.5;
    steerAngle = THREE.MathUtils.lerp(steerAngle, 0, Math.min(1, dt * returnRate));
    if (Math.abs(steerAngle) < 0.004) steerAngle = 0;
  }

  // 2. Longitudinal slope gravity component: nose-up slope pulls vehicle backwards (-speed)
  const clampedSlope = THREE.MathUtils.clamp(input.slopePitchRad, -0.52, 0.52);
  const slopeGravityAccel = -9.81 * Math.sin(clampedSlope);
  // Low-gear torque multiplication helps climbing steep inclines cleanly in forward or reverse
  const lowGearFactor =
    1.0 + (spec.lowGearClimbBoost - 1.0) * Math.max(0, 1.0 - Math.abs(speed) / 7.0);

  // 3. Drive / Brake / Reverse state machine with 160ms low-speed hysteresis
  if (input.handbrake) {
    reverseConfirmTimer = 0;
    const decel = spec.handbrakeDecel * surf.gripMultiplier * dt;
    if (Math.abs(speed) > decel) {
      speed -= Math.sign(speed) * decel;
    } else {
      speed = 0;
    }
    driveGear = Math.abs(speed) > input.reverseEnterSpeed ? 'BRAKING' : 'NEUTRAL_HOLD';
  } else if (gas > 0.04 && brakeReverse <= 0.04) {
    reverseConfirmTimer = 0;
    if (speed < -0.15) {
      speed = Math.min(0, speed + spec.serviceBrakeDecel * surf.gripMultiplier * gas * dt);
      driveGear = 'BRAKING';
    } else {
      const driveAccel = spec.forwardAccel * lowGearFactor * surf.gripMultiplier * gas;
      const dragAccel = spec.aeroDrag * speed * Math.abs(speed);
      const netAccel = driveAccel + slopeGravityAccel - dragAccel;
      speed = THREE.MathUtils.clamp(speed + netAccel * dt, -spec.maxReverseSpeed, input.maxSpeed);
      if (speed > input.reverseExitSpeed || gas > 0.2) {
        driveGear = 'FORWARD';
      }
    }
  } else if (brakeReverse > 0.04) {
    if (speed > input.reverseEnterSpeed) {
      speed = Math.max(0, speed - spec.serviceBrakeDecel * surf.gripMultiplier * brakeReverse * dt);
      driveGear = 'BRAKING';
      reverseConfirmTimer = 0;
    } else if (driveGear !== 'REVERSE') {
      speed = Math.min(0, speed);
      driveGear = 'NEUTRAL_HOLD';
      reverseConfirmTimer += dt;
      if (reverseConfirmTimer >= input.reverseConfirmSec) {
        driveGear = 'REVERSE';
      }
    }

    if (driveGear === 'REVERSE') {
      const revAccel = spec.reverseAccel * lowGearFactor * surf.gripMultiplier * brakeReverse;
      // Gravity still acts longitudinally on slopes (reversing uphill opposes -revAccel with +gravity if nose-down)
      const netRevAccel = -revAccel + slopeGravityAccel;
      speed = THREE.MathUtils.clamp(speed + netRevAccel * dt, -spec.maxReverseSpeed, 0.25);
    }
  } else {
    // Coasting: rolling resistance + hill-hold brake at near-zero speed on moderate slopes
    reverseConfirmTimer = 0;
    const rollingRate = spec.rollingDrag * surf.rollingResistanceMultiplier;
    const isNearlyStopped = Math.abs(speed) < 0.22;
    const isSteepSlope = Math.abs(clampedSlope) > 0.24;
    if (isNearlyStopped && !isSteepSlope) {
      // Automatic hill-hold prevents parked vehicles from sliding away on mild grades
      speed = 0;
    } else {
      speed += slopeGravityAccel * 0.65 * dt;
      speed = THREE.MathUtils.lerp(speed, 0, Math.min(1, dt * rollingRate));
      if (Math.abs(speed) < 0.06 && !isSteepSlope) {
        speed = 0;
      }
    }

    if (speed > input.reverseExitSpeed) {
      driveGear = 'FORWARD';
    } else if (speed < -input.reverseEnterSpeed) {
      driveGear = 'REVERSE';
    } else {
      driveGear = 'NEUTRAL_HOLD';
    }
  }

  // 4. Ackermann bicycle-model yaw rotation with smooth low-speed ramp & handbrake slip authority
  const absSpeed = Math.abs(speed);
  let yawDeltaRad = 0;
  let effectiveTurnRadiusM = Infinity;
  if (absSpeed > 0.04 && Math.abs(steerAngle) > 0.004) {
    const wheelAngleRad = steerAngle * spec.maxSteerAngleRad;
    const tanWheel = Math.tan(Math.abs(wheelAngleRad));
    if (tanWheel > 0.001) {
      effectiveTurnRadiusM = spec.wheelbaseM / tanWheel;
    }
    const steerSign = Math.sign(steerAngle);
    const reverseSign = speed < -0.05 ? -1 : 1;
    const handbrakeBoost = input.handbrake && absSpeed > 3.0 ? spec.handbrakeTurnBoost : 1.0;
    // Physical Ackermann angular velocity: omega = (v / L) * tan(delta), clamped to comfortable max yaw rate
    const rawOmega = (absSpeed / spec.wheelbaseM) * tanWheel;
    const maxYawRate = (input.type === 'military_jeep' ? 2.55 : 2.05) * handbrakeBoost;
    const clampedOmega = Math.min(maxYawRate, rawOmega * handbrakeBoost);
    yawDeltaRad = -steerSign * reverseSign * clampedOmega * dt;
  }

  return {
    speed,
    steerAngle,
    driveGear,
    reverseConfirmTimer,
    yawDeltaRad,
    effectiveTurnRadiusM,
  };
}
