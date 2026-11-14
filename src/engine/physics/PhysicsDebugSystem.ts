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

  private contactsRing: PhysicsContactPoint[] = [];
  private blockedVectorsRing: BlockedMovementVector[] = [];
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

  tick(dt: number): void {
    this.elapsedSec += dt;
  }

  reset(): void {
    this.seqContact = 0;
    this.seqWarning = 0;
    this.elapsedSec = 0;
    this.contactsRing = [];
    this.blockedVectorsRing = [];
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
    const full: PhysicsContactPoint = {
      ...contact,
      id: ++this.seqContact,
      timestampSec: Number(this.elapsedSec.toFixed(2)),
    };
    if (this.contactsRing.length >= PhysicsDebugSystem.MAX_CONTACTS) {
      this.contactsRing.shift();
    }
    this.contactsRing.push(full);

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
    } else {
      this.entityPenetrationStreak.set(contact.entityId, 0);
    }
  }

  recordBlockedMovement(vec: Omit<BlockedMovementVector, 'timestampSec'>): void {
    this.blockedMovementsTotal++;
    const full: BlockedMovementVector = {
      ...vec,
      timestampSec: Number(this.elapsedSec.toFixed(2)),
    };
    if (this.blockedVectorsRing.length >= PhysicsDebugSystem.MAX_BLOCKED_VECTORS) {
      this.blockedVectorsRing.shift();
    }
    this.blockedVectorsRing.push(full);
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
    return [...this.contactsRing].reverse();
  }

  getBlockedVectors(): BlockedMovementVector[] {
    return [...this.blockedVectorsRing].reverse();
  }

  getWarnings(): PhysicsWarningRecord[] {
    return [...this.warningsList];
  }
}
