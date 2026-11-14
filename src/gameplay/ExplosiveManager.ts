import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import {
  CONVENTIONAL_BOMB_ORDER,
  ConventionalBombId,
  EXPLOSIVE_BY_ID,
  ExplosiveId,
} from '@/src/schemas/explosive.schema';
import { TacticalOrdnanceHud } from '@/src/schemas/events.schema';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { AirCombatManager, AirUnit } from './AirCombatManager';
import { CombatTelemetryRecorder } from './CombatTelemetryRecorder';
import { EnemyManager, EnemyUnit } from './EnemyManager';
import { PlayerController } from './PlayerController';
import { ExplosionEvent, ProjectileManager } from './ProjectileManager';
import { VehicleEntity, VehicleManager } from './VehicleManager';

interface DeployedC4 {
  id: string;
  mesh: THREE.Group;
  ledMesh: THREE.Mesh;
  resourceId: string | null;
  worldPos: THREE.Vector3;
  normal: THREE.Vector3;
  attachedVehicle: VehicleEntity | null;
  localOffset: THREE.Vector3;
  armedTimerSec: number;
  beepTimerSec: number;
  detonated: boolean;
}

interface PendingDetonation {
  charge: DeployedC4;
  delaySec: number;
}

interface ActiveStrikeMarker {
  mesh: THREE.Mesh;
  resourceId: string | null;
  remainingSec: number;
}

interface FalloutZone {
  center: THREE.Vector3;
  radius: number;
  remainingSec: number;
  damageTickAccum: number;
}

export interface ExplosiveCallbacks {
  onEnemyKilled: (unit: EnemyUnit, weaponLabel: string) => void;
  onAirKilled: (unit: AirUnit, weaponLabel: string) => void;
  onConvoyDestroyed: (veh: VehicleEntity) => void;
  onDestructibleDestroyed: (id: string, kind: string) => void;
  onAlert: (text: string, durationSec?: number) => void;
}

export class ExplosiveManager {
  public static readonly MAX_DEPLOYED_C4 = 4;
  public static readonly FALLOUT_RADIUS_METERS = 75;
  public static readonly FALLOUT_DURATION_SEC = 60;

  private c4Inventory = 3;
  private c4Detonations = 0;
  private c4Seq = 0;
  private deployedC4: DeployedC4[] = [];
  private pendingC4Detonations: PendingDetonation[] = [];

  private selectedBombIdx = 0;
  private bombCooldownSec = 0;
  private bombStrikesCalled = 0;
  private strikeMarkers: ActiveStrikeMarker[] = [];

  private nukeUsed = false;
  private nukePendingConfirmSec = 0;
  private nukeCountdownSec = 0;
  private nukeTarget = new THREE.Vector3();
  private nukeSirenAccum = 0;
  private activeFalloutZones: FalloutZone[] = [];

  private previewMesh: THREE.Mesh;
  private previewValid = false;
  private previewHitPos = new THREE.Vector3();
  private previewNormal = new THREE.Vector3(0, 1, 0);
  private previewHitColliderId: string | null = null;

  private c4BodyGeo: THREE.BoxGeometry;
  private c4LedGeo: THREE.SphereGeometry;
  private c4BodyMat: THREE.MeshStandardMaterial;
  private c4LedMat: THREE.MeshBasicMaterial;
  private markerGeo: THREE.RingGeometry;
  private markerMat: THREE.MeshBasicMaterial;

  private readonly _rayOrigin = new THREE.Vector3();
  private readonly _rayDir = new THREE.Vector3();
  private readonly _upAxis = new THREE.Vector3(0, 1, 0);
  private readonly _scratchVec = new THREE.Vector3();
  private readonly _blastOrigin = new THREE.Vector3();
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
  private readonly _occHit: RayHit = {
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

  constructor(
    private readonly scene: THREE.Scene,
    private readonly resourceManager: ResourceManager,
    private readonly vfx: VFXPool,
    private readonly audio: AudioManager,
    private readonly projectiles: ProjectileManager,
    private readonly telemetry?: CombatTelemetryRecorder
  ) {
    const previewGeo = new THREE.BoxGeometry(0.32, 0.14, 0.22);
    const previewMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      wireframe: true,
      transparent: true,
      opacity: 0.75,
    });
    this.resourceManager.registerGeometry(previewGeo, 'shared', 'c4_preview_geo');
    this.resourceManager.registerMaterial(previewMat, 'shared', 'c4_preview_mat');
    this.previewMesh = new THREE.Mesh(previewGeo, previewMat);
    this.previewMesh.visible = false;
    this.scene.add(this.previewMesh);
    this.resourceManager.register('object3d', 'shared', () => this.scene.remove(this.previewMesh));

    this.c4BodyGeo = new THREE.BoxGeometry(0.3, 0.12, 0.2);
    this.c4LedGeo = new THREE.SphereGeometry(0.035, 6, 6);
    this.c4BodyMat = new THREE.MeshStandardMaterial({ color: 0x3f4d36, roughness: 0.7, metalness: 0.2 });
    this.c4LedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    this.markerGeo = new THREE.RingGeometry(2.4, 3.0, 32);
    this.markerGeo.rotateX(-Math.PI / 2);
    this.markerMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    });

    this.resourceManager.registerGeometry(this.c4BodyGeo, 'shared', 'c4_body_geo');
    this.resourceManager.registerGeometry(this.c4LedGeo, 'shared', 'c4_led_geo');
    this.resourceManager.registerMaterial(this.c4BodyMat, 'shared', 'c4_body_mat');
    this.resourceManager.registerMaterial(this.c4LedMat, 'shared', 'c4_led_mat');
    this.resourceManager.registerGeometry(this.markerGeo, 'shared', 'strike_marker_geo');
    this.resourceManager.registerMaterial(this.markerMat, 'shared', 'strike_marker_mat');
  }

  reset(): void {
    for (const c of this.deployedC4) {
      this.scene.remove(c.mesh);
      if (c.resourceId) {
        this.resourceManager.release(c.resourceId);
        c.resourceId = null;
      }
    }
    this.deployedC4 = [];
    this.pendingC4Detonations = [];
    for (const m of this.strikeMarkers) {
      this.scene.remove(m.mesh);
      if (m.resourceId) {
        this.resourceManager.release(m.resourceId);
        m.resourceId = null;
      }
    }
    this.strikeMarkers = [];
    this.activeFalloutZones = [];

    this.c4Inventory = 3;
    this.c4Detonations = 0;
    this.selectedBombIdx = 0;
    this.bombCooldownSec = 0;
    this.bombStrikesCalled = 0;
    this.nukeUsed = false;
    this.nukePendingConfirmSec = 0;
    this.nukeCountdownSec = 0;
    this.nukeSirenAccum = 0;
    this.previewMesh.visible = false;
    this.previewValid = false;
  }

  dispose(): void {
    this.reset();
  }

  resupplyC4(amount = 2): void {
    this.c4Inventory = Math.min(6, this.c4Inventory + amount);
  }

  getSelectedBombId(): ConventionalBombId {
    return CONVENTIONAL_BOMB_ORDER[this.selectedBombIdx % CONVENTIONAL_BOMB_ORDER.length];
  }

  cycleBombType(): ConventionalBombId {
    this.selectedBombIdx = (this.selectedBombIdx + 1) % CONVENTIONAL_BOMB_ORDER.length;
    this.audio.play2D('ui_click', 3, 0.35);
    return this.getSelectedBombId();
  }

  getActiveC4Count(): number {
    return this.deployedC4.filter((c) => !c.detonated).length;
  }

  isPlayerInFallout(playerPos: THREE.Vector3): boolean {
    for (const z of this.activeFalloutZones) {
      const dist = Math.hypot(playerPos.x - z.center.x, playerPos.z - z.center.z);
      if (dist <= z.radius) return true;
    }
    return false;
  }

  getFalloutRemainingSec(): number {
    if (this.activeFalloutZones.length === 0) return 0;
    return Math.max(...this.activeFalloutZones.map((z) => z.remainingSec));
  }

  getOrdnanceHud(
    playerPos: THREE.Vector3,
    requisitionPoints: number,
    sandboxAuthorized: boolean
  ): TacticalOrdnanceHud {
    const bombId = this.getSelectedBombId();
    const bombProf = EXPLOSIVE_BY_ID[bombId];
    const nukeProf = EXPLOSIVE_BY_ID.strategic_nuclear_weapon;
    return {
      c4Inventory: this.c4Inventory,
      c4Deployed: this.deployedC4.length,
      c4MaxDeployed: ExplosiveManager.MAX_DEPLOYED_C4,
      c4PlacementValid: this.previewValid,
      selectedBombId: bombId,
      selectedBombShort: bombProf.shortName,
      selectedBombCost: bombProf.requisitionCost,
      bombCooldownSec: Number(this.bombCooldownSec.toFixed(1)),
      bombMaxCooldownSec: bombProf.cooldownSec,
      nukeCost: nukeProf.requisitionCost,
      nukeUsed: this.nukeUsed,
      nukePendingConfirmSec: Number(this.nukePendingConfirmSec.toFixed(1)),
      nukeCountdownSec: Number(this.nukeCountdownSec.toFixed(1)),
      inFalloutZone: this.isPlayerInFallout(playerPos),
      falloutRemainingSec: Number(this.getFalloutRemainingSec().toFixed(1)),
      requisitionPoints,
      sandboxAuthorized,
    };
  }

  getTelemetrySummary() {
    return {
      c4Inventory: this.c4Inventory,
      c4Deployed: this.deployedC4.length,
      c4MaxDeployed: ExplosiveManager.MAX_DEPLOYED_C4,
      c4Detonations: this.c4Detonations,
      bombStrikesCalled: this.bombStrikesCalled,
      selectedBombId: this.getSelectedBombId(),
      bombCooldownSec: Number(this.bombCooldownSec.toFixed(1)),
      nukeUsed: this.nukeUsed,
      nukeCountdownSec: Number(this.nukeCountdownSec.toFixed(1)),
      falloutActive: this.activeFalloutZones.length > 0,
      falloutRemainingSec: Number(this.getFalloutRemainingSec().toFixed(1)),
    };
  }

  updatePreview(
    camera: THREE.PerspectiveCamera,
    collision: CollisionWorld,
    inVehicle: boolean
  ): void {
    if (
      inVehicle ||
      this.c4Inventory <= 0 ||
      this.deployedC4.length >= ExplosiveManager.MAX_DEPLOYED_C4
    ) {
      this.previewValid = false;
      this.previewMesh.visible = false;
      return;
    }

    this._rayOrigin.copy(camera.position);
    camera.getWorldDirection(this._rayDir);
    const hit = collision.sweptSegmentTest(
      this._rayOrigin.x,
      this._rayOrigin.y,
      this._rayOrigin.z,
      this._rayDir.x,
      this._rayDir.y,
      this._rayDir.z,
      4.5,
      COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER | COLLISION_LAYER.DESTRUCTIBLE | COLLISION_LAYER.VEHICLE,
      this._rayHit
    );

    if (!hit) {
      this.previewValid = false;
      this.previewMesh.visible = false;
      return;
    }

    this.previewValid = true;
    this.previewNormal.set(this._rayHit.normalX, this._rayHit.normalY, this._rayHit.normalZ).normalize();
    this.previewHitPos.set(
      this._rayHit.pointX + this.previewNormal.x * 0.08,
      this._rayHit.pointY + this.previewNormal.y * 0.08,
      this._rayHit.pointZ + this.previewNormal.z * 0.08
    );
    this.previewHitColliderId = this._rayHit.collider?.id ?? null;

    this.previewMesh.visible = true;
    this.previewMesh.position.copy(this.previewHitPos);
    this.previewMesh.quaternion.setFromUnitVectors(this._upAxis, this.previewNormal);
  }

  /**
   * Handles [C] press: places C4 when aiming at valid surface <=4.5m & slots remain;
   * otherwise (or when forceDetonate is true) triggers staggered remote detonation of all deployed C4.
   */
  handleC4Action(
    camera: THREE.PerspectiveCamera,
    collision: CollisionWorld,
    vehicles: VehicleManager,
    scope: ResourceScope | null,
    forceDetonate = false,
    onAlert?: (text: string, durationSec?: number) => void
  ): 'placed' | 'detonating' | 'noop' {
    const activeCount = this.getActiveC4Count();
    if (!forceDetonate && this.previewValid && this.c4Inventory > 0 && activeCount < ExplosiveManager.MAX_DEPLOYED_C4) {
      this.placeC4AtPreview(vehicles, scope);
      return 'placed';
    }

    // If at MAX_DEPLOYED_C4 and player is aiming point-blank at a placement surface without Shift+C,
    // refuse the 5th plant instead of accidentally detonating in their face.
    if (!forceDetonate && activeCount >= ExplosiveManager.MAX_DEPLOYED_C4) {
      this._rayOrigin.copy(camera.position);
      camera.getWorldDirection(this._rayDir);
      const aimingAtSurface = collision.sweptSegmentTest(
        this._rayOrigin.x,
        this._rayOrigin.y,
        this._rayOrigin.z,
        this._rayDir.x,
        this._rayDir.y,
        this._rayDir.z,
        4.5,
        COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER | COLLISION_LAYER.DESTRUCTIBLE | COLLISION_LAYER.VEHICLE,
        this._rayHit
      );
      if (aimingAtSurface) {
        onAlert?.(`MAX ${ExplosiveManager.MAX_DEPLOYED_C4} C4 DEPLOYED — PRESS SHIFT+C TO DETONATE`, 2.2);
        return 'noop';
      }
    }

    if (activeCount > 0) {
      const count = this.detonateAllC4();
      onAlert?.(`REMOTE C4 DETONATION (${count} CHARGE${count > 1 ? 'S' : ''})`, 2.0);
      return 'detonating';
    }

    if (this.c4Inventory <= 0) {
      onAlert?.('NO C4 CHARGES REMAINING — COLLECT RESUPPLY CRATE', 2.2);
    } else if (!this.previewValid) {
      this.updatePreview(camera, collision, false);
      if (this.previewValid && this.c4Inventory > 0 && activeCount < ExplosiveManager.MAX_DEPLOYED_C4) {
        this.placeC4AtPreview(vehicles, scope);
        return 'placed';
      }
      onAlert?.('AIM AT SURFACE WITHIN 4.5M TO PLANT C4', 1.8);
    }
    return 'noop';
  }

  private placeC4AtPreview(vehicles: VehicleManager, scope: ResourceScope | null): void {
    const id = `c4_${++this.c4Seq}`;
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.c4BodyGeo, this.c4BodyMat);
    const led = new THREE.Mesh(this.c4LedGeo, this.c4LedMat);
    led.position.set(0, 0.08, 0);
    group.add(body, led);

    group.position.copy(this.previewHitPos);
    group.quaternion.setFromUnitVectors(this._upAxis, this.previewNormal);
    this.scene.add(group);

    let resourceId: string | null = null;
    if (scope) {
      resourceId = this.resourceManager.register('object3d', scope, () => this.scene.remove(group));
    }

    let attachedVehicle: VehicleEntity | null = null;
    const localOffset = new THREE.Vector3();
    if (this.previewHitColliderId) {
      for (const v of vehicles.getVehicles()) {
        if (v.alive && v.collider.id === this.previewHitColliderId) {
          attachedVehicle = v;
          this._scratchVec.copy(this.previewHitPos).sub(v.position);
          this._scratchVec.applyAxisAngle(this._upAxis, -v.yaw);
          localOffset.copy(this._scratchVec);
          break;
        }
      }
    }

    this.c4Inventory--;
    this.deployedC4.push({
      id,
      mesh: group,
      ledMesh: led,
      resourceId,
      worldPos: this.previewHitPos.clone(),
      normal: this.previewNormal.clone(),
      attachedVehicle,
      localOffset,
      armedTimerSec: EXPLOSIVE_BY_ID.c4_charge.detonation.armingDelaySec,
      beepTimerSec: 0.4,
      detonated: false,
    });

    this.audio.play2D('c4_place', 5, 0.65);
    this.telemetry?.recordEvent(
      'C4_EVENT',
      id,
      'ordnance',
      'ground',
      `Placed C4 ${id} (${attachedVehicle ? `attached to ${attachedVehicle.id}` : 'world surface'})`
    );
  }

  detonateAllC4(): number {
    let scheduled = 0;
    const active = this.deployedC4.filter((c) => !c.detonated);
    for (let i = 0; i < active.length; i++) {
      const c = active[i];
      c.detonated = true;
      this.pendingC4Detonations.push({
        charge: c,
        delaySec: i * 0.09, // 90ms staggered chain detonation
      });
      scheduled++;
    }
    this.telemetry?.recordEvent(
      'C4_EVENT',
      'c4_detonator',
      'ordnance',
      'ground',
      `Remote trigger fired for ${scheduled} C4 charge(s)`
    );
    return scheduled;
  }

  callBombStrike(
    camera: THREE.PerspectiveCamera,
    collision: CollisionWorld,
    spendRequisition: (amount: number) => boolean,
    sandboxAuthorized: boolean,
    scope: ResourceScope | null,
    onAlert?: (text: string, durationSec?: number) => void
  ): boolean {
    const bombId = this.getSelectedBombId();
    const prof = EXPLOSIVE_BY_ID[bombId];

    if (this.bombCooldownSec > 0) {
      onAlert?.(`${prof.shortName} ON COOLDOWN (${this.bombCooldownSec.toFixed(1)}s)`, 1.8);
      return false;
    }

    if (!sandboxAuthorized && !spendRequisition(prof.requisitionCost)) {
      onAlert?.(`INSUFFICIENT REQUISITION (${prof.requisitionCost} REQ NEEDED)`, 2.2);
      return false;
    }

    const target = this.acquireGroundTarget(camera, collision);
    this.bombCooldownSec = prof.cooldownSec;
    this.bombStrikesCalled++;

    const dirX = Math.cos(0.45);
    const dirZ = Math.sin(0.45);
    const releaseOrigin = new THREE.Vector3(target.x - dirX * 22, target.y + 82, target.z - dirZ * 22);
    const dir = target.clone().sub(releaseOrigin).normalize();

    this.projectiles.spawn({
      kind: bombId,
      fromPlayer: true,
      origin: releaseOrigin,
      direction: dir,
      targetPoint: target,
      sourceUnitId: 'air_support',
      sourceSquadId: 'player',
      sourceDomain: 'air',
    });

    this.spawnStrikeMarker(target, 4.2, scope);
    this.audio.play2D('bomb_whistle', 7, 0.72);
    onAlert?.(`INBOUND ${prof.shortName} STRIKE ON TARGET`, 2.6);
    this.telemetry?.recordEvent(
      'STRIKE_CALLED',
      bombId,
      'ordnance',
      'air',
      `${prof.shortName} strike designated at (${target.x.toFixed(1)}, ${target.z.toFixed(1)})`
    );
    return true;
  }

  requestStrategicNuke(
    camera: THREE.PerspectiveCamera,
    collision: CollisionWorld,
    requisitionPoints: number,
    sandboxAuthorized: boolean,
    onAlert?: (text: string, durationSec?: number) => void
  ): boolean {
    if (this.nukeUsed) {
      onAlert?.('TRIDENT-X ALREADY DEPLOYED THIS MISSION (MAX 1 PER MISSION)', 2.4);
      return false;
    }
    if (this.nukeCountdownSec > 0) {
      return false;
    }
    const cost = EXPLOSIVE_BY_ID.strategic_nuclear_weapon.requisitionCost;
    if (!sandboxAuthorized && requisitionPoints < cost) {
      onAlert?.(`STRATEGIC AUTHORIZATION REQUIRES ${cost} REQ`, 2.4);
      return false;
    }

    this.nukeTarget.copy(this.acquireGroundTarget(camera, collision));
    this.nukePendingConfirmSec = 4.0;
    this.audio.play2D('ui_click', 6, 0.5);
    this.telemetry?.recordEvent(
      'NUKE_EVENT',
      'trident_x',
      'ordnance',
      'air',
      `Two-step authorization requested for (${this.nukeTarget.x.toFixed(1)}, ${this.nukeTarget.z.toFixed(1)})`
    );
    return true;
  }

  confirmStrategicNuke(
    spendRequisition: (amount: number) => boolean,
    sandboxAuthorized: boolean,
    scope: ResourceScope | null,
    onAlert?: (text: string, durationSec?: number) => void
  ): boolean {
    if (this.nukePendingConfirmSec <= 0 || this.nukeUsed) return false;
    const cost = EXPLOSIVE_BY_ID.strategic_nuclear_weapon.requisitionCost;
    if (!sandboxAuthorized && !spendRequisition(cost)) {
      this.nukePendingConfirmSec = 0;
      onAlert?.(`INSUFFICIENT REQUISITION (${cost} REQ)`, 2.2);
      return false;
    }

    this.nukePendingConfirmSec = 0;
    this.nukeUsed = true;
    this.nukeCountdownSec = 5.0;
    this.nukeSirenAccum = 0;
    this.spawnStrikeMarker(this.nukeTarget, 6.0, scope);
    this.audio.play2D('nuke_siren', 9, 0.78);
    onAlert?.('STRATEGIC STRIKE CONFIRMED — TAKE COVER IMMEDIATELY (5.0s)', 3.5);
    this.telemetry?.recordEvent(
      'NUKE_EVENT',
      'trident_x',
      'ordnance',
      'air',
      `TRIDENT-X launch confirmed — 5.0s impact countdown initiated`
    );
    return true;
  }

  cancelStrategicNuke(): void {
    if (this.nukePendingConfirmSec > 0) {
      this.nukePendingConfirmSec = 0;
      this.audio.play2D('ui_click', 3, 0.35);
    }
  }

  private acquireGroundTarget(camera: THREE.PerspectiveCamera, collision: CollisionWorld): THREE.Vector3 {
    this._rayOrigin.copy(camera.position);
    camera.getWorldDirection(this._rayDir);
    const hit = collision.sweptSegmentTest(
      this._rayOrigin.x,
      this._rayOrigin.y,
      this._rayOrigin.z,
      this._rayDir.x,
      this._rayDir.y,
      this._rayDir.z,
      140,
      COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER | COLLISION_LAYER.DESTRUCTIBLE | COLLISION_LAYER.VEHICLE,
      this._rayHit
    );
    if (hit) {
      return new THREE.Vector3(this._rayHit.pointX, this._rayHit.pointY, this._rayHit.pointZ);
    }
    const tx = THREE.MathUtils.clamp(camera.position.x + this._rayDir.x * 55, -96, 96);
    const tz = THREE.MathUtils.clamp(camera.position.z + this._rayDir.z * 55, -96, 96);
    return new THREE.Vector3(tx, collision.getGroundHeightAt(tx, tz), tz);
  }

  private spawnStrikeMarker(pos: THREE.Vector3, durationSec: number, scope: ResourceScope | null): void {
    const mesh = new THREE.Mesh(this.markerGeo, this.markerMat);
    mesh.position.set(pos.x, pos.y + 0.2, pos.z);
    this.scene.add(mesh);
    let resourceId: string | null = null;
    if (scope) {
      resourceId = this.resourceManager.register('object3d', scope, () => this.scene.remove(mesh));
    }
    this.strikeMarkers.push({ mesh, resourceId, remainingSec: durationSec });
  }

  update(
    dt: number,
    player: PlayerController,
    camera: THREE.PerspectiveCamera,
    collision: CollisionWorld,
    enemies: EnemyManager,
    vehicles: VehicleManager,
    airCombat: AirCombatManager,
    destruction: DestructionSystem,
    inVehicle: boolean,
    reducedMotion: boolean,
    callbacks: ExplosiveCallbacks
  ): void {
    this.bombCooldownSec = Math.max(0, this.bombCooldownSec - dt);
    if (this.nukePendingConfirmSec > 0) {
      this.nukePendingConfirmSec = Math.max(0, this.nukePendingConfirmSec - dt);
    }

    this.updatePreview(camera, collision, inVehicle);

    // Update deployed C4 charges (attachment to vehicles + LED beep)
    for (const c of this.deployedC4) {
      if (c.detonated) continue;
      c.armedTimerSec = Math.max(0, c.armedTimerSec - dt);
      if (c.attachedVehicle) {
        if (!c.attachedVehicle.alive) {
          c.attachedVehicle = null;
        } else {
          this._scratchVec.copy(c.localOffset).applyAxisAngle(this._upAxis, c.attachedVehicle.yaw);
          c.worldPos.copy(c.attachedVehicle.position).add(this._scratchVec);
          c.mesh.position.copy(c.worldPos);
        }
      }
      c.beepTimerSec -= dt;
      if (c.beepTimerSec <= 0) {
        c.beepTimerSec = 1.15;
        c.ledMesh.visible = !c.ledMesh.visible;
        if (c.worldPos.distanceTo(player.position) < 28) {
          this.audio.playSpatial('c4_beep', c.worldPos.x, c.worldPos.y, c.worldPos.z, 3, 0.35);
        }
      }
    }

    // Staggered C4 detonations
    for (let i = this.pendingC4Detonations.length - 1; i >= 0; i--) {
      const pend = this.pendingC4Detonations[i];
      pend.delaySec -= dt;
      if (pend.delaySec <= 0) {
        this.pendingC4Detonations.splice(i, 1);
        const c = pend.charge;
        this.scene.remove(c.mesh);
        if (c.resourceId) {
          this.resourceManager.release(c.resourceId);
          c.resourceId = null;
        }
        this.deployedC4 = this.deployedC4.filter((item) => item.id !== c.id);
        this.c4Detonations++;

        const prof = EXPLOSIVE_BY_ID.c4_charge;
        this.vfx.spawnExplosion(c.worldPos.x, c.worldPos.y, c.worldPos.z, 1.8);
        this.audio.playSpatial('explosion', c.worldPos.x, c.worldPos.y, c.worldPos.z, 9, 0.95);

        this.resolveExplosion(
          {
            explosiveId: 'c4_charge',
            category: prof.category,
            x: c.worldPos.x,
            y: c.worldPos.y,
            z: c.worldPos.z,
            innerRadius: prof.blast.innerRadius,
            radius: prof.blast.outerRadius,
            damage: prof.blast.maxDamage,
            falloffExponent: prof.blast.falloffExponent,
            vehicleDamageMultiplier: prof.blast.vehicleDamageMultiplier,
            destructionPower: prof.blast.destructionPower,
            fromPlayer: true,
            sourceUnitId: 'player',
            sourceSquadId: 'player',
            sourceDomain: 'ground',
          },
          player,
          collision,
          enemies,
          vehicles,
          airCombat,
          destruction,
          reducedMotion,
          callbacks
        );
      }
    }

    // Update ground target rings
    for (let i = this.strikeMarkers.length - 1; i >= 0; i--) {
      const m = this.strikeMarkers[i];
      m.remainingSec -= dt;
      const pulse = 1 + Math.sin(m.remainingSec * 12) * 0.16;
      m.mesh.scale.set(pulse, pulse, 1);
      if (m.remainingSec <= 0) {
        this.scene.remove(m.mesh);
        if (m.resourceId) {
          this.resourceManager.release(m.resourceId);
          m.resourceId = null;
        }
        this.strikeMarkers.splice(i, 1);
      }
    }

    // Strategic Nuclear Countdown -> Launch Delivery Projectile
    if (this.nukeCountdownSec > 0) {
      this.nukeCountdownSec = Math.max(0, this.nukeCountdownSec - dt);
      this.nukeSirenAccum += dt;
      if (this.nukeSirenAccum >= 1.65 && this.nukeCountdownSec > 0.4) {
        this.nukeSirenAccum = 0;
        this.audio.play2D('nuke_siren', 9, 0.72);
      }

      if (this.nukeCountdownSec <= 0) {
        const launchOrigin = new THREE.Vector3(this.nukeTarget.x - 16, this.nukeTarget.y + 92, this.nukeTarget.z - 16);
        const dir = this.nukeTarget.clone().sub(launchOrigin).normalize();
        this.projectiles.spawn({
          kind: 'strategic_nuclear_weapon',
          fromPlayer: true,
          origin: launchOrigin,
          direction: dir,
          targetPoint: this.nukeTarget,
          sourceUnitId: 'strategic_command',
          sourceSquadId: 'player',
          sourceDomain: 'air',
        });
      }
    }

    // Tactical Fallout Hazard Zone environmental decay (4.5 HP/s)
    for (let i = this.activeFalloutZones.length - 1; i >= 0; i--) {
      const zone = this.activeFalloutZones[i];
      zone.remainingSec -= dt;
      zone.damageTickAccum += dt;
      if (zone.damageTickAccum >= 0.5) {
        const stepDmg = 4.5 * zone.damageTickAccum;
        zone.damageTickAccum = 0;

        if (player.alive) {
          const dp = Math.hypot(player.position.x - zone.center.x, player.position.z - zone.center.z);
          if (dp <= zone.radius) {
            player.applyDamage(stepDmg, zone.center.x, zone.center.z);
          }
        }
        for (const u of enemies.getUnits()) {
          if (!u.alive) continue;
          const de = Math.hypot(u.position.x - zone.center.x, u.position.z - zone.center.z);
          if (de <= zone.radius) {
            const killed = enemies.damageUnit(u, stepDmg * 2.2, false);
            if (killed) callbacks.onEnemyKilled(u, 'FALLOUT');
          }
        }
      }

      if (zone.remainingSec <= 0) {
        this.activeFalloutZones.splice(i, 1);
      }
    }
  }

  /**
   * Centralized explosion resolver with per-(explosionId, entityId) deduplication guard,
   * occlusion attenuation, vehicle/destruction multipliers, and full telemetry recording.
   */
  resolveExplosion(
    ev: ExplosionEvent,
    player: PlayerController,
    collision: CollisionWorld,
    enemies: EnemyManager,
    vehicles: VehicleManager,
    airCombat: AirCombatManager,
    destruction: DestructionSystem,
    reducedMotion: boolean,
    callbacks: ExplosiveCallbacks
  ): number {
    const explosionId = this.telemetry?.nextExplosionId() ?? Math.floor(Math.random() * 1e6);
    const damagedIds = new Set<string>();
    const isStrategic = ev.explosiveId === 'strategic_nuclear_weapon';

    let entitiesHit = 0;
    let occludedCount = 0;
    let totalDamageDealt = 0;

    if (isStrategic) {
      this.vfx.spawnStrategicNukeVfx(ev.x, ev.y, ev.z, reducedMotion);
      this.audio.play2D('nuke_detonation', 10, 0.96);
      this.activeFalloutZones.push({
        center: new THREE.Vector3(ev.x, ev.y, ev.z),
        radius: ExplosiveManager.FALLOUT_RADIUS_METERS,
        remainingSec: ExplosiveManager.FALLOUT_DURATION_SEC,
        damageTickAccum: 0,
      });
      callbacks.onAlert('TRIDENT-X DETONATION — FALLOUT HAZARD ZONE ACTIVE (60s)', 4.2);
    }

    const computeFalloff = (dist: number): number => {
      if (dist > ev.radius) return 0;
      if (dist <= ev.innerRadius) return 1;
      const t = (dist - ev.innerRadius) / Math.max(0.5, ev.radius - ev.innerRadius);
      return Math.pow(Math.max(0, 1 - t), ev.falloffExponent);
    };

    const checkOcclusion = (tx: number, ty: number, tz: number): number => {
      if (isStrategic) return 1.0; // Strategic shockwave wraps around light cover
      const sampleOffsets = [-0.45, 0.0, 0.55];
      let totalFactor = 0;
      let anyBlocked = false;

      for (let s = 0; s < sampleOffsets.length; s++) {
        const sy = ty + sampleOffsets[s];
        const dx = tx - ev.x;
        const dy = sy - (ev.y + 0.35);
        const dz = tz - ev.z;
        const len = Math.hypot(dx, dy, dz);
        if (len < 0.6) {
          totalFactor += 1.0;
          continue;
        }
        const blocked = collision.sweptSegmentTest(
          ev.x,
          ev.y + 0.35,
          ev.z,
          dx / len,
          dy / len,
          dz / len,
          Math.max(0.1, len - 0.35),
          COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER | COLLISION_LAYER.WINDOW_SILL,
          this._occHit
        );
        if (blocked) {
          anyBlocked = true;
          const hitCollider = this._occHit.collider;
          // Solid building walls and interior walls completely block blast rays (0.0);
          // low cover barriers and window sills attenuate blast waves (0.30).
          const isSolidBuildingWall =
            hitCollider &&
            (hitCollider.tag === 'building_wall' ||
              hitCollider.tag === 'building_interior_wall' ||
              hitCollider.tag === 'building_ceiling' ||
              ((hitCollider.layer & COLLISION_LAYER.WORLD) !== 0 &&
                hitCollider.maxY - hitCollider.minY >= 2.2));
          totalFactor += isSolidBuildingWall ? 0.0 : 0.3;
        } else {
          totalFactor += 1.0;
        }
      }

      if (anyBlocked) {
        occludedCount++;
      }
      return totalFactor / sampleOffsets.length;
    };

    const shakeRange = Math.max(26, ev.radius * 1.8);
    const distToPlayer = Math.hypot(
      player.position.x - ev.x,
      player.position.y + 1 - ev.y,
      player.position.z - ev.z
    );
    if (distToPlayer < shakeRange) {
      player.addCameraShake(Math.max(0.15, (isStrategic ? 1.0 : 0.78) * (1 - distToPlayer / shakeRange)));
    }

    // 1. Player radial splash & physical blast impulse (guarded by explosionId)
    if (distToPlayer <= ev.radius && player.alive) {
      if (damagedIds.has('player')) {
        this.telemetry?.recordDuplicateDamageBlocked();
      } else {
        damagedIds.add('player');
        const falloff = computeFalloff(distToPlayer);
        const occ = checkOcclusion(player.position.x, player.position.y + 1.0, player.position.z);
        if (occ > 0.05 && distToPlayer > 0.1) {
          const pushStrength = Math.min(8.5, (ev.damage / 120) * 5.2 * falloff * occ);
          const pdx = (player.position.x - ev.x) / distToPlayer;
          const pdz = (player.position.z - ev.z) / distToPlayer;
          player.velocity.x += pdx * pushStrength;
          player.velocity.z += pdz * pushStrength;
          player.velocity.y = Math.max(player.velocity.y, Math.min(4.2, pushStrength * 0.45));
        }
        const selfScale = ev.fromPlayer && !isStrategic ? 0.35 : 0.48;
        const dmg = ev.damage * selfScale * falloff * occ;
        const applied = player.applyValidatedExplosionDamage(explosionId, dmg, ev.x, ev.z);
        if (applied > 0) {
          entitiesHit++;
          totalDamageDealt += applied;
          const { armorAbsorbed, healthLost } = player.getLastDamageBreakdown();
          const shotId = this.telemetry?.nextShotId() ?? explosionId;
          this.telemetry?.recordPlayerDamage(
            shotId,
            ev.sourceUnitId,
            ev.sourceSquadId,
            ev.sourceDomain,
            'enemy_rocket',
            'splash',
            applied,
            armorAbsorbed,
            healthLost
          );
        }
      }
    }

    // 2. Ground Enemies
    const label = EXPLOSIVE_BY_ID[ev.explosiveId]?.shortName ?? 'EXPLOSIVE';
    for (const u of enemies.getUnits()) {
      if (!u.alive) continue;
      const dist = Math.hypot(u.position.x - ev.x, u.position.y + 1 - ev.y, u.position.z - ev.z);
      if (dist > ev.radius) continue;
      if (damagedIds.has(u.id)) {
        this.telemetry?.recordDuplicateDamageBlocked();
        continue;
      }
      damagedIds.add(u.id);
      const falloff = computeFalloff(dist);
      const occ = checkOcclusion(u.position.x, u.position.y + 1.0, u.position.z);
      const dmg = ev.damage * falloff * occ;
      if (dmg > 0.5) {
        entitiesHit++;
        totalDamageDealt += dmg;
        const killed = enemies.damageUnit(u, dmg, false);
        if (killed) {
          callbacks.onEnemyKilled(u, label);
        }
      }
    }

    // 3. Vehicles
    for (const v of vehicles.getVehicles()) {
      if (!v.alive) continue;
      const dist = Math.hypot(v.position.x - ev.x, v.position.y + 1 - ev.y, v.position.z - ev.z);
      if (dist > ev.radius + 1.8) continue;
      if (damagedIds.has(v.id)) {
        this.telemetry?.recordDuplicateDamageBlocked();
        continue;
      }
      damagedIds.add(v.id);
      const falloff = Math.max(0.2, computeFalloff(Math.max(0, dist - 1.5)));
      const occ = checkOcclusion(v.position.x, v.position.y + 1.2, v.position.z);
      const dmg = ev.damage * ev.vehicleDamageMultiplier * falloff * occ;
      if (dmg > 0.5) {
        entitiesHit++;
        totalDamageDealt += dmg;
        vehicles.damageVehicle(v, dmg, callbacks.onConvoyDestroyed);
      }
    }

    // 4. Air Units
    const airRadius = isStrategic ? ev.radius * 1.25 : ev.radius + 3.2;
    for (const a of airCombat.getUnits()) {
      if (!a.alive || a.crashing) continue;
      const dist = Math.hypot(a.position.x - ev.x, a.position.y - ev.y, a.position.z - ev.z);
      if (dist > airRadius) continue;
      if (damagedIds.has(a.id)) {
        this.telemetry?.recordDuplicateDamageBlocked();
        continue;
      }
      damagedIds.add(a.id);
      const falloff = isStrategic ? Math.max(0.45, 1 - dist / airRadius) : Math.max(0.35, 1 - dist / (airRadius + 0.5));
      const dmg = ev.damage * ev.vehicleDamageMultiplier * falloff;
      if (dmg > 0.5) {
        entitiesHit++;
        totalDamageDealt += dmg;
        airCombat.damageUnit(a, dmg, (unit) => callbacks.onAirKilled(unit, label));
      }
    }

    // 5. Destructible Cover & Objective Targets (chain-guarded by damagedIds)
    this._blastOrigin.set(ev.x, ev.y, ev.z);
    for (const d of destruction.getAll()) {
      if (d.state === 'DESTROYED') continue;
      const dist = d.position.distanceTo(this._blastOrigin);
      if (dist > ev.radius) continue;
      if (damagedIds.has(d.id)) {
        this.telemetry?.recordDuplicateDamageBlocked();
        continue;
      }
      damagedIds.add(d.id);
      const prevState = d.state;
      const falloff = computeFalloff(dist);
      const dmg = ev.damage * ev.destructionPower * Math.max(0.25, falloff);
      entitiesHit++;
      totalDamageDealt += dmg;
      destruction.applyDamage(
        d.id,
        dmg,
        (cx, cy, cz, cr, cd) => {
          this.resolveExplosion(
            {
              explosiveId: 'grenade_shell',
              category: 'launcher',
              x: cx,
              y: cy,
              z: cz,
              innerRadius: 1.5,
              radius: cr,
              damage: cd,
              falloffExponent: 1.3,
              vehicleDamageMultiplier: 1.2,
              destructionPower: 1.3,
              fromPlayer: ev.fromPlayer,
              sourceUnitId: d.id,
              sourceSquadId: 'world',
              sourceDomain: 'ground',
            },
            player,
            collision,
            enemies,
            vehicles,
            airCombat,
            destruction,
            reducedMotion,
            callbacks
          );
        },
        (destroyedEnt) => callbacks.onDestructibleDestroyed(destroyedEnt.id, destroyedEnt.kind)
      );
      if (d.state !== prevState) {
        this.telemetry?.recordDestruction({
          id: d.id,
          kind: d.kind,
          previousState: prevState,
          newState: d.state,
          isObjective: d.isObjectiveTarget,
        });
      }
    }

    this.telemetry?.recordExplosion({
      explosionId,
      explosiveId: ev.explosiveId,
      category: ev.category,
      x: Number(ev.x.toFixed(1)),
      y: Number(ev.y.toFixed(1)),
      z: Number(ev.z.toFixed(1)),
      innerRadius: ev.innerRadius,
      outerRadius: ev.radius,
      maxDamage: ev.damage,
      entitiesHit,
      occludedCount,
      totalDamageDealt: Number(totalDamageDealt.toFixed(1)),
      isStrategic,
    });

    return explosionId;
  }
}
