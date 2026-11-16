import { CombatDebugSnapshot } from '@/src/gameplay/CombatTelemetryRecorder';

export type ComparisonVerdict = 'Improved' | 'Regressed' | 'Unchanged' | 'Insufficient data';

export interface BaselineMetricComparison {
  metric: string;
  baselineValue: string;
  currentValue: string;
  delta: string;
  verdict: ComparisonVerdict;
}

export type CsvExportKind =
  | 'enemy_ai'
  | 'damage'
  | 'projectiles_flight'
  | 'performance'
  | 'resources'
  | 'warnings'
  | 'collision_events'
  | 'object_movement';

function escapeCsv(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCsv).join(',')];
  for (const r of rows) {
    lines.push(r.map(escapeCsv).join(','));
  }
  return lines.join('\n');
}

export function buildJsonDiagnosticReport(snapshot: CombatDebugSnapshot): string {
  const payload = {
    schemaVersion: 'vanguard.diagnostics.v2',
    generatedAtIso: new Date().toISOString(),
    missionId: snapshot.missionId,
    difficulty: snapshot.coordinator.difficulty,
    snapshot,
  };
  return JSON.stringify(payload, null, 2);
}

export function buildCsvExport(snapshot: CombatDebugSnapshot, kind: CsvExportKind): string {
  switch (kind) {
    case 'enemy_ai':
      return toCsv(
        [
          'id',
          'displayName',
          'squadId',
          'domain',
          'role',
          'state',
          'detectedPlayer',
          'hasLos',
          'losBlockerId',
          'distanceMeters',
          'tokenStatus',
          'allowedToFire',
          'shotsFired',
          'shotsHit',
          'totalDamageDealt',
          'stateTransitions',
          'invalidTransitions',
        ],
        snapshot.enemies.map((e) => [
          e.id,
          e.displayName,
          e.squadId,
          e.domain,
          e.role,
          e.state,
          e.detectedPlayer,
          e.hasLos,
          e.losBlockerId ?? '',
          e.distanceMeters,
          e.tokenStatus,
          e.allowedToFire,
          e.shotsFired,
          e.shotsHit,
          e.totalDamageDealt,
          e.stateTransitionCount ?? 0,
          e.invalidTransitionCount ?? 0,
        ])
      );

    case 'damage':
      return toCsv(
        [
          'shotId',
          'timestampSec',
          'unitId',
          'squadId',
          'domain',
          'weaponClass',
          'hitZone',
          'damage',
          'armorAbsorbed',
          'healthLost',
        ],
        snapshot.recentDamages.map((d) => [
          d.shotId,
          d.timestampSec,
          d.unitId,
          d.squadId,
          d.domain,
          d.weaponClass,
          d.hitZone,
          d.damage,
          d.armorAbsorbed,
          d.healthLost,
        ])
      );

    case 'projectiles_flight':
      return toCsv(
        [
          'id',
          'domain',
          'category',
          'x',
          'y',
          'z',
          'speed',
          'acceleration',
          'maxSpeed',
          'turnRateDegPerSec',
          'maxTurnRateDegPerSec',
          'flightTimeSec',
          'remainingLifeSec',
          'trackingState',
          'timeToImpactSec',
          'stateLabel',
          'speedOutlier',
        ],
        snapshot.flightSamples.map((f) => [
          f.id,
          f.domain,
          f.category,
          f.x,
          f.y,
          f.z,
          f.speed,
          f.acceleration,
          f.maxSpeed,
          f.turnRateDegPerSec,
          f.maxTurnRateDegPerSec,
          f.flightTimeSec,
          f.remainingLifeSec ?? '',
          f.trackingState,
          f.timeToImpactSec ?? '',
          f.stateLabel,
          f.speedOutlier,
        ])
      );

    case 'performance':
      return toCsv(
        ['metric', 'value'],
        [
          ['fps', snapshot.performance.fps],
          ['avgFps', snapshot.performance.avgFps],
          ['minFps', snapshot.performance.minFps],
          ['maxFps', snapshot.performance.maxFps],
          ['frameMs', snapshot.performance.frameMs],
          ['avgFrameMs', snapshot.performance.avgFrameMs],
          ['p95FrameMs', snapshot.performance.p95FrameMs],
          ['p99FrameMs', snapshot.performance.p99FrameMs],
          ['cpuTimeMs', snapshot.performance.cpuTimeMs],
          ['phase_ai_ms', snapshot.performance.phases.ai],
          ['phase_ballistics_ms', snapshot.performance.phases.ballistics],
          ['phase_physics_ms', snapshot.performance.phases.physics],
          ['phase_projectilesFlight_ms', snapshot.performance.phases.projectilesFlight],
          ['phase_explosions_ms', snapshot.performance.phases.explosions],
          ['phase_render_ms', snapshot.performance.phases.render],
          ['phase_audio_ms', snapshot.performance.phases.audio],
          ['phase_ui_ms', snapshot.performance.phases.ui],
          ['drawCalls', snapshot.performance.drawCalls],
          ['triangles', snapshot.performance.triangles],
          ['spikeCount', snapshot.performance.spikeCount],
          ['lastSpikeMs', snapshot.performance.lastSpikeMs],
          ['lastSpikeSubsystem', snapshot.performance.lastSpikeSubsystem],
          ['governorTier', snapshot.performance.governorTier],
        ]
      );

    case 'resources':
      return toCsv(
        ['resource_metric', 'count'],
        [
          ['geometries', snapshot.resources.geometries],
          ['materials', snapshot.resources.materials],
          ['textures', snapshot.resources.textures],
          ['renderTargets', snapshot.resources.renderTargets],
          ['listeners', snapshot.resources.listeners],
          ['timers', snapshot.resources.timers],
          ['audioVoices', snapshot.resources.audioVoices],
          ['activePooledVfx', snapshot.resources.activePooledVfx],
          ['poolCapacityVfx', snapshot.resources.poolCapacityVfx],
          ['activePooledProjectiles', snapshot.resources.activePooledProjectiles],
          ['poolCapacityProjectiles', snapshot.resources.poolCapacityProjectiles],
          ['activeC4Count', snapshot.resources.activeC4Count],
          ['totalCreated', snapshot.resources.totalCreated],
          ['totalDisposed', snapshot.resources.totalDisposed],
          ['sharedCount', snapshot.resources.sharedCount],
          ['missionCount', snapshot.resources.missionCount],
          ['hasMissionLeak', snapshot.resources.hasMissionLeak],
          ['sharedDelta', snapshot.resources.sharedDelta],
        ]
      );

    case 'warnings':
      return toCsv(
        [
          'id',
          'ruleId',
          'severity',
          'timestampSec',
          'subsystem',
          'entityId',
          'measuredEvidence',
          'expectedBehavior',
          'actualBehavior',
          'suggestedInvestigation',
        ],
        snapshot.warnings.map((w) => [
          w.id,
          w.ruleId,
          w.severity,
          w.timestampSec,
          w.subsystem,
          w.entityId,
          w.measuredEvidence,
          w.expectedBehavior,
          w.actualBehavior,
          w.suggestedInvestigation,
        ])
      );

    case 'collision_events': {
      const rows: Array<Array<unknown>> = [];
      for (const c of snapshot.physics.recentContacts) {
        rows.push([
          'CONTACT',
          c.timestampSec,
          c.entityId,
          c.colliderId,
          c.colliderTag,
          c.pointX,
          c.pointY,
          c.pointZ,
          c.normalX,
          c.normalY,
          c.normalZ,
          c.penetrationDepth,
        ]);
      }
      for (const b of snapshot.physics.blockedVectors) {
        rows.push([
          'BLOCKED_MOVE',
          b.timestampSec,
          b.entityId,
          b.blockerId,
          'blocked',
          b.originX,
          b.originY,
          b.originZ,
          b.resolvedDx - b.desiredDx,
          0,
          b.resolvedDz - b.desiredDz,
          0,
        ]);
      }
      return toCsv(
        [
          'eventType',
          'timestampSec',
          'entityId',
          'colliderId',
          'colliderTag',
          'x',
          'y',
          'z',
          'normalOrBlockedDx',
          'normalOrBlockedDy',
          'normalOrBlockedDz',
          'penetrationDepth',
        ],
        rows
      );
    }

    case 'object_movement':
      return toCsv(
        [
          'id',
          'entityType',
          'classification',
          'shape',
          'layerLabel',
          'maskLabel',
          'physicalState',
          'x',
          'y',
          'z',
          'vx',
          'vy',
          'vz',
          'speed',
          'dimensions',
          'contactCount',
          'lastCollisionId',
          'massKg',
        ],
        snapshot.physics.bodies.map((b) => [
          b.id,
          b.entityType,
          b.classification,
          b.shape,
          b.layerLabel,
          b.maskLabel,
          b.physicalState,
          b.x,
          b.y,
          b.z,
          b.vx,
          b.vy,
          b.vz,
          b.speed,
          b.dimensions,
          b.contactCount,
          b.lastCollisionId ?? '',
          b.massKg,
        ])
      );
  }
}

export function buildMarkdownDiagnosticReport(snapshot: CombatDebugSnapshot): string {
  const m = snapshot.metrics;
  const p = snapshot.performance;
  const r = snapshot.resources;
  const lines: string[] = [
    `# VANGUARD: ZERO HOUR — Combat & Engine Diagnostic Report`,
    ``,
    `- **Generated**: ${new Date().toISOString()}`,
    `- **Mission**: #${snapshot.missionId} | **Difficulty**: ${snapshot.coordinator.difficulty.toUpperCase()} | **Elapsed**: ${m.elapsedSec}s`,
    ``,
    `## 1. Squad Coordination & AI Fairness`,
    `- **Global Active Attackers**: ${snapshot.coordinator.currentGlobalAttackers} / ${snapshot.coordinator.maxGlobalAttackers}`,
    `- **Heavy Attackers**: ${snapshot.coordinator.currentGlobalHeavyAttackers} / ${snapshot.coordinator.maxGlobalHeavyAttackers}`,
    `- **Suppressors**: ${snapshot.coordinator.currentGlobalSuppressors} / ${snapshot.coordinator.maxGlobalSuppressors}`,
    `- **Invalid Unleased Attacks**: ${m.invalidAttackAttempts}`,
    `- **First Detect -> First Hit**: ${m.firstDetectToFirstDamageSec ?? 'N/A'}s`,
    ``,
    `## 2. Combat, Cover & Ballistics`,
    `- **Shots Fired / Hit / Blocked by Cover**: ${m.totalShotsFired} / ${m.totalShotsHit} / ${m.totalShotsBlockedByCover} (${m.coverBlockedPercentage}% blocked)`,
    `- **Damage Received (5s / 10s / 30s / Total)**: ${m.damageLast5s} / ${m.damageLast10s} / ${m.damageLast30s} / ${m.totalDamageReceived} HP`,
    `- **Duplicate Damage Guard Blocks**: ${m.duplicateDamageBlockedCount}`,
    `- **Raycast Avg / Max Time**: ${snapshot.ballisticsStats.raycastAvgMs}ms / ${snapshot.ballisticsStats.raycastMaxMs}ms`,
    ``,
    `## 3. Flight, Projectiles & Explosives`,
    `- **Active Flight Entities Tracked**: ${snapshot.flightSamples.length} (Speed Outliers: ${m.speedOutliersCount}, Tunneling Blocks: ${m.tunnelingBlockedCount})`,
    `- **C4 Deployed / Detonations**: ${snapshot.ordnanceSummary.c4Deployed} / ${snapshot.ordnanceSummary.c4Detonations}`,
    `- **Bomb Strikes Called**: ${snapshot.ordnanceSummary.bombStrikesCalled}`,
    `- **Strategic Nuclear Strike Used**: ${snapshot.ordnanceSummary.nukeUsed ? 'YES' : 'NO'}`,
    ``,
    `## 4. Performance & Resource Telemetry`,
    `- **FPS (Current / Avg / Min / Max)**: ${p.fps} / ${p.avgFps} / ${p.minFps} / ${p.maxFps}`,
    `- **Frame Time (Avg / p95 / p99)**: ${p.avgFrameMs}ms / ${p.p95FrameMs}ms / ${p.p99FrameMs}ms`,
    `- **Draw Calls / Triangles**: ${p.drawCalls} / ${p.triangles}`,
    `- **GPU Note**: ${p.gpuTimerNote}`,
    `- **Resources (Geo / Mat / Tex / Listeners / Timers)**: ${r.geometries} / ${r.materials} / ${r.textures} / ${r.listeners} / ${r.timers}`,
    `- **Mission Leak Detected**: ${r.hasMissionLeak ? 'YES' : 'NO'}`,
    ``,
    `## 5. Physics & Collision Integrity`,
    `- **Solver Architecture**: ${snapshot.physics.solverBackend} (${Math.round(1 / snapshot.physics.fixedTimestepSec)}Hz)`,
    `- **Bodies (Total / Static / Dynamic / Character)**: ${snapshot.physics.totalBodies} / ${snapshot.physics.staticBodiesCount} / ${snapshot.physics.dynamicBodiesCount} / ${snapshot.physics.characterBodiesCount}`,
    `- **Per-Frame Queries (Collisions / Raycasts / Swept Casts)**: ${snapshot.physics.collisionChecksPerFrame} / ${snapshot.physics.raycastsPerFrame} / ${snapshot.physics.shapeCastsPerFrame}`,
    `- **Cumulative Guards (Penetrations / Blocked Moves / Ceiling Blocks / Boundary Clamps / CCD Tunneling / Vehicle Impacts)**: ${snapshot.physics.penetrationCorrectionsTotal} / ${snapshot.physics.blockedMovementsTotal} / ${snapshot.physics.ceilingStandupBlocksTotal} / ${snapshot.physics.worldBoundaryClampsTotal} / ${snapshot.physics.tunnelingPreventedTotal} / ${snapshot.physics.vehicleBuildingImpactsTotal}`,
    ``,
    `## 6. Automated Diagnostic Warnings (${snapshot.warnings.length})`,
  ];

  if (snapshot.warnings.length === 0) {
    lines.push(`- No invariant violations detected.`);
  } else {
    for (const w of snapshot.warnings.slice(0, 20)) {
      lines.push(
        `- **[${w.severity}] ${w.ruleId}** (${w.subsystem} @ ${w.timestampSec}s) — ${w.measuredEvidence} | Investigation: ${w.suggestedInvestigation}`
      );
    }
  }

  return lines.join('\n');
}

export function buildPhysicsJsonReport(snapshot: CombatDebugSnapshot): string {
  const payload = {
    schemaVersion: 'vanguard.physics.diagnostics.v1',
    generatedAtIso: new Date().toISOString(),
    missionId: snapshot.missionId,
    elapsedSec: snapshot.metrics.elapsedSec,
    physics: snapshot.physics,
    playerMovement: snapshot.playerMovement,
    flightSamples: snapshot.flightSamples,
  };
  return JSON.stringify(payload, null, 2);
}

export function buildPhysicsMarkdownAuditReport(snapshot: CombatDebugSnapshot): string {
  const phys = snapshot.physics;
  const lines: string[] = [
    `# VANGUARD: ZERO HOUR — Physics & Collision Integrity Audit Report`,
    ``,
    `- **Generated**: ${new Date().toISOString()}`,
    `- **Mission**: #${snapshot.missionId} | **Elapsed**: ${snapshot.metrics.elapsedSec}s`,
    `- **Solver Backend**: ${phys.solverBackend}`,
    `- **Fixed Step**: ${(phys.fixedTimestepSec * 1000).toFixed(2)}ms (${Math.round(1 / phys.fixedTimestepSec)} Hz)`,
    `- **World Boundary**: [${phys.worldBoundsMin}m .. ${phys.worldBoundsMax}m]`,
    ``,
    `## 1. Body & Collider Registry`,
    `- **Total Physics Bodies**: ${phys.totalBodies}`,
    `- **Static World/Building Colliders**: ${phys.staticBodiesCount}`,
    `- **Dynamic Rigid/Kinematic Bodies**: ${phys.dynamicBodiesCount + phys.kinematicBodiesCount}`,
    `- **Character Capsule Bodies**: ${phys.characterBodiesCount}`,
    ``,
    `## 2. Collision & Guard Counters`,
    `- **Collision Checks (This Frame)**: ${phys.collisionChecksPerFrame}`,
    `- **Raycasts (This Frame)**: ${phys.raycastsPerFrame}`,
    `- **Swept Shape-Casts (This Frame)**: ${phys.shapeCastsPerFrame}`,
    `- **Penetration Corrections (Total)**: ${phys.penetrationCorrectionsTotal}`,
    `- **Blocked Wall Movements (Total)**: ${phys.blockedMovementsTotal}`,
    `- **Ceiling Stand-Up Blocks (Total)**: ${phys.ceilingStandupBlocksTotal}`,
    `- **World Boundary Clamps (Total)**: ${phys.worldBoundaryClampsTotal}`,
    `- **Anti-Tunneling CCD Intercepts (Total)**: ${phys.tunnelingPreventedTotal}`,
    `- **Vehicle Collisions (Total)**: ${phys.vehicleBuildingImpactsTotal}`,
    ``,
    `## 3. Active Physics Bodies (${phys.bodies.length})`,
    `| ID | Entity Type | Classification | Shape | Layer | State | Speed (m/s) | Contacts | Last Collider Hit |`,
    `|---|---|---|---|---|---|---|---|---|`,
  ];

  for (const b of phys.bodies.slice(0, 40)) {
    lines.push(
      `| ${b.id} | ${b.entityType} | ${b.classification} | ${b.shape} | ${b.layerLabel} | ${b.physicalState} | ${b.speed} | ${b.contactCount} | ${b.lastCollisionId ?? 'None'} |`
    );
  }

  lines.push(``, `## 4. Physics Warnings (${phys.physicsWarnings.length})`);
  if (phys.physicsWarnings.length === 0) {
    lines.push(`- Zero physics anomalies detected.`);
  } else {
    for (const w of phys.physicsWarnings) {
      lines.push(
        `- **[${w.classification}] [${w.severity}] ${w.ruleId}** (${w.entityId} @ ${w.timestampSec}s): ${w.description} — Expected: ${w.expectedBehavior} | Action: ${w.suggestedInvestigation}`
      );
    }
  }

  return lines.join('\n');
}

export function compareDiagnosticSnapshots(
  baseline: CombatDebugSnapshot | null,
  current: CombatDebugSnapshot | null
): BaselineMetricComparison[] {
  if (!baseline || !current) {
    return [
      {
        metric: 'Session Comparison',
        baselineValue: baseline ? 'Captured' : 'Missing',
        currentValue: current ? 'Captured' : 'Missing',
        delta: 'N/A',
        verdict: 'Insufficient data',
      },
    ];
  }

  const compareNumeric = (
    metric: string,
    baseVal: number,
    curVal: number,
    unit: string,
    higherIsBetter: boolean,
    tolerance = 0.01
  ): BaselineMetricComparison => {
    if (!Number.isFinite(baseVal) || !Number.isFinite(curVal)) {
      return {
        metric,
        baselineValue: String(baseVal),
        currentValue: String(curVal),
        delta: 'N/A',
        verdict: 'Insufficient data',
      };
    }
    const diff = curVal - baseVal;
    const absDiff = Math.abs(diff);
    let verdict: ComparisonVerdict = 'Unchanged';
    if (absDiff > tolerance) {
      const improved = higherIsBetter ? diff > 0 : diff < 0;
      verdict = improved ? 'Improved' : 'Regressed';
    }
    const sign = diff > 0 ? '+' : '';
    return {
      metric,
      baselineValue: `${baseVal.toFixed(1)}${unit}`,
      currentValue: `${curVal.toFixed(1)}${unit}`,
      delta: `${sign}${diff.toFixed(1)}${unit}`,
      verdict,
    };
  };

  return [
    compareNumeric('Average FPS', baseline.performance.avgFps, current.performance.avgFps, ' FPS', true, 1.0),
    compareNumeric('p95 Frame Time', baseline.performance.p95FrameMs, current.performance.p95FrameMs, ' ms', false, 0.5),
    compareNumeric('Draw Calls', baseline.performance.drawCalls, current.performance.drawCalls, '', false, 2),
    compareNumeric(
      'Active Warnings',
      baseline.warnings.length,
      current.warnings.length,
      '',
      false,
      0
    ),
    compareNumeric(
      'Flight Speed Outliers',
      baseline.metrics.speedOutliersCount,
      current.metrics.speedOutliersCount,
      '',
      false,
      0
    ),
    compareNumeric(
      'Cover Blocked Rate',
      baseline.metrics.coverBlockedPercentage,
      current.metrics.coverBlockedPercentage,
      '%',
      true,
      1.0
    ),
    compareNumeric(
      '5s Damage Received',
      baseline.metrics.damageLast5s,
      current.metrics.damageLast5s,
      ' HP',
      false,
      1.0
    ),
    compareNumeric(
      'Invalid Attack Attempts',
      baseline.metrics.invalidAttackAttempts,
      current.metrics.invalidAttackAttempts,
      '',
      false,
      0
    ),
  ];
}

export function triggerBrowserDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
