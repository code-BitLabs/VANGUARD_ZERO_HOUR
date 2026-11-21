import React from 'react';
import { Download, FileText, Layers } from 'lucide-react';
import { PhysicsBodyInspectorRow } from '@/src/engine/physics/PhysicsTypes';
import {
  CombatDebugSnapshot,
  CombatEventRecord,
  EnemyDebugInspectorRow,
  ShotTelemetryRecord,
} from '@/src/gameplay/CombatTelemetryRecorder';
import {
  BaselineMetricComparison,
  buildCsvExport,
  buildJsonDiagnosticReport,
  buildMarkdownDiagnosticReport,
  buildPhysicsJsonReport,
  buildPhysicsMarkdownAuditReport,
  ComparisonVerdict,
  CsvExportKind,
  triggerBrowserDownload,
} from '@/src/gameplay/diagnostics/DiagnosticExporter';

export function MetricTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-[#141920]/90 border border-zinc-800 p-2">
      <div className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="text-xs font-bold text-zinc-100 mt-0.5 truncate">{value}</div>
      <div className="text-[9px] text-zinc-400 truncate mt-0.5">{sub}</div>
    </div>
  );
}

function renderTokenBadge(status: EnemyDebugInspectorRow['tokenStatus']) {
  if (status === 'DIRECT') {
    return (
      <span className="px-1 py-0.5 bg-cyan-950 border border-cyan-500/70 text-cyan-300 font-bold">
        DIRECT
      </span>
    );
  }
  if (status === 'HEAVY') {
    return (
      <span className="px-1 py-0.5 bg-amber-950 border border-amber-500/70 text-amber-300 font-bold">
        HEAVY
      </span>
    );
  }
  if (status === 'SUPPRESS') {
    return (
      <span className="px-1 py-0.5 bg-purple-950 border border-purple-500/70 text-purple-300 font-bold">
        SUPPR
      </span>
    );
  }
  return <span className="text-zinc-500">{status}</span>;
}

function VerdictBadge({ verdict }: { verdict: ComparisonVerdict }) {
  const cls =
    verdict === 'Improved'
      ? 'text-emerald-400 font-bold'
      : verdict === 'Regressed'
        ? 'text-red-400 font-bold'
        : verdict === 'Unchanged'
          ? 'text-zinc-400'
          : 'text-amber-400';
  return <span className={cls}>{verdict}</span>;
}

function stateBadgeColor(state: string): string {
  switch (state) {
    case 'ENGAGING':
      return 'text-red-400 font-bold';
    case 'SUPPRESSING':
      return 'text-purple-400 font-bold';
    case 'ALERTED':
      return 'text-amber-400 font-bold';
    case 'SEARCHING':
    case 'INVESTIGATING':
      return 'text-yellow-300';
    case 'REPOSITIONING':
    case 'RETREATING':
      return 'text-cyan-300';
    default:
      return 'text-zinc-400';
  }
}

export const OverviewDebugTab = React.memo(function OverviewDebugTab({
  snapshot,
}: {
  snapshot: CombatDebugSnapshot;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricTile
          label="FPS / Frame"
          value={`${snapshot.performance.fps} FPS (${snapshot.performance.frameMs}ms)`}
          sub={`p95: ${snapshot.performance.p95FrameMs}ms · ${snapshot.performance.governorTier}`}
        />
        <MetricTile
          label="Global Shooters"
          value={`${snapshot.coordinator.currentGlobalAttackers} / ${snapshot.coordinator.maxGlobalAttackers}`}
          sub={`Heavy ${snapshot.coordinator.currentGlobalHeavyAttackers}/${snapshot.coordinator.maxGlobalHeavyAttackers} · Sup ${snapshot.coordinator.currentGlobalSuppressors}/${snapshot.coordinator.maxGlobalSuppressors}`}
        />
        <MetricTile
          label="DMG (5s / Total)"
          value={`${snapshot.metrics.damageLast5s} / ${snapshot.metrics.totalDamageReceived}`}
          sub={`Cover Blocked: ${snapshot.metrics.coverBlockedPercentage}%`}
        />
        <MetricTile
          label="Flight & Ordnance"
          value={`${snapshot.flightSamples.length} Airborne`}
          sub={`C4 ${snapshot.ordnanceSummary.c4Deployed}/${snapshot.ordnanceSummary.c4MaxDeployed} · Strikes ${snapshot.ordnanceSummary.bombStrikesCalled}`}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricTile
          label="Detect -> 1st Hit"
          value={
            snapshot.metrics.firstDetectToFirstDamageSec !== null
              ? `${snapshot.metrics.firstDetectToFirstDamageSec}s`
              : 'N/A'
          }
          sub={`Aware: ${snapshot.metrics.enemiesAwareCount} · Firing: ${snapshot.metrics.enemiesFiringCount}`}
        />
        <MetricTile
          label="Draw Calls / Tris"
          value={`${snapshot.performance.drawCalls} / ${snapshot.performance.triangles}`}
          sub={`CPU: ${snapshot.performance.cpuTimeMs}ms`}
        />
        <MetricTile
          label="Resources (Geo/Mat)"
          value={`${snapshot.resources.geometries} / ${snapshot.resources.materials}`}
          sub={`Post-Unload Leak: ${snapshot.resources.hasMissionLeak ? 'YES' : 'NO'}`}
        />
        <MetricTile
          label="Diagnostic Warnings"
          value={`${snapshot.warnings.length} Active`}
          sub={`Speed Outliers: ${snapshot.metrics.speedOutliersCount}`}
        />
      </div>

      {snapshot.warnings.length > 0 && (
        <div className="bg-red-950/25 border border-red-800/70 p-2 space-y-1">
          <div className="text-[10px] uppercase text-red-400 font-bold">
            Latest Rule Violations
          </div>
          {snapshot.warnings.slice(0, 3).map((w) => (
            <div key={w.id} className="text-[10px] text-zinc-200 flex justify-between gap-2">
              <span>
                <strong className="text-red-300">
                  [{w.severity}] {w.ruleId}
                </strong>{' '}
                — {w.measuredEvidence}
              </span>
              <span className="text-zinc-500 shrink-0">{w.timestampSec}s</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export const PhysicsDebugTab = React.memo(function PhysicsDebugTab({
  physics,
  physicsBodyFilter,
  deferredPhysicsBodyFilter,
  selectedPhysicsBodyId,
  onChangeFilter,
  onSelectBody,
}: {
  physics: NonNullable<CombatDebugSnapshot['physics']>;
  physicsBodyFilter: string;
  deferredPhysicsBodyFilter: string;
  selectedPhysicsBodyId: string | null;
  onChangeFilter: (next: string) => void;
  onSelectBody: (id: string | null) => void;
}) {
  const selectedPhysicsBody: PhysicsBodyInspectorRow | null =
    physics.bodies.find((b) => b.id === selectedPhysicsBodyId) ?? null;

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricTile
          label="Physics Solver"
          value={physics.rapierInitialized ? 'Rapier3D WASM + BVH' : 'PhysicsWorld + BVH'}
          sub={`Fixed Step: ${Math.round(1 / physics.fixedTimestepSec)}Hz (${(physics.fixedTimestepSec * 1000).toFixed(1)}ms)`}
        />
        <MetricTile
          label="Bodies (Tot / Stat / Dyn)"
          value={`${physics.totalBodies} (${physics.staticBodiesCount}S / ${physics.dynamicBodiesCount + physics.kinematicBodiesCount + physics.characterBodiesCount}D)`}
          sub={`Slopes: ${physics.slopeWireframes?.length ?? 0} · Ladders: ${physics.ladderWireframes?.length ?? 0} · Flags: ${physics.traversalIntegrityFlags?.length ?? 0}`}
        />
        <MetricTile
          label="Per-Frame Queries"
          value={`Col:${physics.collisionChecksPerFrame} Ray:${physics.raycastsPerFrame}`}
          sub={`Swept Casts: ${physics.shapeCastsPerFrame} · Pairs: ${physics.activeCollisionPairs}`}
        />
        <MetricTile
          label="Collision Guards"
          value={`Pen:${physics.penetrationCorrectionsTotal} Blk:${physics.blockedMovementsTotal}`}
          sub={`Ceil:${physics.ceilingStandupBlocksTotal} Bnd:${physics.worldBoundaryClampsTotal} CCD:${physics.tunnelingPreventedTotal} Veh:${physics.vehicleBuildingImpactsTotal}`}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <input
          type="text"
          value={physicsBodyFilter}
          onChange={(e) => onChangeFilter(e.target.value)}
          placeholder="Filter bodies by ID, entityType, classification, shape, or layer..."
          className="flex-1 bg-[#0B0E11] border border-zinc-800 px-2 py-1 text-[10px] text-zinc-100"
        />
        <span className="text-[10px] text-zinc-400">Click row to inspect</span>
      </div>

      <div className="overflow-x-auto max-h-52 overflow-y-auto border border-zinc-800 bg-[#0B0E11]">
        <table className="w-full text-left border-collapse text-[10px]">
          <thead className="sticky top-0 bg-[#141920] text-zinc-400 uppercase border-b border-zinc-800">
            <tr>
              <th className="py-1 px-1.5">Body</th>
              <th className="py-1 px-1.5">Class / Shape</th>
              <th className="py-1 px-1.5">Layer</th>
              <th className="py-1 px-1.5">State</th>
              <th className="py-1 px-1.5">Speed</th>
              <th className="py-1 px-1.5">Contacts / Hit</th>
              <th className="py-1 px-1.5">Mass</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {physics.bodies
              .filter((b) => {
                if (!deferredPhysicsBodyFilter.trim()) return true;
                const q = deferredPhysicsBodyFilter.toLowerCase();
                return (
                  b.id.toLowerCase().includes(q) ||
                  b.entityType.toLowerCase().includes(q) ||
                  b.classification.toLowerCase().includes(q) ||
                  b.shape.toLowerCase().includes(q) ||
                  b.layerLabel.toLowerCase().includes(q)
                );
              })
              .map((b) => (
                <tr
                  key={b.id}
                  onClick={() => onSelectBody(b.id === selectedPhysicsBodyId ? null : b.id)}
                  className={`cursor-pointer hover:bg-zinc-900/80 ${
                    selectedPhysicsBodyId === b.id ? 'bg-purple-950/40' : ''
                  }`}
                >
                  <td className="py-1 px-1.5 font-semibold text-zinc-200">
                    <div>{b.id}</div>
                    <div className="text-[9px] text-zinc-500">{b.entityType.toUpperCase()}</div>
                  </td>
                  <td className="py-1 px-1.5">
                    <span className="text-cyan-300 font-bold">{b.classification}</span>
                    <div className="text-[9px] text-zinc-500">
                      {b.shape} ({b.dimensions})
                    </div>
                  </td>
                  <td className="py-1 px-1.5 text-zinc-300">{b.layerLabel}</td>
                  <td className="py-1 px-1.5">
                    <span
                      className={
                        b.physicalState === 'GROUNDED' || b.physicalState === 'STATIC'
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }
                    >
                      {b.physicalState}
                    </span>
                  </td>
                  <td className="py-1 px-1.5 text-zinc-200">{b.speed} m/s</td>
                  <td className="py-1 px-1.5">
                    <span className={b.contactCount > 0 ? 'text-amber-300 font-bold' : 'text-zinc-500'}>
                      {b.contactCount}
                    </span>
                    {b.lastCollisionId && (
                      <span className="text-[9px] text-zinc-400 ml-1">[{b.lastCollisionId}]</span>
                    )}
                  </td>
                  <td className="py-1 px-1.5 text-zinc-300">{b.massKg}kg</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {selectedPhysicsBody && (
        <div className="bg-[#141920] border border-purple-500/60 p-2.5 space-y-1 text-[10px]">
          <div className="flex justify-between font-bold text-purple-300">
            <span>
              PHYSICS BODY INSPECTOR: {selectedPhysicsBody.id} ({selectedPhysicsBody.entityType})
            </span>
            <button
              type="button"
              onClick={() => onSelectBody(null)}
              className="text-zinc-400 hover:text-zinc-200"
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-zinc-300">
            <div>
              Class/Shape: {selectedPhysicsBody.classification} · {selectedPhysicsBody.shape}
            </div>
            <div>Dimensions: {selectedPhysicsBody.dimensions}</div>
            <div>Layer: {selectedPhysicsBody.layerLabel}</div>
            <div>Collides With: {selectedPhysicsBody.maskLabel}</div>
            <div>
              Pos: ({selectedPhysicsBody.x}, {selectedPhysicsBody.y}, {selectedPhysicsBody.z})
            </div>
            <div>
              Vel: ({selectedPhysicsBody.vx}, {selectedPhysicsBody.vy}, {selectedPhysicsBody.vz}) ·{' '}
              {selectedPhysicsBody.speed} m/s
            </div>
            <div>
              State: {selectedPhysicsBody.physicalState} · Mass: {selectedPhysicsBody.massKg}kg
            </div>
            <div>
              Contacts: {selectedPhysicsBody.contactCount} · Last Hit:{' '}
              {selectedPhysicsBody.lastCollisionId ?? 'None'}
            </div>
            <div>
              Last Normal: ({selectedPhysicsBody.lastNormalX}, {selectedPhysicsBody.lastNormalY},{' '}
              {selectedPhysicsBody.lastNormalZ})
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="bg-[#0B0E11] border border-zinc-800 p-2 max-h-36 overflow-y-auto">
          <div className="text-[10px] uppercase text-zinc-400 mb-1">
            Recent Surface Contacts ({physics.recentContacts.length})
          </div>
          {physics.recentContacts.length === 0 ? (
            <div className="text-[10px] text-zinc-500">No recent surface contacts recorded.</div>
          ) : (
            physics.recentContacts.slice(0, 12).map((c, idx) => (
              <div key={`${c.entityId}_${idx}`} className="text-[10px] py-0.5 border-b border-zinc-900">
                <span className="text-zinc-200 font-bold">{c.entityId}</span> →{' '}
                <span className="text-cyan-400">{c.colliderId}</span> ({c.colliderTag}) · n=(
                {c.normalX},{c.normalY},{c.normalZ}) pen={c.penetrationDepth}m
              </div>
            ))
          )}
        </div>

        <div className="bg-[#0B0E11] border border-zinc-800 p-2 max-h-36 overflow-y-auto">
          <div className="text-[10px] uppercase text-zinc-400 mb-1">
            Physics Warnings ({physics.physicsWarnings.length})
          </div>
          {physics.physicsWarnings.length === 0 ? (
            <div className="text-[10px] text-emerald-400">
              Zero physics overlap, tunneling, or boundary anomalies.
            </div>
          ) : (
            physics.physicsWarnings.slice(0, 10).map((pw) => (
              <div key={pw.id} className="text-[10px] py-0.5 border-b border-zinc-900">
                <span
                  className={
                    pw.classification === 'CONFIRMED'
                      ? 'text-red-400 font-bold'
                      : 'text-amber-300 font-bold'
                  }
                >
                  [{pw.classification}]
                </span>{' '}
                <span className="text-zinc-200 font-semibold">{pw.ruleId}</span> ({pw.entityId}):{' '}
                <span className="text-zinc-400">{pw.description}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

export const EnemyAiDebugTab = React.memo(function EnemyAiDebugTab({
  enemies,
  enemyFilter,
  deferredEnemyFilter,
  selectedEnemyId,
  onChangeFilter,
  onSelectEnemy,
}: {
  enemies: EnemyDebugInspectorRow[];
  enemyFilter: string;
  deferredEnemyFilter: string;
  selectedEnemyId: string | null;
  onChangeFilter: (next: string) => void;
  onSelectEnemy: (id: string | null) => void;
}) {
  const selectedEnemy: EnemyDebugInspectorRow | null =
    enemies.find((e) => e.id === selectedEnemyId) ?? null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <input
          type="text"
          value={enemyFilter}
          onChange={(e) => onChangeFilter(e.target.value)}
          placeholder="Filter by ID, squad, domain, or state..."
          className="flex-1 bg-[#0B0E11] border border-zinc-800 px-2 py-1 text-[10px] text-zinc-100"
        />
        <span className="text-[10px] text-zinc-400">Click row to inspect</span>
      </div>

      <div className="overflow-x-auto max-h-56 overflow-y-auto border border-zinc-800 bg-[#0B0E11]">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-[#141920] text-zinc-400 text-[10px] uppercase border-b border-zinc-800">
            <tr>
              <th className="py-1 px-1.5">Unit</th>
              <th className="py-1 px-1.5">State</th>
              <th className="py-1 px-1.5">Token</th>
              <th className="py-1 px-1.5">Dist</th>
              <th className="py-1 px-1.5">LOS / LKP</th>
              <th className="py-1 px-1.5">React / CD</th>
              <th className="py-1 px-1.5">Mag / Dmg</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70 text-[10px]">
            {enemies
              .filter((u) => {
                if (!deferredEnemyFilter.trim()) return true;
                const q = deferredEnemyFilter.toLowerCase();
                return (
                  u.id.toLowerCase().includes(q) ||
                  u.squadId.toLowerCase().includes(q) ||
                  u.domain.toLowerCase().includes(q) ||
                  u.state.toLowerCase().includes(q)
                );
              })
              .map((u) => (
                <tr
                  key={u.id}
                  onClick={() => onSelectEnemy(u.id === selectedEnemyId ? null : u.id)}
                  className={`cursor-pointer hover:bg-zinc-900/80 ${
                    selectedEnemyId === u.id ? 'bg-amber-950/35' : ''
                  }`}
                >
                  <td className="py-1 px-1.5 font-semibold text-zinc-200">
                    <div>{u.id}</div>
                    <div className="text-[9px] text-zinc-500">
                      {u.domain.toUpperCase()} · {u.squadId}
                    </div>
                  </td>
                  <td className="py-1 px-1.5">
                    <span className={stateBadgeColor(u.state)}>{u.state}</span>
                    <div className="text-[9px] text-zinc-500">
                      {u.role} · tr:{u.stateTransitionCount ?? 0}
                    </div>
                  </td>
                  <td className="py-1 px-1.5">{renderTokenBadge(u.tokenStatus)}</td>
                  <td className="py-1 px-1.5 text-zinc-300">{u.distanceMeters}m</td>
                  <td className="py-1 px-1.5">
                    {u.hasLos ? (
                      <span className="text-emerald-400 font-bold">CLEAR</span>
                    ) : (
                      <span className="text-red-400">
                        BLK {u.losBlockerId ? `[${u.losBlockerId}]` : ''}
                      </span>
                    )}
                    {u.lkpX !== null && (
                      <div className="text-[9px] text-yellow-400/90">
                        LKP: {u.lkpAgeSec}s
                        {(u.blockedShotAttempts ?? 0) > 0 ? ` · Blk:${u.blockedShotAttempts}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="py-1 px-1.5 text-zinc-300">
                    <div>R: {u.reactionTimerSec}s</div>
                    <div className="text-[9px] text-zinc-400">CD: {u.fireCooldownSec}s</div>
                  </td>
                  <td className="py-1 px-1.5 text-zinc-300">
                    <div>
                      {u.ammoInMag}/{u.magSize} {u.isReloading ? '(RLD)' : ''}
                    </div>
                    <div className="text-[9px] text-zinc-400">
                      {u.currentSpreadDeg}° · {u.totalDamageDealt} HP
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {selectedEnemy && (
        <div className="bg-[#141920] border border-amber-500/60 p-2.5 space-y-1 text-[10px]">
          <div className="flex justify-between font-bold text-amber-300">
            <span>
              INSPECTOR: {selectedEnemy.displayName} ({selectedEnemy.id})
            </span>
            <button
              type="button"
              onClick={() => onSelectEnemy(null)}
              className="text-zinc-400 hover:text-zinc-200"
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-zinc-300">
            <div>
              Pos: ({selectedEnemy.x}, {selectedEnemy.y}, {selectedEnemy.z})
            </div>
            <div>
              FOV/Range: {selectedEnemy.fovDeg}° / {selectedEnemy.detectionRange}m
            </div>
            <div>Hearing: {selectedEnemy.hearingRange}m</div>
            <div>
              LKP:{' '}
              {selectedEnemy.lkpX !== null
                ? `(${selectedEnemy.lkpX}, ${selectedEnemy.lkpZ}) ${selectedEnemy.lkpAgeSec}s`
                : 'None'}
            </div>
            <div>
              Shots: {selectedEnemy.shotsHit}/{selectedEnemy.shotsFired} ({selectedEnemy.accuracyPct}%)
            </div>
            <div>
              FSM Invalid: {selectedEnemy.invalidTransitionCount ?? 0} (
              {selectedEnemy.lastTransition ?? 'NONE'})
            </div>
            <div>Obstruction: {selectedEnemy.obstructionDurationSec ?? 0}s</div>
            <div>Blocked Shots: {selectedEnemy.blockedShotAttempts ?? 0}</div>
            <div>
              LOS Recovery:{' '}
              {selectedEnemy.lastLosRecoverySec !== null &&
              selectedEnemy.lastLosRecoverySec !== undefined
                ? `${selectedEnemy.lastLosRecoverySec}s`
                : '--'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export const SquadDebugTab = React.memo(function SquadDebugTab({
  coordinator,
  metrics,
}: {
  coordinator: CombatDebugSnapshot['coordinator'];
  metrics: CombatDebugSnapshot['metrics'];
}) {
  return (
    <div className="space-y-2.5">
      <div className="bg-[#141920]/90 border border-zinc-800 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-zinc-400">
            Global Coordinator [{coordinator.difficulty.toUpperCase()}]
          </span>
          {coordinator.pressureThrottled ? (
            <span className="px-1.5 py-0.5 bg-red-950/90 border border-red-500/80 text-red-300 text-[10px] font-bold">
              BURST THROTTLE ({coordinator.rolling2sDamage}/{coordinator.damageBurstThreshold2s} HP 2s)
            </span>
          ) : (
            <span className="px-1.5 py-0.5 bg-emerald-950/70 border border-emerald-600/60 text-emerald-300 text-[10px]">
              PRESSURE NOMINAL ({coordinator.rolling2sDamage}/{coordinator.damageBurstThreshold2s} HP 2s)
            </span>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <MetricTile
            label="Direct"
            value={`${coordinator.currentGlobalAttackers}/${coordinator.maxGlobalAttackers}`}
            sub={`Avail: ${coordinator.availableGlobalTokens}`}
          />
          <MetricTile
            label="Heavy"
            value={`${coordinator.currentGlobalHeavyAttackers}/${coordinator.maxGlobalHeavyAttackers}`}
            sub="Air/Armor"
          />
          <MetricTile
            label="Suppress"
            value={`${coordinator.currentGlobalSuppressors}/${coordinator.maxGlobalSuppressors}`}
            sub={`Waiting: ${coordinator.waitingAttackersCount}`}
          />
          <MetricTile
            label="Token Health"
            value={`${metrics.tokenAcquisitionAvgMs}ms`}
            sub={`Starved: ${metrics.tokenStarvationCount} · Invalid: ${metrics.invalidAttackAttempts}`}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {coordinator.squads.map((sq) => (
          <div key={sq.squadId} className="bg-[#0B0E11] border border-zinc-800 p-2 space-y-1">
            <div className="flex justify-between font-bold text-zinc-200">
              <span>{sq.squadId}</span>
              <span className="text-zinc-400">
                Alive {sq.aliveCount}/{sq.memberCount}
              </span>
            </div>
            <div className="flex justify-between text-[10px] text-zinc-400">
              <span>
                Shooters: <strong className="text-cyan-400">{sq.activeShooters}/{sq.maxSquadAttackers}</strong>
              </span>
              <span>
                Suppressors:{' '}
                <strong className="text-purple-400">
                  {sq.activeSuppressors}/{sq.maxSquadSuppressors}
                </strong>
              </span>
              <span>Waiting: {sq.waitingCount}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export const CombatDebugTab = React.memo(function CombatDebugTab({
  metrics,
  recentDamages,
}: {
  metrics: CombatDebugSnapshot['metrics'];
  recentDamages: CombatDebugSnapshot['recentDamages'];
}) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricTile
          label="DMG 2s / 5s / 10s"
          value={`${metrics.damageLast2s} / ${metrics.damageLast5s} / ${metrics.damageLast10s}`}
          sub={`30s: ${metrics.damageLast30s} · Total: ${metrics.totalDamageReceived} HP`}
        />
        <MetricTile
          label="Survival / Critical"
          value={`${metrics.survivalBucket} (D:${metrics.playerDeathCount})`}
          sub={`Crit <35% HP: ${metrics.timeBelowCriticalHpSec}s · 1st Kill: ${metrics.timeFirstKillSec ?? '-'}s`}
        />
        <MetricTile
          label="Armor / Recovery"
          value={`Abs:${metrics.totalArmorAbsorbed} · Lost:${metrics.totalHealthLost}`}
          sub={`Regen: +${metrics.totalHealthRegenerated} HP · Crates: ${metrics.supplyCratesUsed}`}
        />
        <MetricTile
          label="Enemy Hit Ratios"
          value={`H:${Math.round((metrics.playerEnemyZoneRatios?.head ?? 0) * 100)}% T:${Math.round((metrics.playerEnemyZoneRatios?.upper_torso ?? 0) * 100)}%`}
          sub={`L:${Math.round((metrics.playerEnemyZoneRatios?.lower_body ?? 0) * 100)}% · G:${metrics.damageByDomain.ground} A:${metrics.damageByDomain.air}`}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="bg-[#0B0E11] border border-zinc-800 p-2 max-h-48 overflow-y-auto">
          <div className="text-[10px] uppercase text-zinc-400 mb-1">Damage by Weapon Class</div>
          {Object.entries(metrics.damageByWeapon).map(([k, v]) => (
            <div key={k} className="flex justify-between text-[10px] py-0.5 border-b border-zinc-900">
              <span>{k}</span>
              <span className="text-amber-400 font-bold">{v} HP</span>
            </div>
          ))}
        </div>
        <div className="bg-[#0B0E11] border border-zinc-800 p-2 max-h-48 overflow-y-auto">
          <div className="text-[10px] uppercase text-zinc-400 mb-1">Recent Damage Events</div>
          {recentDamages.slice(0, 14).map((d) => (
            <div
              key={`${d.shotId}_${d.timestampSec}`}
              className="flex justify-between text-[10px] py-0.5 border-b border-zinc-900"
            >
              <span className="text-zinc-300">
                {d.timestampSec}s {d.unitId} ({d.hitZone})
              </span>
              <span className="text-red-400 font-bold">
                -{d.damage.toFixed(1)} (A:{d.armorAbsorbed.toFixed(0)} H:{d.healthLost.toFixed(0)})
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export const BallisticsDebugTab = React.memo(function BallisticsDebugTab({
  ballisticsStats,
  metrics,
  recentShots,
  selectedShotId,
  onSelectShot,
}: {
  ballisticsStats: CombatDebugSnapshot['ballisticsStats'];
  metrics: CombatDebugSnapshot['metrics'];
  recentShots: ShotTelemetryRecord[];
  selectedShotId: number | null;
  onSelectShot: (id: number | null) => void;
}) {
  const selectedShot = recentShots.find((s) => s.shotId === selectedShotId) ?? null;

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricTile
          label="Raycasts Executed"
          value={`${ballisticsStats.raycastsExecuted}`}
          sub={`Avg: ${ballisticsStats.raycastAvgMs}ms · Max: ${ballisticsStats.raycastMaxMs}ms`}
        />
        <MetricTile
          label="Cover Blocked"
          value={`${metrics.coverBlockedPercentage}%`}
          sub={`${metrics.totalShotsBlockedByCover} / ${metrics.totalShotsFired} shots`}
        />
        <MetricTile
          label="Blocker Breakdown"
          value={`COV:${ballisticsStats.blockedByCategory.COVER} WLD:${ballisticsStats.blockedByCategory.WORLD}`}
          sub={`VEH:${ballisticsStats.blockedByCategory.VEHICLE} DST:${ballisticsStats.blockedByCategory.DESTRUCTIBLE}`}
        />
        <MetricTile
          label="Hit vs Missed"
          value={`${metrics.totalShotsHit} / ${metrics.totalShotsMissed}`}
          sub={`Hit Rate: ${metrics.enemyHitPercentage}%`}
        />
      </div>

      <div className="overflow-x-auto max-h-48 overflow-y-auto border border-zinc-800 bg-[#0B0E11]">
        <table className="w-full text-left border-collapse text-[10px]">
          <thead className="sticky top-0 bg-[#141920] text-zinc-400 uppercase border-b border-zinc-800">
            <tr>
              <th className="py-1 px-1.5">Shot</th>
              <th className="py-1 px-1.5">Unit</th>
              <th className="py-1 px-1.5">Outcome</th>
              <th className="py-1 px-1.5">Zone / Blocker</th>
              <th className="py-1 px-1.5">Spread</th>
              <th className="py-1 px-1.5">Ray ms</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {[...recentShots]
              .reverse()
              .slice(0, 30)
              .map((s) => (
                <tr
                  key={s.shotId}
                  onClick={() => onSelectShot(s.shotId === selectedShotId ? null : s.shotId)}
                  className={`cursor-pointer hover:bg-zinc-900/70 ${
                    selectedShotId === s.shotId ? 'bg-cyan-950/35' : ''
                  }`}
                >
                  <td className="py-1 px-1.5">#{s.shotId}</td>
                  <td className="py-1 px-1.5">{s.unitId}</td>
                  <td className="py-1 px-1.5">
                    <span
                      className={
                        s.outcome === 'hit_player'
                          ? 'text-red-400 font-bold'
                          : s.outcome === 'blocked_cover'
                            ? 'text-cyan-400 font-bold'
                            : 'text-zinc-400'
                      }
                    >
                      {s.outcome}
                    </span>
                  </td>
                  <td className="py-1 px-1.5">{s.hitZone ?? s.blockerColliderId ?? '--'}</td>
                  <td className="py-1 px-1.5">{((s.spreadRad * 180) / Math.PI).toFixed(2)}°</td>
                  <td className="py-1 px-1.5">{s.raycastMs ?? 0}ms</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {selectedShot && (
        <div className="bg-[#141920] border border-cyan-500/60 p-2 text-[10px]">
          <div className="font-bold text-cyan-300">
            SHOT #{selectedShot.shotId} RAY INSPECTOR ({selectedShot.weaponClass})
          </div>
          <div className="text-zinc-300 mt-0.5">
            Origin: ({selectedShot.originX.toFixed(1)}, {selectedShot.originY.toFixed(1)},{' '}
            {selectedShot.originZ.toFixed(1)}) → End: ({selectedShot.endX.toFixed(1)},{' '}
            {selectedShot.endY.toFixed(1)}, {selectedShot.endZ.toFixed(1)}) · Blocker Cat:{' '}
            {selectedShot.blockerCategory ?? 'NONE'}
          </div>
        </div>
      )}
    </div>
  );
});

export const MovementDebugTab = React.memo(function MovementDebugTab({
  playerMovement,
}: {
  playerMovement: CombatDebugSnapshot['playerMovement'];
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      <MetricTile
        label="Speed (3D / Horiz)"
        value={`${playerMovement.speed} / ${playerMovement.horizontalSpeed} m/s`}
        sub={`State: ${playerMovement.accelState}`}
      />
      <MetricTile
        label="Velocity Vector"
        value={`(${playerMovement.velX}, ${playerMovement.velY}, ${playerMovement.velZ})`}
        sub={`Grounded: ${playerMovement.grounded ? 'YES' : 'AIRBORNE'}`}
      />
      <MetricTile
        label="Stance & Air Time"
        value={playerMovement.stance.toUpperCase()}
        sub={`Air: ${playerMovement.airTimeSec}s · Jmp:${playerMovement.lastJumpImpulse} Lnd:${playerMovement.lastLandImpulse}`}
      />
      <MetricTile
        label="Recoil Offsets"
        value={`P:${playerMovement.recoilPitchDeg}° Y:${playerMovement.recoilYawDeg}°`}
        sub={`Trauma: ${playerMovement.trauma} · Sup: ${playerMovement.suppressionLevel}`}
      />
      <MetricTile
        label="Active Weapon"
        value={playerMovement.weaponName}
        sub={`Equip: ${playerMovement.equipTimerSec}s`}
      />
      <MetricTile
        label="Reload Stage"
        value={playerMovement.reloadStage}
        sub={`Progress: ${Math.round(playerMovement.reloadProgress * 100)}%`}
      />
    </div>
  );
});

export const FlightDebugTab = React.memo(function FlightDebugTab({
  flightSamples,
  metrics,
}: {
  flightSamples: CombatDebugSnapshot['flightSamples'];
  metrics: CombatDebugSnapshot['metrics'];
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <MetricTile
          label="Tracked Flight Objects"
          value={`${flightSamples.length}`}
          sub="Projectiles + Aircraft"
        />
        <MetricTile
          label="Speed Outliers"
          value={`${metrics.speedOutliersCount}`}
          sub="Exceeded maxSpeed*1.06"
        />
        <MetricTile
          label="Tunneling Blocked"
          value={`${metrics.tunnelingBlockedCount}`}
          sub="Swept collision guard"
        />
      </div>

      <div className="overflow-x-auto max-h-60 overflow-y-auto border border-zinc-800 bg-[#0B0E11]">
        <table className="w-full text-left border-collapse text-[10px]">
          <thead className="sticky top-0 bg-[#141920] text-zinc-400 uppercase border-b border-zinc-800">
            <tr>
              <th className="py-1 px-1.5">Entity</th>
              <th className="py-1 px-1.5">Phase</th>
              <th className="py-1 px-1.5">Speed / Cap</th>
              <th className="py-1 px-1.5">Turn °/s</th>
              <th className="py-1 px-1.5">Track</th>
              <th className="py-1 px-1.5">Flight / TTI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {flightSamples.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-3 text-center text-zinc-500">
                  No active projectiles or aircraft currently in flight.
                </td>
              </tr>
            ) : (
              flightSamples.map((f) => (
                <tr key={f.id} className={f.speedOutlier ? 'bg-red-950/40' : ''}>
                  <td className="py-1 px-1.5">
                    <div className="font-bold text-zinc-200">{f.id}</div>
                    <div className="text-[9px] text-zinc-500">
                      {f.domain} · {f.category}
                    </div>
                  </td>
                  <td className="py-1 px-1.5 text-cyan-300">{f.stateLabel}</td>
                  <td className="py-1 px-1.5">
                    <span className={f.speedOutlier ? 'text-red-400 font-bold' : 'text-zinc-200'}>
                      {f.speed} / {f.maxSpeed} m/s
                    </span>
                    <div className="text-[9px] text-zinc-500">a={f.acceleration} m/s²</div>
                  </td>
                  <td className="py-1 px-1.5">
                    {f.turnRateDegPerSec}° / {f.maxTurnRateDegPerSec}°
                  </td>
                  <td className="py-1 px-1.5">{f.trackingState}</td>
                  <td className="py-1 px-1.5">
                    {f.flightTimeSec}s / {f.timeToImpactSec !== null ? `${f.timeToImpactSec}s` : '--'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export const ExplosivesDebugTab = React.memo(function ExplosivesDebugTab({
  ordnanceSummary,
  recentExplosions,
  recentDestructions,
}: {
  ordnanceSummary: CombatDebugSnapshot['ordnanceSummary'];
  recentExplosions: CombatDebugSnapshot['recentExplosions'];
  recentDestructions: CombatDebugSnapshot['recentDestructions'];
}) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricTile
          label="C4 Remote Charges"
          value={`${ordnanceSummary.c4Deployed} / ${ordnanceSummary.c4MaxDeployed}`}
          sub={`Inv: ${ordnanceSummary.c4Inventory} · Det: ${ordnanceSummary.c4Detonations}`}
        />
        <MetricTile
          label="Bomb Strikes"
          value={`${ordnanceSummary.bombStrikesCalled}`}
          sub={`${ordnanceSummary.selectedBombId} (CD ${ordnanceSummary.bombCooldownSec}s)`}
        />
        <MetricTile
          label="TRIDENT-X Strike"
          value={ordnanceSummary.nukeUsed ? 'DEPLOYED' : 'READY (1/MSN)'}
          sub={
            ordnanceSummary.nukeCountdownSec > 0
              ? `Countdown ${ordnanceSummary.nukeCountdownSec}s`
              : '2-Step Confirm [N]->[Enter]'
          }
        />
        <MetricTile
          label="Fallout Hazard Zone"
          value={ordnanceSummary.falloutActive ? 'ACTIVE' : 'CLEAR'}
          sub={`Rem: ${ordnanceSummary.falloutRemainingSec}s`}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="bg-[#0B0E11] border border-zinc-800 p-2 max-h-48 overflow-y-auto">
          <div className="text-[10px] uppercase text-zinc-400 mb-1">
            Recent Detonations ({recentExplosions.length})
          </div>
          {recentExplosions.slice(0, 12).map((ex) => (
            <div key={ex.explosionId} className="text-[10px] py-1 border-b border-zinc-900">
              <div className="flex justify-between font-bold">
                <span className={ex.isStrategic ? 'text-amber-300' : 'text-orange-400'}>
                  #{ex.explosionId} {ex.explosiveId}
                </span>
                <span>{ex.totalDamageDealt} DMG</span>
              </div>
              <div className="text-[9px] text-zinc-400">
                r={ex.outerRadius}m · Hits:{ex.entitiesHit} · Occluded:{ex.occludedCount} @{' '}
                {ex.timestampSec}s
              </div>
            </div>
          ))}
        </div>

        <div className="bg-[#0B0E11] border border-zinc-800 p-2 max-h-48 overflow-y-auto">
          <div className="text-[10px] uppercase text-zinc-400 mb-1">
            Destructibles State Log ({recentDestructions.length})
          </div>
          {recentDestructions.length === 0 ? (
            <div className="text-[10px] text-zinc-500">No destructible transitions yet.</div>
          ) : (
            recentDestructions.slice(0, 12).map((d, idx) => (
              <div key={`${d.id}_${idx}`} className="text-[10px] py-1 border-b border-zinc-900">
                <span className="text-zinc-200 font-bold">{d.id}</span> ({d.kind}):{' '}
                <span className="text-amber-300">
                  {d.previousState} → {d.newState}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

export const PerformanceDebugTab = React.memo(function PerformanceDebugTab({
  performance,
}: {
  performance: CombatDebugSnapshot['performance'];
}) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricTile
          label="FPS (Cur / 1% Low)"
          value={`${performance.fps} / ${performance.fps1PercentLow ?? performance.fps}`}
          sub={`Avg ${performance.avgFps} · Min ${performance.minFps} · Max ${performance.maxFps}`}
        />
        <MetricTile
          label="Frame (Avg / p95 / p99)"
          value={`${performance.avgFrameMs} / ${performance.p95FrameMs} / ${performance.p99FrameMs}ms`}
          sub={`CPU Total: ${performance.cpuTimeMs}ms`}
        />
        <MetricTile
          label="Render & Pixel Ratio"
          value={
            performance.renderWidth && performance.renderHeight
              ? `${performance.renderWidth}×${performance.renderHeight}`
              : `${Math.round(performance.renderScale * 100)}%`
          }
          sub={`Scale ${Math.round(performance.renderScale * 100)}% · DPR ${(performance.pixelRatio ?? 1).toFixed(2)}x · ${performance.governorTier}`}
        />
        <MetricTile
          label="Draw / Tris / Mem"
          value={`${performance.drawCalls} / ${performance.triangles.toLocaleString()}`}
          sub={`Spikes: ${performance.spikeCount} · Heap: ${performance.memoryUsedMb != null ? `${performance.memoryUsedMb} MB` : 'N/A'}`}
        />
      </div>

      <div className="bg-[#0B0E11] border border-zinc-800 p-2.5 space-y-1.5">
        <div className="text-[10px] uppercase text-zinc-400">Subsystem CPU Timing Breakdown</div>
        {Object.entries(performance.phases).map(([phase, ms]) => {
          const pct = Math.min(100, Math.round((ms / 16.6) * 100));
          return (
            <div key={phase} className="flex items-center gap-2 text-[10px]">
              <span className="w-28 text-zinc-300">{phase}</span>
              <div className="flex-1 h-2 bg-zinc-900 border border-zinc-800 overflow-hidden">
                <div className="h-full bg-cyan-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-16 text-right text-zinc-200">{ms.toFixed(2)} ms</span>
            </div>
          );
        })}
        <div className="pt-1 text-[9px] text-zinc-500 border-t border-zinc-900">
          {performance.gpuTimerNote}
        </div>
      </div>
    </div>
  );
});

export const ResourcesDebugTab = React.memo(function ResourcesDebugTab({
  resources,
}: {
  resources: CombatDebugSnapshot['resources'];
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      <MetricTile
        label="WebGL Geometries / Mats"
        value={`${resources.geometries} / ${resources.materials}`}
        sub={`Textures: ${resources.textures} · RT: ${resources.renderTargets}`}
      />
      <MetricTile
        label="Listeners / Timers"
        value={`${resources.listeners} / ${resources.timers}`}
        sub={`Audio Voices: ${resources.audioVoices}`}
      />
      <MetricTile
        label="VFX Pool"
        value={`${resources.activePooledVfx} / ${resources.poolCapacityVfx}`}
        sub="Zero per-frame GC allocations"
      />
      <MetricTile
        label="Projectile Pool"
        value={`${resources.activePooledProjectiles} / ${resources.poolCapacityProjectiles}`}
        sub={`Active C4: ${resources.activeC4Count}`}
      />
      <MetricTile
        label="Created / Disposed"
        value={`${resources.totalCreated} / ${resources.totalDisposed}`}
        sub={`Shared: ${resources.sharedCount} · Mission: ${resources.missionCount}`}
      />
      <MetricTile
        label="Mission Leak Audit"
        value={resources.hasMissionLeak ? 'LEAK DETECTED' : 'CLEAN'}
        sub={`Post-Unload Rem: ${resources.missionRemaining} · Shared Δ: ${resources.sharedDelta}`}
      />
    </div>
  );
});

export const TimelineDebugTab = React.memo(function TimelineDebugTab({
  activeEvents,
  filteredEvents,
  eventFilter,
  timelinePaused,
  onChangeFilter,
  onTogglePause,
}: {
  activeEvents: CombatEventRecord[];
  filteredEvents: CombatEventRecord[];
  eventFilter: string;
  timelinePaused: boolean;
  onChangeFilter: (next: string) => void;
  onTogglePause: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <select
          value={eventFilter}
          onChange={(e) => onChangeFilter(e.target.value)}
          className="bg-[#0B0E11] border border-zinc-800 px-2 py-1 text-[10px] text-zinc-200"
        >
          <option value="ALL">All Event Kinds ({activeEvents.length})</option>
          <option value="PROJECTILE_SPAWN">PROJECTILE_SPAWN</option>
          <option value="EXPLOSION">EXPLOSION</option>
          <option value="C4_EVENT">C4_EVENT</option>
          <option value="STRIKE_CALLED">STRIKE_CALLED</option>
          <option value="NUKE_EVENT">NUKE_EVENT</option>
          <option value="TOKEN_ACQUIRED">TOKEN_ACQUIRED</option>
          <option value="PLAYER_DAMAGED">PLAYER_DAMAGED</option>
          <option value="DESTRUCTION">DESTRUCTION</option>
        </select>
        <button
          type="button"
          onClick={onTogglePause}
          className={`px-2.5 py-1 border text-[10px] font-bold uppercase ${
            timelinePaused
              ? 'border-amber-500 bg-amber-950/60 text-amber-300'
              : 'border-zinc-700 bg-zinc-900 text-zinc-300'
          }`}
        >
          {timelinePaused ? 'Resume Timeline' : 'Freeze Timeline'}
        </button>
      </div>

      <div className="bg-[#0B0E11] border border-zinc-800 p-2 max-h-64 overflow-y-auto space-y-1">
        {filteredEvents.slice(0, 120).map((ev) => (
          <div
            key={ev.id}
            className="flex items-start justify-between gap-2 text-[10px] border-b border-zinc-900 pb-0.5"
          >
            <span className="text-zinc-500 shrink-0">{ev.timestampSec.toFixed(1)}s</span>
            <span className="font-semibold text-amber-400 shrink-0">[{ev.kind}]</span>
            <span className="text-zinc-300 flex-1 truncate" title={ev.summary}>
              {ev.unitId} ({ev.domain}): {ev.summary}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

export const WarningsDebugTab = React.memo(function WarningsDebugTab({
  warnings,
}: {
  warnings: CombatDebugSnapshot['warnings'];
}) {
  return (
    <div className="space-y-2 max-h-72 overflow-y-auto">
      {warnings.length === 0 ? (
        <div className="bg-emerald-950/25 border border-emerald-700/60 p-3 text-emerald-300 text-xs">
          All combat AI, flight kinematics, explosion deduplication, performance &amp; leak checks nominal.
        </div>
      ) : (
        warnings.map((w) => (
          <div
            key={w.id}
            className={`border p-2.5 space-y-1 text-[10px] ${
              w.severity === 'CRITICAL'
                ? 'bg-red-950/35 border-red-600/80'
                : w.severity === 'WARNING'
                  ? 'bg-amber-950/30 border-amber-600/70'
                  : 'bg-[#141920] border-zinc-700'
            }`}
          >
            <div className="flex justify-between font-bold">
              <span
                className={
                  w.severity === 'CRITICAL'
                    ? 'text-red-300'
                    : w.severity === 'WARNING'
                      ? 'text-amber-300'
                      : 'text-cyan-300'
                }
              >
                [{w.severity}] {w.ruleId} · {w.subsystem} ({w.entityId})
              </span>
              <span className="text-zinc-400">{w.timestampSec}s</span>
            </div>
            <div className="text-zinc-200">Evidence: {w.measuredEvidence}</div>
            <div className="text-zinc-400">Expected: {w.expectedBehavior}</div>
            <div className="text-zinc-300">Action: {w.suggestedInvestigation}</div>
          </div>
        ))
      )}
    </div>
  );
});

export const ExportDebugTab = React.memo(function ExportDebugTab({
  snapshot,
  baselineSnapshot,
  baselineError,
  comparisonRows,
  onCaptureBaseline,
  onUploadBaseline,
  onClearBaseline,
}: {
  snapshot: CombatDebugSnapshot;
  baselineSnapshot: CombatDebugSnapshot | null;
  baselineError: string | null;
  comparisonRows: BaselineMetricComparison[];
  onCaptureBaseline: () => void;
  onUploadBaseline: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearBaseline: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="bg-[#141920] border border-zinc-800 p-2.5 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">
          Download Live Diagnostic Artifacts
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() =>
              triggerBrowserDownload(
                `vanguard_diag_m${snapshot.missionId}.json`,
                buildJsonDiagnosticReport(snapshot),
                'application/json'
              )
            }
            className="px-2.5 py-1 bg-amber-950/60 border border-amber-500/80 text-amber-300 font-bold uppercase text-[10px]"
          >
            <Download className="w-3 h-3 inline mr-1" />
            Full JSON
          </button>
          <button
            type="button"
            onClick={() =>
              triggerBrowserDownload(
                `vanguard_report_m${snapshot.missionId}.md`,
                buildMarkdownDiagnosticReport(snapshot),
                'text/markdown'
              )
            }
            className="px-2.5 py-1 bg-cyan-950/60 border border-cyan-500/80 text-cyan-300 font-bold uppercase text-[10px]"
          >
            <FileText className="w-3 h-3 inline mr-1" />
            Markdown Report
          </button>
          <button
            type="button"
            onClick={() =>
              triggerBrowserDownload(
                `vanguard_physics_diag_m${snapshot.missionId}.json`,
                buildPhysicsJsonReport(snapshot),
                'application/json'
              )
            }
            className="px-2.5 py-1 bg-purple-950/60 border border-purple-500/80 text-purple-300 font-bold uppercase text-[10px]"
          >
            <Layers className="w-3 h-3 inline mr-1" />
            Physics JSON
          </button>
          <button
            type="button"
            onClick={() =>
              triggerBrowserDownload(
                `vanguard_physics_audit_m${snapshot.missionId}.md`,
                buildPhysicsMarkdownAuditReport(snapshot),
                'text/markdown'
              )
            }
            className="px-2.5 py-1 bg-emerald-950/60 border border-emerald-500/80 text-emerald-300 font-bold uppercase text-[10px]"
          >
            <FileText className="w-3 h-3 inline mr-1" />
            Physics Audit MD
          </button>
          {(
            [
              ['collision_events', 'CSV: Collisions'],
              ['object_movement', 'CSV: Movement'],
              ['enemy_ai', 'CSV: Enemy AI'],
              ['damage', 'CSV: Damage'],
              ['projectiles_flight', 'CSV: Flight'],
              ['performance', 'CSV: Perf'],
              ['resources', 'CSV: Memory'],
              ['warnings', 'CSV: Warnings'],
            ] as Array<[CsvExportKind, string]>
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() =>
                triggerBrowserDownload(
                  `vanguard_${kind}_m${snapshot.missionId}.csv`,
                  buildCsvExport(snapshot, kind),
                  'text/csv'
                )
              }
              className="px-2 py-1 bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-zinc-200 text-[10px]"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-[#0B0E11] border border-zinc-800 p-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-300 font-bold">
            Before &amp; After Baseline Session Comparison
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onCaptureBaseline}
              className="px-2 py-0.5 bg-emerald-950/70 border border-emerald-600/80 text-emerald-300 text-[10px]"
            >
              Capture Current as Baseline
            </button>
            <label className="px-2 py-0.5 bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] cursor-pointer">
              Upload Baseline JSON
              <input
                type="file"
                accept=".json,application/json"
                onChange={onUploadBaseline}
                className="hidden"
              />
            </label>
            {baselineSnapshot && (
              <button
                type="button"
                onClick={onClearBaseline}
                className="px-2 py-0.5 bg-zinc-900 border border-zinc-700 text-zinc-400 text-[10px]"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {baselineError && <div className="text-red-400 text-[10px]">{baselineError}</div>}

        <table className="w-full text-left border-collapse text-[10px]">
          <thead className="bg-[#141920] text-zinc-400 uppercase border-b border-zinc-800">
            <tr>
              <th className="py-1 px-1.5">Metric</th>
              <th className="py-1 px-1.5">Baseline</th>
              <th className="py-1 px-1.5">Current</th>
              <th className="py-1 px-1.5">Delta</th>
              <th className="py-1 px-1.5">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {comparisonRows.map((row) => (
              <tr key={row.metric}>
                <td className="py-1 px-1.5 text-zinc-200">{row.metric}</td>
                <td className="py-1 px-1.5 text-zinc-400">{row.baselineValue}</td>
                <td className="py-1 px-1.5 text-zinc-200">{row.currentValue}</td>
                <td className="py-1 px-1.5 text-zinc-300">{row.delta}</td>
                <td className="py-1 px-1.5">
                  <VerdictBadge verdict={row.verdict} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
