import { CollisionTag } from '@/src/physics/SpatialHash';
import {
  BlockedMovementVector,
  PhysicsContactPoint,
  PhysicsWarningRecord,
} from './PhysicsTypes';

export class PhysicsDebugSystem {
  public static readonly MAX_CONTACTS = 64;
  public static readonly MAX_BLOCKED_VECTORS = 48;
  public static readonly MAX_WARNINGS = 64;

  private seqContact = 0;
  private seqWarning = 0;
  private elapsedSec = 0;
  private detailedRecordingEnabled = true;

  private readonly contactsRing: PhysicsContactPoint[] = new Array(PhysicsDebugSystem.MAX_CONTACTS);
  private contactsHead = 0;
  private contactsCount = 0;
  private readonly blockedVectorsRing: BlockedMovementVector[] = new Array(PhysicsDebugSystem.MAX_BLOCKED_VECTORS);
  private blockedHead = 0;
  private blockedCount = 0;
  private warningsList: PhysicsWarningRecord[] = [];
  private lastWarningTime = new Map<string, number>();

  public blockedMovementsTotal = 0;
  public penetrationCorrectionsTotal = 0;
  public ceilingStandupBlocksTotal = 0;
  public tunnelingPreventedTotal = 0;
  public worldBoundaryClampsTotal = 0;
  public vehicleBuildingImpactsTotal = 0;
  public invalidLayerMaskCount = 0;

  private entityPenetrationStreak = new Map<string, number>();

  setDetailedRecordingEnabled(enabled: boolean): void {
    this.detailedRecordingEnabled = enabled;
  }

  isDetailedRecordingEnabled(): boolean {
    return this.detailedRecordingEnabled;
  }

  tick(dt: number): void {
    this.elapsedSec += dt;
  }

  reset(): void {
    this.seqContact = 0;
    this.seqWarning = 0;
    this.elapsedSec = 0;
    this.contactsHead = 0;
    this.contactsCount = 0;
    this.blockedHead = 0;
    this.blockedCount = 0;
    this.warningsList = [];
    this.lastWarningTime.clear();
    this.entityPenetrationStreak.clear();
    this.blockedMovementsTotal = 0;
    this.penetrationCorrectionsTotal = 0;
    this.ceilingStandupBlocksTotal = 0;
    this.tunnelingPreventedTotal = 0;
    this.worldBoundaryClampsTotal = 0;
    this.vehicleBuildingImpactsTotal = 0;
    this.invalidLayerMaskCount = 0;
  }

  recordContact(contact: Omit<PhysicsContactPoint, 'id' | 'timestampSec'>): void {
    this.penetrationCorrectionsTotal++;
    const timestampSec = Math.round(this.elapsedSec * 100) / 100;

    if (this.detailedRecordingEnabled) {
      const cap = PhysicsDebugSystem.MAX_CONTACTS;
      let slot = this.contactsRing[this.contactsHead];
      if (!slot) {
        slot = {
          id: ++this.seqContact,
          entityId: contact.entityId,
          colliderId: contact.colliderId,
          colliderTag: contact.colliderTag,
          pointX: contact.pointX,
          pointY: contact.pointY,
          pointZ: contact.pointZ,
          normalX: contact.normalX,
          normalY: contact.normalY,
          normalZ: contact.normalZ,
          penetrationDepth: contact.penetrationDepth,
          impactSpeed: contact.impactSpeed,
          timestampSec,
        };
        this.contactsRing[this.contactsHead] = slot;
      } else {
        slot.id = ++this.seqContact;
        slot.entityId = contact.entityId;
        slot.colliderId = contact.colliderId;
        slot.colliderTag = contact.colliderTag;
        slot.pointX = contact.pointX;
        slot.pointY = contact.pointY;
        slot.pointZ = contact.pointZ;
        slot.normalX = contact.normalX;
        slot.normalY = contact.normalY;
        slot.normalZ = contact.normalZ;
        slot.penetrationDepth = contact.penetrationDepth;
        slot.impactSpeed = contact.impactSpeed;
        slot.timestampSec = timestampSec;
      }
      this.contactsHead = (this.contactsHead + 1) % cap;
      if (this.contactsCount < cap) this.contactsCount++;
    }

    if (contact.penetrationDepth > 0.08) {
      const streak = (this.entityPenetrationStreak.get(contact.entityId) ?? 0) + 1;
      this.entityPenetrationStreak.set(contact.entityId, streak);
      if (streak >= 10) {
        this.pushWarning({
          ruleId: 'REPEATED_PENETRATION_CORRECTION',
          classification: 'HEURISTIC',
          severity: 'WARNING',
          entityId: contact.entityId,
          subsystem: 'CollisionResponseSystem',
          x: contact.pointX,
          y: contact.pointY,
          z: contact.pointZ,
          description: `${contact.entityId} experienced ${streak} deep penetration corrections against ${contact.colliderId}`,
          expectedBehavior: 'Smooth tangential wall slide after initial contact resolution',
          actualBehavior: `Penetration depth ${contact.penetrationDepth.toFixed(3)}m repeated ${streak} steps`,
          suggestedInvestigation: 'Inspect acute corner geometry or AI waypoint inside solid collider.',
        });
      }
    } else if (this.entityPenetrationStreak.has(contact.entityId)) {
      this.entityPenetrationStreak.set(contact.entityId, 0);
    }
  }

  recordBlockedMovement(vec: Omit<BlockedMovementVector, 'timestampSec'>): void {
    this.blockedMovementsTotal++;
    if (!this.detailedRecordingEnabled) return;

    const timestampSec = Math.round(this.elapsedSec * 100) / 100;
    const cap = PhysicsDebugSystem.MAX_BLOCKED_VECTORS;
    let slot = this.blockedVectorsRing[this.blockedHead];
    if (!slot) {
      slot = {
        entityId: vec.entityId,
        originX: vec.originX,
        originY: vec.originY,
        originZ: vec.originZ,
        desiredDx: vec.desiredDx,
        desiredDz: vec.desiredDz,
        resolvedDx: vec.resolvedDx,
        resolvedDz: vec.resolvedDz,
        blockerId: vec.blockerId,
        normalX: vec.normalX,
        normalY: vec.normalY,
        normalZ: vec.normalZ,
        timestampSec,
      };
      this.blockedVectorsRing[this.blockedHead] = slot;
    } else {
      slot.entityId = vec.entityId;
      slot.originX = vec.originX;
      slot.originY = vec.originY;
      slot.originZ = vec.originZ;
      slot.desiredDx = vec.desiredDx;
      slot.desiredDz = vec.desiredDz;
      slot.resolvedDx = vec.resolvedDx;
      slot.resolvedDz = vec.resolvedDz;
      slot.blockerId = vec.blockerId;
      slot.normalX = vec.normalX;
      slot.normalY = vec.normalY;
      slot.normalZ = vec.normalZ;
      slot.timestampSec = timestampSec;
    }
    this.blockedHead = (this.blockedHead + 1) % cap;
    if (this.blockedCount < cap) this.blockedCount++;
  }

  recordCeilingStandupBlocked(entityId: string, x: number, y: number, z: number, blockerId: string): void {
    this.ceilingStandupBlocksTotal++;
    this.pushWarning({
      ruleId: 'CEILING_STANDUP_BLOCKED',
      classification: 'CONFIRMED',
      severity: 'INFO',
      entityId,
      subsystem: 'CharacterController',
      x,
      y,
      z,
      description: `Blocked crouch/slide stand-up for ${entityId} due to overhead obstruction (${blockerId})`,
      expectedBehavior: 'Character remains crouched until overhead capsule clearance >= 1.80m',
      actualBehavior: `Stand-up prevented safely under ${blockerId}`,
      suggestedInvestigation: 'Nominal physical safety guard — no action required unless ceiling height is misconfigured.',
    });
  }

  recordTunnelingPrevented(
    projectileId: string,
    x: number,
    y: number,
    z: number,
    speed: number,
    blockerId: string
  ): void {
    this.tunnelingPreventedTotal++;
    this.pushWarning({
      ruleId: 'PROJECTILE_TUNNELING_PREVENTED',
      classification: 'CONFIRMED',
      severity: 'INFO',
      entityId: projectileId,
      subsystem: 'ProjectileCCD',
      x,
      y,
      z,
      description: `Swept CCD intercepted high-speed projectile ${projectileId} (${speed.toFixed(1)} m/s) at ${blockerId}`,
      expectedBehavior: 'Continuous swept ray/sphere test catches thin wall impact within single substep',
      actualBehavior: `Intercepted cleanly at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`,
      suggestedInvestigation: 'Nominal CCD interception.',
    });
  }

  recordWorldBoundaryClamp(entityId: string, x: number, y: number, z: number): void {
    this.worldBoundaryClampsTotal++;
    this.pushWarning({
      ruleId: 'OUT_OF_BOUNDS_CLAMP',
      classification: 'CONFIRMED',
      severity: 'INFO',
      entityId,
      subsystem: 'PhysicsWorld',
      x,
      y,
      z,
      description: `${entityId} reached mission perimeter boundary and was clamped at (${x.toFixed(1)}, ${z.toFixed(1)})`,
      expectedBehavior: 'Entities remain inside mission operational perimeter',
      actualBehavior: `Clamped at boundary coordinate (${x.toFixed(1)}, ${z.toFixed(1)})`,
      suggestedInvestigation: 'Check AI retreat/orbit radius if enemy units frequently hit perimeter.',
    });
  }

  recordVehicleImpact(
    vehicleId: string,
    colliderId: string,
    colliderTag: CollisionTag | 'world',
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    penetration: number,
    impactSpeed: number
  ): void {
    this.vehicleBuildingImpactsTotal++;
    this.recordContact({
      entityId: vehicleId,
      colliderId,
      colliderTag,
      pointX: x,
      pointY: y,
      pointZ: z,
      normalX: nx,
      normalY: ny,
      normalZ: nz,
      penetrationDepth: penetration,
      impactSpeed,
    });

    if (impactSpeed > 7.5) {
      this.pushWarning({
        ruleId: 'VEHICLE_BUILDING_OVERLAP',
        classification: 'CONFIRMED',
        severity: 'INFO',
        entityId: vehicleId,
        subsystem: 'VehiclePhysics',
        x,
        y,
        z,
        description: `Vehicle ${vehicleId} impacted ${colliderId} at ${impactSpeed.toFixed(1)} m/s and deflected along normal (${nx.toFixed(2)}, ${nz.toFixed(2)})`,
        expectedBehavior: 'Vehicle deflects with speed loss and hull impact damage without passing through structure',
        actualBehavior: `Deflected cleanly (pen=${penetration.toFixed(3)}m corrected)`,
        suggestedInvestigation: 'Nominal high-speed vehicle collision response.',
      });
    }
  }

  pushWarning(
    w: Omit<PhysicsWarningRecord, 'id' | 'timestampSec'>,
    cooldownSec = 2.5
  ): void {
    const key = `${w.ruleId}:${w.entityId}`;
    const last = this.lastWarningTime.get(key) ?? -999;
    if (this.elapsedSec - last < cooldownSec) return;
    this.lastWarningTime.set(key, this.elapsedSec);

    const rec: PhysicsWarningRecord = {
      ...w,
      id: `phys_warn_${++this.seqWarning}`,
      timestampSec: Number(this.elapsedSec.toFixed(2)),
    };
    this.warningsList.unshift(rec);
    if (this.warningsList.length > PhysicsDebugSystem.MAX_WARNINGS) {
      this.warningsList.length = PhysicsDebugSystem.MAX_WARNINGS;
    }
  }

  getRecentContacts(): PhysicsContactPoint[] {
    const cap = PhysicsDebugSystem.MAX_CONTACTS;
    const out: PhysicsContactPoint[] = [];
    for (let i = 0; i < this.contactsCount; i++) {
      const idx = (this.contactsHead - 1 - i + cap) % cap;
      const item = this.contactsRing[idx];
      if (item) out.push({ ...item });
    }
    return out;
  }

  getBlockedVectors(): BlockedMovementVector[] {
    const cap = PhysicsDebugSystem.MAX_BLOCKED_VECTORS;
    const out: BlockedMovementVector[] = [];
    for (let i = 0; i < this.blockedCount; i++) {
      const idx = (this.blockedHead - 1 - i + cap) % cap;
      const item = this.blockedVectorsRing[idx];
      if (item) out.push({ ...item });
    }
    return out;
  }

  getWarnings(): PhysicsWarningRecord[] {
    return [...this.warningsList];
  }
}
