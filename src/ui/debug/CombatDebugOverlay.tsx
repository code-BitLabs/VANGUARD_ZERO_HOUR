import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bomb,
  Compass,
  Cpu,
  Crosshair,
  Download,
  Eye,
  FileText,
  Gauge,
  HardDrive,
  Layers,
  Maximize2,
  Minimize2,
  Navigation,
  Pause,
  Play,
  ShieldAlert,
  Target,
  Users,
  X,
} from 'lucide-react';
import { PhysicsBodyInspectorRow } from '@/src/engine/physics/PhysicsTypes';
import {
  CombatDebugSnapshot,
  CombatEventRecord,
  EnemyDebugInspectorRow,
  ShotTelemetryRecord,
} from '@/src/gameplay/CombatTelemetryRecorder';
import {
  buildCsvExport,
  buildJsonDiagnosticReport,
  buildMarkdownDiagnosticReport,
  buildPhysicsJsonReport,
  buildPhysicsMarkdownAuditReport,
  compareDiagnosticSnapshots,
  ComparisonVerdict,
  CsvExportKind,
  triggerBrowserDownload,
} from '@/src/gameplay/diagnostics/DiagnosticExporter';
import { isEnvDevModeAllowed } from '@/src/config/devMode';
import { useGameSessionStore } from '@/src/stores/gameSessionStore';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { useUIStore } from '@/src/stores/uiStore';

type DebugTabId =
  | 'overview'
  | 'physics'
  | 'enemy_ai'
  | 'squad'
  | 'combat'
  | 'ballistics'
  | 'movement'
  | 'flight'
  | 'explosives'
  | 'performance'
  | 'resources'
  | 'timeline'
  | 'warnings'
  | 'export';

const TABS: Array<{ id: DebugTabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview', icon: Compass },
  { id: 'physics', label: 'Physics', icon: Layers },
  { id: 'enemy_ai', label: 'Enemy AI', icon: Users },
  { id: 'squad', label: 'Squad', icon: Target },
  { id: 'combat', label: 'Combat', icon: ShieldAlert },
  { id: 'ballistics', label: 'Ballistics', icon: Crosshair },
  { id: 'movement', label: 'Movement', icon: Gauge },
  { id: 'flight', label: 'Flight', icon: Navigation },
  { id: 'explosives', label: 'Explosives', icon: Bomb },
  { id: 'performance', label: 'Perf', icon: Cpu },
  { id: 'resources', label: 'Memory', icon: HardDrive },
  { id: 'timeline', label: 'Timeline', icon: Activity },
  { id: 'warnings', label: 'Warnings', icon: AlertTriangle },
  { id: 'export', label: 'Export', icon: Download },
];

export interface CombatDebugOverlayProps {
  onRequestPointerLock?: () => void;
}

export function CombatDebugOverlay({ onRequestPointerLock }: CombatDebugOverlayProps) {
  const screen = useUIStore((s) => s.screen);
  const pointerLocked = useUIStore((s) => s.pointerLocked);
  const combatDebugOpen = useUIStore((s) => s.combatDebugOpen);
  const combatDebugCollapsed = useUIStore((s) => s.combatDebugCollapsed);
  const debugSimPaused = useUIStore((s) => s.debugSimPaused);
  const toggleCombatDebug = useUIStore((s) => s.toggleCombatDebug);
  const setCombatDebugCollapsed = useUIStore((s) => s.setCombatDebugCollapsed);
  const toggleDebugSimPaused = useUIStore((s) => s.toggleDebugSimPaused);
  const developer = useSettingsStore((s) => s.developer);
  const updateDeveloper = useSettingsStore((s) => s.updateDeveloper);
  const diagnostics = useGameSessionStore((s) => s.diagnostics);
  const snapshot = useGameSessionStore((s) => s.combatDebug);

  const [activeTab, setActiveTab] = useState<DebugTabId>('overview');
  const [selectedEnemyId, setSelectedEnemyId] = useState<string | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<number | null>(null);
  const [selectedPhysicsBodyId, setSelectedPhysicsBodyId] = useState<string | null>(null);
  const [physicsBodyFilter, setPhysicsBodyFilter] = useState('');
  const [enemyFilter, setEnemyFilter] = useState('');
  const [timelinePaused, setTimelinePaused] = useState(false);
  const [frozenEvents, setFrozenEvents] = useState<CombatEventRecord[]>([]);
  const [eventFilter, setEventFilter] = useState('ALL');
  const [baselineSnapshot, setBaselineSnapshot] = useState<CombatDebugSnapshot | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);

  const activeEvents = timelinePaused ? frozenEvents : (snapshot?.recentEvents ?? []);
  const filteredEvents = useMemo(() => {
    if (eventFilter === 'ALL') return activeEvents;
    return activeEvents.filter((e) => e.kind === eventFilter);
  }, [activeEvents, eventFilter]);

  const comparisonRows = useMemo(
    () => compareDiagnosticSnapshots(baselineSnapshot, snapshot),
    [baselineSnapshot, snapshot]
  );

  if (!isEnvDevModeAllowed() || !developer.devModeEnabled || !combatDebugOpen) return null;

  const dockClass = developer.debugDockSide === 'left' ? 'left-3' : 'right-3';
  const bgOpacity = Math.max(0.4, Math.min(0.98, developer.debugOverlayOpacity));

  const selectedEnemy: EnemyDebugInspectorRow | null =
    snapshot?.enemies.find((e) => e.id === selectedEnemyId) ?? null;
  const selectedShot: ShotTelemetryRecord | null =
    snapshot?.recentShots.find((s) => s.shotId === selectedShotId) ?? null;
  const selectedPhysicsBody: PhysicsBodyInspectorRow | null =
    snapshot?.physics?.bodies.find((b) => b.id === selectedPhysicsBodyId) ?? null;

  const handleTogglePauseTimeline = () => {
    if (!timelinePaused && snapshot) {
      setFrozenEvents(snapshot.recentEvents);
    }
    setTimelinePaused((v) => !v);
  };

  const handleUploadBaseline = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const candidate: CombatDebugSnapshot = parsed?.snapshot ?? parsed;
        if (!candidate?.metrics || !candidate?.performance) {
          setBaselineError('Invalid diagnostic JSON schema.');
          return;
        }
        setBaselineSnapshot(candidate);
        setBaselineError(null);
      } catch {
        setBaselineError('Failed to parse baseline JSON file.');
      }
    };
    reader.readAsText(file);
  };

  const warnCount = snapshot?.warnings.length ?? 0;
  const liveFps = snapshot?.performance.fps ?? diagnostics.fps;
  const liveFrameMs = snapshot?.performance.frameMs ?? diagnostics.frameMs;
  const activeAttackers = snapshot?.coordinator.currentGlobalAttackers ?? 0;
  const maxAttackers = snapshot?.coordinator.maxGlobalAttackers ?? 3;

  if (combatDebugCollapsed) {
    return (
      <div
        role="region"
        aria-label="Collapsed Combat Diagnostics Bubble"
        style={{ backgroundColor: `rgba(11, 14, 17, ${bgOpacity})` }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="fixed top-3 right-3 z-40 border border-zinc-700/90 rounded-sm shadow-xl px-2.5 py-1.5 text-zinc-100 font-mono text-[11px] flex items-center gap-2 tabular-nums pointer-events-auto whitespace-nowrap"
      >
        <BarChart3 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="text-zinc-400">[F4]</span>
        <span className={liveFps < 30 ? 'text-red-400 font-bold' : 'text-emerald-300 font-bold'}>
          {liveFps} FPS
        </span>
        <span className="text-zinc-500">{liveFrameMs}ms</span>
        {snapshot && (
          <span className="text-cyan-300">
            ATK {activeAttackers}/{maxAttackers}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setActiveTab('warnings');
            setCombatDebugCollapsed(false);
          }}
          className={`px-1.5 py-0.5 border text-[10px] font-bold whitespace-nowrap shrink-0 ${
            warnCount > 0
              ? 'bg-red-950/90 border-red-500/80 text-red-300'
              : 'bg-emerald-950/70 border-emerald-600/60 text-emerald-300'
          }`}
          title="Open Diagnostics Warnings Tab"
        >
          {warnCount > 0 ? `${warnCount} WARN` : 'NOMINAL'}
        </button>
        <button
          type="button"
          aria-label="Expand Diagnostics Console"
          onClick={() => setCombatDebugCollapsed(false)}
          className="px-2 py-0.5 border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-[10px] flex items-center gap-1 whitespace-nowrap shrink-0"
        >
          <Maximize2 className="w-3 h-3" />
          <span>Expand</span>
        </button>
        {screen === 'playing' && !pointerLocked && onRequestPointerLock && (
          <button
            type="button"
            aria-label="Lock Aim to Game"
            onClick={onRequestPointerLock}
            className="px-2 py-0.5 border border-cyan-600/70 bg-cyan-950/60 hover:bg-cyan-900/70 text-cyan-200 text-[10px] whitespace-nowrap shrink-0"
            title="Re-lock mouse cursor for FPS aim [TAB]"
          >
            Aim [TAB]
          </button>
        )}
        <button
          type="button"
          aria-label="Close Diagnostics"
          onClick={toggleCombatDebug}
          className="p-0.5 border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 shrink-0"
          title="Close Diagnostics [F4]"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Combat AI, Ballistics, Flight & Performance Diagnostic Console"
      style={{ backgroundColor: `rgba(11, 14, 17, ${bgOpacity})` }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={`fixed top-12 ${dockClass} z-40 w-[640px] max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-3.5rem)] border border-zinc-700/90 rounded-sm shadow-2xl text-zinc-100 font-mono text-[11px] flex flex-col pointer-events-auto`}
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800 bg-[#141920]/95">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
          <span className="font-bold uppercase tracking-wider text-amber-400">
            Combat &amp; Engine Diagnostics
          </span>
          <span className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-300">
            [F4]
          </span>
          {warnCount > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('warnings')}
              className="px-1.5 py-0.5 bg-red-950/90 border border-red-500/80 text-red-300 text-[10px] font-bold"
            >
              {warnCount} WARN
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {screen === 'playing' && (
            <button
              type="button"
              aria-label={debugSimPaused ? 'Resume Simulation' : 'Pause Simulation'}
              onClick={toggleDebugSimPaused}
              className={`px-2 py-0.5 border text-[10px] uppercase flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                debugSimPaused
                  ? 'border-amber-500/80 bg-amber-950/70 text-amber-300'
                  : 'border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300'
              }`}
              title="Freeze/Resume 3D world & AI ticks while inspecting telemetry"
            >
              {debugSimPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              <span>{debugSimPaused ? 'Resume Sim' : 'Pause Sim'}</span>
            </button>
          )}
          {screen === 'playing' && !pointerLocked && onRequestPointerLock && (
            <button
              type="button"
              aria-label="Return to FPS Aim"
              onClick={onRequestPointerLock}
              className="px-2 py-0.5 border border-cyan-500/70 bg-cyan-950/60 hover:bg-cyan-900/70 text-cyan-200 text-[10px] uppercase whitespace-nowrap shrink-0"
              title="Lock mouse back into FPS camera [TAB]"
            >
              Aim [TAB]
            </button>
          )}
          <button
            type="button"
            onClick={() => updateDeveloper({ debugShow3DGizmos: !developer.debugShow3DGizmos })}
            className={`px-2 py-0.5 border text-[10px] uppercase transition-colors ${
              developer.debugShow3DGizmos
                ? 'border-emerald-500/70 bg-emerald-950/60 text-emerald-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400'
            }`}
          >
            <Eye className="w-3 h-3 inline mr-1" />
            Gizmos: {developer.debugShow3DGizmos ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => updateDeveloper({ debugShowFlightPaths: !developer.debugShowFlightPaths })}
            className={`px-2 py-0.5 border text-[10px] uppercase transition-colors ${
              developer.debugShowFlightPaths
                ? 'border-cyan-500/70 bg-cyan-950/60 text-cyan-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400'
            }`}
          >
            Flight: {developer.debugShowFlightPaths ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() =>
              updateDeveloper({ debugShowPhysicsColliders: !developer.debugShowPhysicsColliders })
            }
            className={`px-2 py-0.5 border text-[10px] uppercase transition-colors ${
              developer.debugShowPhysicsColliders
                ? 'border-purple-500/80 bg-purple-950/60 text-purple-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400'
            }`}
            title="Render 3D Physics Collider Wireframes, Surface Contact Normals & Blocked Movement Vectors"
          >
            Colliders: {developer.debugShowPhysicsColliders ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() =>
              updateDeveloper({ sandboxOrdnanceAuthorized: !developer.sandboxOrdnanceAuthorized })
            }
            className={`px-2 py-0.5 border text-[10px] uppercase transition-colors ${
              developer.sandboxOrdnanceAuthorized
                ? 'border-amber-500/80 bg-amber-950/60 text-amber-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400'
            }`}
            title="Bypass Requisition Cost for Tactical Bomb Strikes & TRIDENT-X Testing"
          >
            Sandbox: {developer.sandboxOrdnanceAuthorized ? 'AUTH' : 'REQ'}
          </button>
          <button
            type="button"
            aria-label="Collapse Diagnostics to Bubble"
            onClick={() => setCombatDebugCollapsed(true)}
            className="px-2 py-0.5 border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-[10px] flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Minimize2 className="w-3 h-3" />
            <span>Bubble</span>
          </button>
          <button
            type="button"
            onClick={toggleCombatDebug}
            className="px-2 py-0.5 border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10px] whitespace-nowrap shrink-0"
          >
            Close
          </button>
        </div>
      </div>

      {/* 13-Tab Bar */}
      <div className="flex flex-wrap gap-1 px-2.5 py-1.5 border-b border-zinc-800 bg-[#0f1318]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-2 py-1 text-[10px] uppercase font-bold border flex items-center gap-1 transition-colors ${
                active
                  ? 'border-amber-500/90 bg-amber-950/45 text-amber-300'
                  : 'border-zinc-800 bg-[#141920] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="w-3 h-3" />
              <span>{t.label}</span>
              {t.id === 'warnings' && warnCount > 0 && (
                <span className="text-red-400">({warnCount})</span>
              )}
            </button>
          );
        })}
      </div>

      {!snapshot ? (
        <div className="p-4 text-zinc-400 text-xs">
          Deploy into an active mission to inspect live Combat AI, Flight Physics, Explosives, Performance &amp; Resource telemetry.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
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
                        <strong className="text-red-300">[{w.severity}] {w.ruleId}</strong> — {w.measuredEvidence}
                      </span>
                      <span className="text-zinc-500 shrink-0">{w.timestampSec}s</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 1B: UNIFIED PHYSICS WORLD & BODY INSPECTOR */}
          {activeTab === 'physics' && snapshot.physics && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <MetricTile
                  label="Physics Solver"
                  value={snapshot.physics.rapierInitialized ? 'Rapier3D WASM + BVH' : 'PhysicsWorld + BVH'}
                  sub={`Fixed Step: ${Math.round(1 / snapshot.physics.fixedTimestepSec)}Hz (${(snapshot.physics.fixedTimestepSec * 1000).toFixed(1)}ms)`}
                />
                <MetricTile
                  label="Bodies (Tot / Stat / Dyn)"
                  value={`${snapshot.physics.totalBodies} (${snapshot.physics.staticBodiesCount}S / ${snapshot.physics.dynamicBodiesCount + snapshot.physics.kinematicBodiesCount + snapshot.physics.characterBodiesCount}D)`}
                  sub={`Chars: ${snapshot.physics.characterBodiesCount} · Bounds: ±${snapshot.physics.worldBoundsMax}m`}
                />
                <MetricTile
                  label="Per-Frame Queries"
                  value={`Col:${snapshot.physics.collisionChecksPerFrame} Ray:${snapshot.physics.raycastsPerFrame}`}
                  sub={`Swept Casts: ${snapshot.physics.shapeCastsPerFrame} · Pairs: ${snapshot.physics.activeCollisionPairs}`}
                />
                <MetricTile
                  label="Collision Guards"
                  value={`Pen:${snapshot.physics.penetrationCorrectionsTotal} Blk:${snapshot.physics.blockedMovementsTotal}`}
                  sub={`Ceil:${snapshot.physics.ceilingStandupBlocksTotal} Bnd:${snapshot.physics.worldBoundaryClampsTotal} CCD:${snapshot.physics.tunnelingPreventedTotal} Veh:${snapshot.physics.vehicleBuildingImpactsTotal}`}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={physicsBodyFilter}
                  onChange={(e) => setPhysicsBodyFilter(e.target.value)}
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
                    {snapshot.physics.bodies
                      .filter((b) => {
                        if (!physicsBodyFilter.trim()) return true;
                        const q = physicsBodyFilter.toLowerCase();
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
                          onClick={() =>
                            setSelectedPhysicsBodyId(b.id === selectedPhysicsBodyId ? null : b.id)
                          }
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
                      onClick={() => setSelectedPhysicsBodyId(null)}
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
                    Recent Surface Contacts ({snapshot.physics.recentContacts.length})
                  </div>
                  {snapshot.physics.recentContacts.length === 0 ? (
                    <div className="text-[10px] text-zinc-500">No recent surface contacts recorded.</div>
                  ) : (
                    snapshot.physics.recentContacts.slice(0, 12).map((c, idx) => (
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
                    Physics Warnings ({snapshot.physics.physicsWarnings.length})
                  </div>
                  {snapshot.physics.physicsWarnings.length === 0 ? (
                    <div className="text-[10px] text-emerald-400">
                      Zero physics overlap, tunneling, or boundary anomalies.
                    </div>
                  ) : (
                    snapshot.physics.physicsWarnings.slice(0, 10).map((pw) => (
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
          )}

          {/* TAB 2: ENEMY AI + INTERACTIVE INSPECTOR */}
          {activeTab === 'enemy_ai' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={enemyFilter}
                  onChange={(e) => setEnemyFilter(e.target.value)}
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
                    {snapshot.enemies
                      .filter((u) => {
                        if (!enemyFilter.trim()) return true;
                        const q = enemyFilter.toLowerCase();
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
                          onClick={() => setSelectedEnemyId(u.id === selectedEnemyId ? null : u.id)}
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
                      onClick={() => setSelectedEnemyId(null)}
                      className="text-zinc-400 hover:text-zinc-200"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-zinc-300">
                    <div>Pos: ({selectedEnemy.x}, {selectedEnemy.y}, {selectedEnemy.z})</div>
                    <div>FOV/Range: {selectedEnemy.fovDeg}° / {selectedEnemy.detectionRange}m</div>
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
                      FSM Invalid: {selectedEnemy.invalidTransitionCount ?? 0} ({selectedEnemy.lastTransition ?? 'NONE'})
                    </div>
                    <div>
                      Obstruction: {selectedEnemy.obstructionDurationSec ?? 0}s
                    </div>
                    <div>
                      Blocked Shots: {selectedEnemy.blockedShotAttempts ?? 0}
                    </div>
                    <div>
                      LOS Recovery:{' '}
                      {selectedEnemy.lastLosRecoverySec !== null && selectedEnemy.lastLosRecoverySec !== undefined
                        ? `${selectedEnemy.lastLosRecoverySec}s`
                        : '--'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SQUAD COORDINATION */}
          {activeTab === 'squad' && (
            <div className="space-y-2.5">
              <div className="bg-[#141920]/90 border border-zinc-800 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-zinc-400">
                    Global Coordinator [{snapshot.coordinator.difficulty.toUpperCase()}]
                  </span>
                  {snapshot.coordinator.pressureThrottled ? (
                    <span className="px-1.5 py-0.5 bg-red-950/90 border border-red-500/80 text-red-300 text-[10px] font-bold">
                      BURST THROTTLE ({snapshot.coordinator.rolling2sDamage}/{snapshot.coordinator.damageBurstThreshold2s} HP 2s)
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 bg-emerald-950/70 border border-emerald-600/60 text-emerald-300 text-[10px]">
                      PRESSURE NOMINAL ({snapshot.coordinator.rolling2sDamage}/{snapshot.coordinator.damageBurstThreshold2s} HP 2s)
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  <MetricTile
                    label="Direct"
                    value={`${snapshot.coordinator.currentGlobalAttackers}/${snapshot.coordinator.maxGlobalAttackers}`}
                    sub={`Avail: ${snapshot.coordinator.availableGlobalTokens}`}
                  />
                  <MetricTile
                    label="Heavy"
                    value={`${snapshot.coordinator.currentGlobalHeavyAttackers}/${snapshot.coordinator.maxGlobalHeavyAttackers}`}
                    sub="Air/Armor"
                  />
                  <MetricTile
                    label="Suppress"
                    value={`${snapshot.coordinator.currentGlobalSuppressors}/${snapshot.coordinator.maxGlobalSuppressors}`}
                    sub={`Waiting: ${snapshot.coordinator.waitingAttackersCount}`}
                  />
                  <MetricTile
                    label="Token Health"
                    value={`${snapshot.metrics.tokenAcquisitionAvgMs}ms`}
                    sub={`Starved: ${snapshot.metrics.tokenStarvationCount} · Invalid: ${snapshot.metrics.invalidAttackAttempts}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {snapshot.coordinator.squads.map((sq) => (
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
                        Suppressors: <strong className="text-purple-400">{sq.activeSuppressors}/{sq.maxSquadSuppressors}</strong>
                      </span>
                      <span>Waiting: {sq.waitingCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: COMBAT & DAMAGE */}
          {activeTab === 'combat' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <MetricTile
                  label="DMG 5s / 10s / 30s"
                  value={`${snapshot.metrics.damageLast5s} / ${snapshot.metrics.damageLast10s} / ${snapshot.metrics.damageLast30s}`}
                  sub={`Total: ${snapshot.metrics.totalDamageReceived} HP`}
                />
                <MetricTile
                  label="Armor / Health"
                  value={`${snapshot.metrics.totalArmorAbsorbed} / ${snapshot.metrics.totalHealthLost}`}
                  sub={`Dup Guard Blocked: ${snapshot.metrics.duplicateDamageBlockedCount}`}
                />
                <MetricTile
                  label="By Domain"
                  value={`G:${snapshot.metrics.damageByDomain.ground} A:${snapshot.metrics.damageByDomain.air}`}
                  sub={`Vehicle: ${snapshot.metrics.damageByDomain.vehicle}`}
                />
                <MetricTile
                  label="Hit Zones"
                  value={`H:${snapshot.metrics.hitZoneCounts.head} T:${snapshot.metrics.hitZoneCounts.upper_torso}`}
                  sub={`L:${snapshot.metrics.hitZoneCounts.lower_body} S:${snapshot.metrics.hitZoneCounts.splash}`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="bg-[#0B0E11] border border-zinc-800 p-2 max-h-48 overflow-y-auto">
                  <div className="text-[10px] uppercase text-zinc-400 mb-1">Damage by Weapon Class</div>
                  {Object.entries(snapshot.metrics.damageByWeapon).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-[10px] py-0.5 border-b border-zinc-900">
                      <span>{k}</span>
                      <span className="text-amber-400 font-bold">{v} HP</span>
                    </div>
                  ))}
                </div>
                <div className="bg-[#0B0E11] border border-zinc-800 p-2 max-h-48 overflow-y-auto">
                  <div className="text-[10px] uppercase text-zinc-400 mb-1">Recent Damage Events</div>
                  {snapshot.recentDamages.slice(0, 14).map((d) => (
                    <div key={`${d.shotId}_${d.timestampSec}`} className="flex justify-between text-[10px] py-0.5 border-b border-zinc-900">
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
          )}

          {/* TAB 5: BALLISTICS & COVER */}
          {activeTab === 'ballistics' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <MetricTile
                  label="Raycasts Executed"
                  value={`${snapshot.ballisticsStats.raycastsExecuted}`}
                  sub={`Avg: ${snapshot.ballisticsStats.raycastAvgMs}ms · Max: ${snapshot.ballisticsStats.raycastMaxMs}ms`}
                />
                <MetricTile
                  label="Cover Blocked"
                  value={`${snapshot.metrics.coverBlockedPercentage}%`}
                  sub={`${snapshot.metrics.totalShotsBlockedByCover} / ${snapshot.metrics.totalShotsFired} shots`}
                />
                <MetricTile
                  label="Blocker Breakdown"
                  value={`COV:${snapshot.ballisticsStats.blockedByCategory.COVER} WLD:${snapshot.ballisticsStats.blockedByCategory.WORLD}`}
                  sub={`VEH:${snapshot.ballisticsStats.blockedByCategory.VEHICLE} DST:${snapshot.ballisticsStats.blockedByCategory.DESTRUCTIBLE}`}
                />
                <MetricTile
                  label="Hit vs Missed"
                  value={`${snapshot.metrics.totalShotsHit} / ${snapshot.metrics.totalShotsMissed}`}
                  sub={`Hit Rate: ${snapshot.metrics.enemyHitPercentage}%`}
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
                    {[...snapshot.recentShots].reverse().slice(0, 30).map((s) => (
                      <tr
                        key={s.shotId}
                        onClick={() => setSelectedShotId(s.shotId === selectedShotId ? null : s.shotId)}
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
                        <td className="py-1 px-1.5">
                          {s.hitZone ?? s.blockerColliderId ?? '--'}
                        </td>
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
                    Origin: ({selectedShot.originX.toFixed(1)}, {selectedShot.originY.toFixed(1)}, {selectedShot.originZ.toFixed(1)}) →
                    End: ({selectedShot.endX.toFixed(1)}, {selectedShot.endY.toFixed(1)}, {selectedShot.endZ.toFixed(1)}) ·
                    Blocker Cat: {selectedShot.blockerCategory ?? 'NONE'}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 6: PLAYER MOVEMENT */}
          {activeTab === 'movement' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <MetricTile
                label="Speed (3D / Horiz)"
                value={`${snapshot.playerMovement.speed} / ${snapshot.playerMovement.horizontalSpeed} m/s`}
                sub={`State: ${snapshot.playerMovement.accelState}`}
              />
              <MetricTile
                label="Velocity Vector"
                value={`(${snapshot.playerMovement.velX}, ${snapshot.playerMovement.velY}, ${snapshot.playerMovement.velZ})`}
                sub={`Grounded: ${snapshot.playerMovement.grounded ? 'YES' : 'AIRBORNE'}`}
              />
              <MetricTile
                label="Stance & Air Time"
                value={snapshot.playerMovement.stance.toUpperCase()}
                sub={`Air: ${snapshot.playerMovement.airTimeSec}s · Jmp:${snapshot.playerMovement.lastJumpImpulse} Lnd:${snapshot.playerMovement.lastLandImpulse}`}
              />
              <MetricTile
                label="Recoil Offsets"
                value={`P:${snapshot.playerMovement.recoilPitchDeg}° Y:${snapshot.playerMovement.recoilYawDeg}°`}
                sub={`Trauma: ${snapshot.playerMovement.trauma} · Sup: ${snapshot.playerMovement.suppressionLevel}`}
              />
              <MetricTile
                label="Active Weapon"
                value={snapshot.playerMovement.weaponName}
                sub={`Equip: ${snapshot.playerMovement.equipTimerSec}s`}
              />
              <MetricTile
                label="Reload Stage"
                value={snapshot.playerMovement.reloadStage}
                sub={`Progress: ${Math.round(snapshot.playerMovement.reloadProgress * 100)}%`}
              />
            </div>
          )}

          {/* TAB 7: PROJECTILES & FLIGHT */}
          {activeTab === 'flight' && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <MetricTile
                  label="Tracked Flight Objects"
                  value={`${snapshot.flightSamples.length}`}
                  sub="Projectiles + Aircraft"
                />
                <MetricTile
                  label="Speed Outliers"
                  value={`${snapshot.metrics.speedOutliersCount}`}
                  sub="Exceeded maxSpeed*1.06"
                />
                <MetricTile
                  label="Tunneling Blocked"
                  value={`${snapshot.metrics.tunnelingBlockedCount}`}
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
                    {snapshot.flightSamples.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-3 text-center text-zinc-500">
                          No active projectiles or aircraft currently in flight.
                        </td>
                      </tr>
                    ) : (
                      snapshot.flightSamples.map((f) => (
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
          )}

          {/* TAB 8: EXPLOSIONS & DESTRUCTION */}
          {activeTab === 'explosives' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <MetricTile
                  label="C4 Remote Charges"
                  value={`${snapshot.ordnanceSummary.c4Deployed} / ${snapshot.ordnanceSummary.c4MaxDeployed}`}
                  sub={`Inv: ${snapshot.ordnanceSummary.c4Inventory} · Det: ${snapshot.ordnanceSummary.c4Detonations}`}
                />
                <MetricTile
                  label="Bomb Strikes"
                  value={`${snapshot.ordnanceSummary.bombStrikesCalled}`}
                  sub={`${snapshot.ordnanceSummary.selectedBombId} (CD ${snapshot.ordnanceSummary.bombCooldownSec}s)`}
                />
                <MetricTile
                  label="TRIDENT-X Strike"
                  value={snapshot.ordnanceSummary.nukeUsed ? 'DEPLOYED' : 'READY (1/MSN)'}
                  sub={
                    snapshot.ordnanceSummary.nukeCountdownSec > 0
                      ? `Countdown ${snapshot.ordnanceSummary.nukeCountdownSec}s`
                      : '2-Step Confirm [N]->[Enter]'
                  }
                />
                <MetricTile
                  label="Fallout Hazard Zone"
                  value={snapshot.ordnanceSummary.falloutActive ? 'ACTIVE' : 'CLEAR'}
                  sub={`Rem: ${snapshot.ordnanceSummary.falloutRemainingSec}s`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="bg-[#0B0E11] border border-zinc-800 p-2 max-h-48 overflow-y-auto">
                  <div className="text-[10px] uppercase text-zinc-400 mb-1">
                    Recent Detonations ({snapshot.recentExplosions.length})
                  </div>
                  {snapshot.recentExplosions.slice(0, 12).map((ex) => (
                    <div key={ex.explosionId} className="text-[10px] py-1 border-b border-zinc-900">
                      <div className="flex justify-between font-bold">
                        <span className={ex.isStrategic ? 'text-amber-300' : 'text-orange-400'}>
                          #{ex.explosionId} {ex.explosiveId}
                        </span>
                        <span>{ex.totalDamageDealt} DMG</span>
                      </div>
                      <div className="text-[9px] text-zinc-400">
                        r={ex.outerRadius}m · Hits:{ex.entitiesHit} · Occluded:{ex.occludedCount} @ {ex.timestampSec}s
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-[#0B0E11] border border-zinc-800 p-2 max-h-48 overflow-y-auto">
                  <div className="text-[10px] uppercase text-zinc-400 mb-1">
                    Destructibles State Log ({snapshot.recentDestructions.length})
                  </div>
                  {snapshot.recentDestructions.length === 0 ? (
                    <div className="text-[10px] text-zinc-500">No destructible transitions yet.</div>
                  ) : (
                    snapshot.recentDestructions.slice(0, 12).map((d, idx) => (
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
          )}

          {/* TAB 9: PERFORMANCE */}
          {activeTab === 'performance' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <MetricTile
                  label="FPS (Cur / 1% Low)"
                  value={`${snapshot.performance.fps} / ${snapshot.performance.fps1PercentLow ?? snapshot.performance.fps}`}
                  sub={`Avg ${snapshot.performance.avgFps} · Min ${snapshot.performance.minFps} · Max ${snapshot.performance.maxFps}`}
                />
                <MetricTile
                  label="Frame (Avg / p95 / p99)"
                  value={`${snapshot.performance.avgFrameMs} / ${snapshot.performance.p95FrameMs} / ${snapshot.performance.p99FrameMs}ms`}
                  sub={`CPU Total: ${snapshot.performance.cpuTimeMs}ms`}
                />
                <MetricTile
                  label="Render & Pixel Ratio"
                  value={
                    snapshot.performance.renderWidth && snapshot.performance.renderHeight
                      ? `${snapshot.performance.renderWidth}×${snapshot.performance.renderHeight}`
                      : `${Math.round(snapshot.performance.renderScale * 100)}%`
                  }
                  sub={`Scale ${Math.round(snapshot.performance.renderScale * 100)}% · DPR ${(snapshot.performance.pixelRatio ?? 1).toFixed(2)}x · ${snapshot.performance.governorTier}`}
                />
                <MetricTile
                  label="Draw / Tris / Mem"
                  value={`${snapshot.performance.drawCalls} / ${snapshot.performance.triangles.toLocaleString()}`}
                  sub={`Spikes: ${snapshot.performance.spikeCount} · Heap: ${snapshot.performance.memoryUsedMb != null ? `${snapshot.performance.memoryUsedMb} MB` : 'N/A'}`}
                />
              </div>

              <div className="bg-[#0B0E11] border border-zinc-800 p-2.5 space-y-1.5">
                <div className="text-[10px] uppercase text-zinc-400">Subsystem CPU Timing Breakdown</div>
                {Object.entries(snapshot.performance.phases).map(([phase, ms]) => {
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
                  {snapshot.performance.gpuTimerNote}
                </div>
              </div>
            </div>
          )}

          {/* TAB 10: MEMORY & RESOURCES */}
          {activeTab === 'resources' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <MetricTile
                label="WebGL Geometries / Mats"
                value={`${snapshot.resources.geometries} / ${snapshot.resources.materials}`}
                sub={`Textures: ${snapshot.resources.textures} · RT: ${snapshot.resources.renderTargets}`}
              />
              <MetricTile
                label="Listeners / Timers"
                value={`${snapshot.resources.listeners} / ${snapshot.resources.timers}`}
                sub={`Audio Voices: ${snapshot.resources.audioVoices}`}
              />
              <MetricTile
                label="VFX Pool"
                value={`${snapshot.resources.activePooledVfx} / ${snapshot.resources.poolCapacityVfx}`}
                sub="Zero per-frame GC allocations"
              />
              <MetricTile
                label="Projectile Pool"
                value={`${snapshot.resources.activePooledProjectiles} / ${snapshot.resources.poolCapacityProjectiles}`}
                sub={`Active C4: ${snapshot.resources.activeC4Count}`}
              />
              <MetricTile
                label="Created / Disposed"
                value={`${snapshot.resources.totalCreated} / ${snapshot.resources.totalDisposed}`}
                sub={`Shared: ${snapshot.resources.sharedCount} · Mission: ${snapshot.resources.missionCount}`}
              />
              <MetricTile
                label="Mission Leak Audit"
                value={snapshot.resources.hasMissionLeak ? 'LEAK DETECTED' : 'CLEAN'}
                sub={`Post-Unload Rem: ${snapshot.resources.missionRemaining} · Shared Δ: ${snapshot.resources.sharedDelta}`}
              />
            </div>
          )}

          {/* TAB 11: EVENT TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <select
                  value={eventFilter}
                  onChange={(e) => setEventFilter(e.target.value)}
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
                  onClick={handleTogglePauseTimeline}
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
          )}

          {/* TAB 12: DIAGNOSTICS & WARNINGS */}
          {activeTab === 'warnings' && (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {snapshot.warnings.length === 0 ? (
                <div className="bg-emerald-950/25 border border-emerald-700/60 p-3 text-emerald-300 text-xs">
                  All combat AI, flight kinematics, explosion deduplication, performance &amp; leak checks nominal.
                </div>
              ) : (
                snapshot.warnings.map((w) => (
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
          )}

          {/* TAB 13: EXPORT & BASELINE COMPARISON */}
          {activeTab === 'export' && (
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
                      onClick={() => {
                        setBaselineSnapshot(snapshot);
                        setBaselineError(null);
                      }}
                      className="px-2 py-0.5 bg-emerald-950/70 border border-emerald-600/80 text-emerald-300 text-[10px]"
                    >
                      Capture Current as Baseline
                    </button>
                    <label className="px-2 py-0.5 bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] cursor-pointer">
                      Upload Baseline JSON
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={handleUploadBaseline}
                        className="hidden"
                      />
                    </label>
                    {baselineSnapshot && (
                      <button
                        type="button"
                        onClick={() => setBaselineSnapshot(null)}
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
          )}
        </div>
      )}
    </aside>
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

function MetricTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-[#141920]/90 border border-zinc-800 p-2">
      <div className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="text-xs font-bold text-zinc-100 mt-0.5 truncate">{value}</div>
      <div className="text-[9px] text-zinc-400 truncate mt-0.5">{sub}</div>
    </div>
  );
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
