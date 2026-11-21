import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
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
import { CombatDebugSnapshot, CombatEventRecord } from '@/src/gameplay/CombatTelemetryRecorder';
import { compareDiagnosticSnapshots } from '@/src/gameplay/diagnostics/DiagnosticExporter';
import { isEnvDevModeAllowed } from '@/src/config/devMode';
import { useGameSessionStore } from '@/src/stores/gameSessionStore';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { useUIStore } from '@/src/stores/uiStore';
import {
  BallisticsDebugTab,
  CombatDebugTab,
  EnemyAiDebugTab,
  ExplosivesDebugTab,
  ExportDebugTab,
  FlightDebugTab,
  MovementDebugTab,
  OverviewDebugTab,
  PerformanceDebugTab,
  PhysicsDebugTab,
  ResourcesDebugTab,
  SquadDebugTab,
  TimelineDebugTab,
  WarningsDebugTab,
} from './CombatDebugTabs';

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
  const deferredPhysicsBodyFilter = useDeferredValue(physicsBodyFilter);
  const deferredEnemyFilter = useDeferredValue(enemyFilter);
  const [timelinePaused, setTimelinePaused] = useState(false);
  const [frozenEvents, setFrozenEvents] = useState<CombatEventRecord[]>([]);
  const [eventFilter, setEventFilter] = useState('ALL');
  const [baselineSnapshot, setBaselineSnapshot] = useState<CombatDebugSnapshot | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);

  const activeEvents = timelinePaused ? frozenEvents : (snapshot?.recentEvents ?? []);
  const filteredEvents = useMemo(() => {
    if (activeTab !== 'timeline') return [];
    if (eventFilter === 'ALL') return activeEvents;
    return activeEvents.filter((e) => e.kind === eventFilter);
  }, [activeTab, activeEvents, eventFilter]);

  const comparisonRows = useMemo(
    () => (activeTab === 'export' ? compareDiagnosticSnapshots(baselineSnapshot, snapshot) : []),
    [activeTab, baselineSnapshot, snapshot]
  );

  const handleTogglePauseTimeline = useCallback(() => {
    if (!timelinePaused && snapshot) {
      setFrozenEvents(snapshot.recentEvents);
    }
    setTimelinePaused((v) => !v);
  }, [timelinePaused, snapshot]);

  const handleCaptureBaseline = useCallback(() => {
    if (!snapshot) return;
    setBaselineSnapshot(snapshot);
    setBaselineError(null);
  }, [snapshot]);

  const handleClearBaseline = useCallback(() => {
    setBaselineSnapshot(null);
  }, []);

  const handleUploadBaseline = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, []);

  if (!isEnvDevModeAllowed() || !developer.devModeEnabled || !combatDebugOpen) return null;

  const dockClass = developer.debugDockSide === 'left' ? 'left-3' : 'right-3';
  const bgOpacity = Math.max(0.4, Math.min(0.98, developer.debugOverlayOpacity));

  const warnCount =
    snapshot?.warnings.filter((w) => w.severity === 'WARNING' || w.severity === 'CRITICAL')
      .length ?? 0;
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

      {/* 14-Tab Bar */}
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
          {activeTab === 'overview' && <OverviewDebugTab snapshot={snapshot} />}

          {activeTab === 'physics' && snapshot.physics && (
            <PhysicsDebugTab
              physics={snapshot.physics}
              physicsBodyFilter={physicsBodyFilter}
              deferredPhysicsBodyFilter={deferredPhysicsBodyFilter}
              selectedPhysicsBodyId={selectedPhysicsBodyId}
              onChangeFilter={setPhysicsBodyFilter}
              onSelectBody={setSelectedPhysicsBodyId}
            />
          )}

          {activeTab === 'enemy_ai' && (
            <EnemyAiDebugTab
              enemies={snapshot.enemies}
              enemyFilter={enemyFilter}
              deferredEnemyFilter={deferredEnemyFilter}
              selectedEnemyId={selectedEnemyId}
              onChangeFilter={setEnemyFilter}
              onSelectEnemy={setSelectedEnemyId}
            />
          )}

          {activeTab === 'squad' && (
            <SquadDebugTab coordinator={snapshot.coordinator} metrics={snapshot.metrics} />
          )}

          {activeTab === 'combat' && (
            <CombatDebugTab metrics={snapshot.metrics} recentDamages={snapshot.recentDamages} />
          )}

          {activeTab === 'ballistics' && (
            <BallisticsDebugTab
              ballisticsStats={snapshot.ballisticsStats}
              metrics={snapshot.metrics}
              recentShots={snapshot.recentShots}
              selectedShotId={selectedShotId}
              onSelectShot={setSelectedShotId}
            />
          )}

          {activeTab === 'movement' && (
            <MovementDebugTab playerMovement={snapshot.playerMovement} />
          )}

          {activeTab === 'flight' && (
            <FlightDebugTab flightSamples={snapshot.flightSamples} metrics={snapshot.metrics} />
          )}

          {activeTab === 'explosives' && (
            <ExplosivesDebugTab
              ordnanceSummary={snapshot.ordnanceSummary}
              recentExplosions={snapshot.recentExplosions}
              recentDestructions={snapshot.recentDestructions}
            />
          )}

          {activeTab === 'performance' && (
            <PerformanceDebugTab performance={snapshot.performance} />
          )}

          {activeTab === 'resources' && <ResourcesDebugTab resources={snapshot.resources} />}

          {activeTab === 'timeline' && (
            <TimelineDebugTab
              activeEvents={activeEvents}
              filteredEvents={filteredEvents}
              eventFilter={eventFilter}
              timelinePaused={timelinePaused}
              onChangeFilter={setEventFilter}
              onTogglePause={handleTogglePauseTimeline}
            />
          )}

          {activeTab === 'warnings' && <WarningsDebugTab warnings={snapshot.warnings} />}

          {activeTab === 'export' && (
            <ExportDebugTab
              snapshot={snapshot}
              baselineSnapshot={baselineSnapshot}
              baselineError={baselineError}
              comparisonRows={comparisonRows}
              onCaptureBaseline={handleCaptureBaseline}
              onUploadBaseline={handleUploadBaseline}
              onClearBaseline={handleClearBaseline}
            />
          )}
        </div>
      )}
    </aside>
  );
}
