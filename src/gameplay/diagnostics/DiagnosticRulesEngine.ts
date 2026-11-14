import {
  CombatDebugSnapshot,
  DiagnosticWarning,
} from '@/src/gameplay/CombatTelemetryRecorder';

export class DiagnosticRulesEngine {
  private seq = 0;
  private lastTriggered = new Map<string, number>();
  private activeWarnings: DiagnosticWarning[] = [];

  reset(): void {
    this.seq = 0;
    this.lastTriggered.clear();
    this.activeWarnings = [];
  }

  evaluate(snapshot: CombatDebugSnapshot): DiagnosticWarning[] {
    const now = snapshot.metrics.elapsedSec;
    const recentEventIds = snapshot.recentEvents.slice(0, 6).map((e) => e.id);

    const pushWarning = (
      ruleId: string,
      severity: DiagnosticWarning['severity'],
      subsystem: string,
      entityId: string,
      measuredEvidence: string,
      expectedBehavior: string,
      actualBehavior: string,
      suggestedInvestigation: string,
      cooldownSec = 3.0
    ) => {
      const key = `${ruleId}:${entityId}`;
      const last = this.lastTriggered.get(key) ?? -999;
      if (now - last < cooldownSec) return;
      this.lastTriggered.set(key, now);

      const warning: DiagnosticWarning = {
        id: `warn_${++this.seq}`,
        ruleId,
        severity,
        timestampSec: Number(now.toFixed(2)),
        subsystem,
        entityId,
        measuredEvidence,
        expectedBehavior,
        actualBehavior,
        suggestedInvestigation,
        eventIds: recentEventIds,
      };
      this.activeWarnings.unshift(warning);
      if (this.activeWarnings.length > 80) {
        this.activeWarnings.length = 80;
      }
    };

    // Rule 1: AI Token Cap Violation
    if (snapshot.coordinator.currentGlobalAttackers > snapshot.coordinator.maxGlobalAttackers) {
      pushWarning(
        'AI_TOKEN_CAP_VIOLATION',
        'CRITICAL',
        'SquadCoordination',
        'coordinator',
        `active=${snapshot.coordinator.currentGlobalAttackers}, cap=${snapshot.coordinator.maxGlobalAttackers}`,
        `Active global attackers <= ${snapshot.coordinator.maxGlobalAttackers}`,
        `${snapshot.coordinator.currentGlobalAttackers} simultaneous attackers active`,
        'Inspect CombatEngagementCoordinator.requestLease and difficulty cap enforcement.'
      );
    }

    // Rule 2: Invalid attack attempts without token
    if (snapshot.metrics.invalidAttackAttempts > 0) {
      pushWarning(
        'AI_UNAUTH_ATTACK_ATTEMPT',
        'WARNING',
        'EnemyAI',
        'coordinator',
        `invalidAttackAttempts=${snapshot.metrics.invalidAttackAttempts}`,
        '0 unleased firing attempts',
        `${snapshot.metrics.invalidAttackAttempts} attempts blocked without valid token`,
        'Check EnemyManager/AirCombatManager firing gate before ballistics.fireWeaponRay.'
      );
    }

    // Rule 3: Omniscient detection / Firing without LOS
    for (const u of snapshot.enemies) {
      const blockedBypass = u.state === 'ENGAGING' && !u.hasLos && u.allowedToFire;
      if (blockedBypass) {
        pushWarning(
          'AI_OMNISCIENT_DETECTION',
          'CRITICAL',
          'EnemyAI',
          u.id,
          `state=${u.state}, hasLos=${u.hasLos}, blocker=${u.losBlockerId ?? 'none'}, blockedShots=${u.blockedShotAttempts ?? 0}`,
          'Unit blocks firing immediately when LOS is occluded and transitions cleanly after grace',
          'Unit authorized to fire while LOS is blocked',
          'Inspect EnemyManager/AirCombatManager LOS firing gate and lease release paths.'
        );
      }
      if ((u.invalidTransitionCount ?? 0) > 0) {
        pushWarning(
          'AI_INVALID_STATE_TRANSITION',
          'WARNING',
          'EnemyAI',
          u.id,
          `invalidTransitions=${u.invalidTransitionCount}, edge=${u.lastTransition ?? u.state}`,
          'All awareness FSM transitions follow valid state graph edges',
          `${u.invalidTransitionCount} unexpected FSM jump(s) detected`,
          'Review EnemyManager awareness state updates.'
        );
      }
    }

    // Rule 4: Flight & Projectile Speed Outliers
    for (const f of snapshot.flightSamples) {
      if (f.speedOutlier || f.speed > f.maxSpeed * 1.06) {
        pushWarning(
          'FLIGHT_SPEED_OUTLIER',
          'WARNING',
          'ProjectilesAndFlight',
          f.id,
          `speed=${f.speed.toFixed(1)} m/s, max=${f.maxSpeed.toFixed(1)} m/s (${f.category})`,
          `Speed clamped <= ${(f.maxSpeed * 1.05).toFixed(1)} m/s`,
          `Measured speed ${f.speed.toFixed(1)} m/s`,
          'Check boost integration or dt clamp in ProjectileManager / AirCombatManager.'
        );
      }
      if (f.maxTurnRateDegPerSec > 0 && f.turnRateDegPerSec > f.maxTurnRateDegPerSec * 1.15) {
        pushWarning(
          'FLIGHT_ANGULAR_SNAP',
          'WARNING',
          'ProjectilesAndFlight',
          f.id,
          `turnRate=${f.turnRateDegPerSec.toFixed(1)} deg/s, limit=${f.maxTurnRateDegPerSec} deg/s`,
          `Angular turn rate <= ${f.maxTurnRateDegPerSec} deg/s`,
          `Turn rate spike ${f.turnRateDegPerSec.toFixed(1)} deg/s`,
          'Check angular slerp clamp in homing / aircraft steering.'
        );
      }
    }

    // Rule 5: Duplicate explosion/shot damage blocked
    if (snapshot.metrics.duplicateDamageBlockedCount > 0) {
      pushWarning(
        'EXPLOSION_DUPLICATE_DAMAGE_GUARD',
        'INFO',
        'CombatAndDamage',
        'explosion_guard',
        `blockedCount=${snapshot.metrics.duplicateDamageBlockedCount}`,
        'Each (explosionId/shotId, entityId) pair damaged at most once',
        `Guard prevented ${snapshot.metrics.duplicateDamageBlockedCount} duplicate hit(s)`,
        'Verify multi-collider entities do not trigger overlapping splash probes.'
      );
    }

    // Rule 6: Performance Frame Spike (ignore initial 1.5s warmup & stale historical spikes)
    const spikeAgeSec = snapshot.performance.lastSpikeAgeSec ?? 999;
    const isSustainedSlow = snapshot.performance.p95FrameMs > 33.3 && snapshot.metrics.elapsedSec >= 1.5;
    const isFreshSpike =
      snapshot.metrics.elapsedSec >= 1.5 && spikeAgeSec <= 6.0 && snapshot.performance.lastSpikeMs > 42;
    if (isSustainedSlow || isFreshSpike) {
      pushWarning(
        'PERF_FRAME_SPIKE',
        snapshot.performance.lastSpikeMs > 55 || snapshot.performance.p95FrameMs > 40 ? 'CRITICAL' : 'WARNING',
        'Performance',
        snapshot.performance.lastSpikeSubsystem,
        `p95=${snapshot.performance.p95FrameMs}ms, lastSpike=${snapshot.performance.lastSpikeMs}ms (${spikeAgeSec}s ago)`,
        'Frame time <= 33.3ms (30+ FPS)',
        `Frame spike in ${snapshot.performance.lastSpikeSubsystem}`,
        'Inspect PerformanceGovernor quality tier, draw calls, and pooled VFX budget.',
        6.0
      );
    }

    // Rule 7: Resource Leak Suspected (post-unload mission scope audit or runaway shared allocations)
    if (snapshot.resources.hasMissionLeak || snapshot.resources.sharedDelta > 45) {
      pushWarning(
        'RESOURCE_LEAK_SUSPECTED',
        'CRITICAL',
        'MemoryAndResources',
        'ResourceManager',
        `missionLeak=${snapshot.resources.hasMissionLeak}, postUnloadRem=${snapshot.resources.missionRemaining}, sharedDelta=${snapshot.resources.sharedDelta}`,
        'Zero unreleased mission resources after mission transition',
        `Post-unload mission resources remaining=${snapshot.resources.missionRemaining}`,
        'Ensure all mission geometries/materials/listeners register under mission:<id> scope.',
        6.0
      );
    }

    // Rule 8: Physics & Collision Integrity Warnings ([CONFIRMED] vs [HEURISTIC])
    if (snapshot.physics && snapshot.physics.physicsWarnings.length > 0) {
      for (const pw of snapshot.physics.physicsWarnings.slice(0, 8)) {
        const prefix = pw.classification === 'CONFIRMED' ? '[CONFIRMED]' : '[HEURISTIC]';
        pushWarning(
          pw.ruleId,
          pw.severity,
          pw.subsystem,
          pw.entityId,
          `${prefix} ${pw.description}`,
          pw.expectedBehavior,
          pw.actualBehavior,
          pw.suggestedInvestigation,
          2.5
        );
      }
    }

    return [...this.activeWarnings];
  }

  getWarnings(): DiagnosticWarning[] {
    return [...this.activeWarnings];
  }
}
