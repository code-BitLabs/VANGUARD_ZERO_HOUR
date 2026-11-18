# VANGUARD: ZERO HOUR — V1 IMPROVEMENT & TRANSFORMATION ROADMAP

**Roadmap Date:** 2026-11-15 (Final Implementation Readiness Gate)  
**Companion Document:** `docs/V1-PRODUCTION-READINESS-AUDIT.md`  
**Objective:** Preserve VANGUARD: ZERO HOUR's verified V1 engineering baseline (`REP-01`–`REP-16`) and execute a controlled, high-impact transformation into a deeper, visually richer, tactically smarter, and production-grade single-player military FPS without ground-up rewrites or competing sources of truth.

---

## Authoritative Priority Scale & Project Recovery Baseline

### 1. Priority Scale Definition
- **`P0`:** Critical correctness, progression, or core gameplay defect.
- **`P1`:** High-impact gameplay or production-quality improvement.
- **`P2`:** Significant quality, immersion, or performance improvement.
- **`P3`:** Optional polish or lower-impact enhancement.

### 2. Verified Project Recovery Baseline (`/var/tmp/vanguard-v1-recovery-baseline`)
- **Archive:** `/var/tmp/vanguard-v1-recovery-baseline/vanguard-v1-baseline.tar.gz` (`chmod 0444` — local accidental-modification protection, not tamper-proof immutability).
- **Cryptographic Manifest:** `/var/tmp/vanguard-v1-recovery-baseline/MANIFEST.sha256` (`chmod 0444`, SHA-256 digests of all baseline source, test, config, and documentation files).
- **Restore & Verification Commands:**
  - Verify working-tree integrity against baseline: `sha256sum -c /var/tmp/vanguard-v1-recovery-baseline/MANIFEST.sha256`
  - Clean staged rollback (removing any extra files introduced after baseline, preserving `node_modules/`):
    1. `rm -rf /tmp/vanguard-stage && mkdir -p /tmp/vanguard-stage && tar -xzf /var/tmp/vanguard-v1-recovery-baseline/vanguard-v1-baseline.tar.gz -C /tmp/vanguard-stage`
    2. `(cd /tmp/vanguard-stage && sha256sum -c /var/tmp/vanguard-v1-recovery-baseline/MANIFEST.sha256)`
    3. Remove any files in `/app/applet/{src,e2e,docs}` or root config files absent from `MANIFEST.sha256`, extract/sync from `/tmp/vanguard-stage`, then run `sha256sum -c /var/tmp/vanguard-v1-recovery-baseline/MANIFEST.sha256` in `/app/applet`.

---

# PART I — COMPLETED V1 REPAIR BACKLOG (`REP-01`–`REP-16`)

## 1. Completed V1 Backlog Summary (`P0` / `P1` / `P2` / `P3`)

| ID | Priority | Category | Title | Target Files | Status |
|---|---|---|---|---|---|
| **REP-01** | **P0** | Gameplay / Visual | Fix weapon view-model slide/bolt recoil spring return (`slideRestZ`) | `src/gameplay/WeaponSystem.ts`, `WeaponViewModels.ts` | **`COMPLETED & VERIFIED`** |
| **REP-02** | **P0** | Gameplay / Feel | Restore `sprintToFireSec` weapon handling delay when exiting sprint | `src/gameplay/WeaponSystem.ts` | **`COMPLETED & VERIFIED`** |
| **REP-03** | **P0** | Performance / GC | Eliminate unconditional 60Hz `getDebugInspectorRows()` allocations when Developer Mode is disabled | `src/engine/GameEngine.ts` | **`COMPLETED & VERIFIED`** |
| **REP-04** | **P0** | Memory / Physics | Stop idle per-frame Rapier WASM stepping/collider duplication and dispose `bvhGeometries` on `PhysicsWorld.clear()` | `src/engine/physics/PhysicsWorld.ts` | **`COMPLETED & VERIFIED`** |
| **REP-05** | **P1** | Memory / GC | Eliminate per-shot `THREE.Vector3.clone()` allocations and 60Hz spread-array allocations in `WeaponSystem` & `GameEngine` | `src/gameplay/WeaponSystem.ts`, `src/engine/GameEngine.ts` | **`COMPLETED & VERIFIED`** |
| **REP-06** | **P1** | Visual / Rendering | Add procedural `bumpMap` micro-surface relief to `AssetManager.getSharedMaterial()` | `src/core/AssetManager.ts` | **`COMPLETED & VERIFIED`** |
| **REP-07** | **P1** | Audio / Immersion | Restrict random pitch jitter in `AudioManager` to organic combat/footstep sounds while keeping tactical UI/lock cues at `1.0` | `src/audio/AudioManager.ts` | **`COMPLETED & VERIFIED`** |
| **REP-08** | **P2** | Rendering / Shadows | Follow player position with texel-snapped directional shadow frustum in `LightingRig` | `src/world/LightingRig.ts`, `src/engine/GameEngine.ts` | **`COMPLETED & VERIFIED`** |
| **REP-09** | **P2** | Bundle / Audio | Remove unused `howler` dependency (`36.46 kB`) and rely exclusively on native `AudioContext` | `package.json`, `src/audio/AudioManager.ts` | **`COMPLETED & VERIFIED`** |
| **REP-10** | **P3** | Maintainability | Extract procedural mesh rig builders (`EnemyRigBuilder`, `VehicleRigBuilder`, `AirRigBuilder`) out of manager classes | `src/world/rigs/*`, manager classes | **`COMPLETED & VERIFIED`** |
| **REP-11 (`FND-14`)** | **P0** | Input / Movement | Repair left/right directional movement (`"Left right kaj kore na, movement problem."`): immediate 8-way joystick response inside `1.45×` ring, deduplicated `TouchEvent` edge-swipe recovery, `ArrowKey` + non-QWERTY support, diagonal sprint (`W+A`/`W+D`), and lateral slide steering | `src/engine/InputManager.ts`, `src/gameplay/PlayerController.ts`, `src/ui/hud/MobileTouchControls.tsx` | **`COMPLETED & VERIFIED`** |
| **REP-12 (`FND-15`)** | **P0** | Vehicle / HUD | Repair vehicle directional driving (`"Car only forward jai."`): unified `getVehicleControls()`, PUBG Mobile-inspired Vehicle Driving HUD (`STEER LEFT`/`RIGHT` or `WHEEL`, `GAS`, `BRAKE/REV`, `HANDBRAKE`, `EXIT`), progressive speed-sensitive steering, `160ms` brake-to-reverse hysteresis, Chase Camera heading follow, and Vehicle HUD Editor mode | `src/gameplay/VehicleManager.ts`, `src/gameplay/VehicleCameraRig.ts`, `src/ui/hud/MobileTouchControls.tsx`, `src/ui/components/MobileHudEditorModal.tsx` | **`COMPLETED & VERIFIED`** |
| **REP-13 (`FND-16`)** | **P1** | UX / Objectives | Clearer in-mission tactical directives (`"Mission e kora lagbe eta aro valo kore bola lagbe."`): structured `actionMeta` per objective and platform-matched `NEXT ACTION` HUD directive (`hud-action-directive`) | `src/schemas/mission.schema.ts`, `src/data/missions.ts`, `src/gameplay/MissionDirector.ts`, `src/ui/hud/GameHUD.tsx` | **`COMPLETED & VERIFIED`** |
| **REP-14 (`FND-17`)** | **P1** | UX / Onboarding | Pre-deployment mission briefing (`"Mission start hower age kora lagbe eta add koro."`): versioned `(missionKey, briefingVersion)` persistence, Pre-Deployment Briefing panel (`mission-briefing-panel`), platform controls guide, and `Full Briefing Dossier` modal | `src/stores/missionSelectionStore.ts`, `src/ui/screens/TitleScreen.tsx`, `src/ui/screens/CampaignScreen.tsx` | **`COMPLETED & VERIFIED`** |
| **REP-15 (`FND-18`)** | **P1** | Gameplay / Sustain | Collectible 3D Heart ❤️ health pickups: 4 map med-stations + single-evaluation enemy drops (`healthDropEvaluated`, max 3 active drops), restoring `+35 HP` up to `100` max within `2.25m` | `src/gameplay/HealthPickupManager.ts`, `src/engine/GameEngine.ts` | **`COMPLETED & VERIFIED`** |
| **REP-16 (`FND-19`)** | **P1** | Weapons / HUD | Slot 7 Bazooka / RPG (`"Can you add Baduka? RPG"`): upgraded `AT-4X / RPG-7V Bazooka` 3D view-model with conical PG-7V warhead, 1-tap `RPG` quick-equip HUD button (`touch-btn-rpg` / `desktop-btn-rpg`), `45 HP` self-damage cap, and wall LOS blast occlusion | `src/data/weapons.ts`, `src/gameplay/WeaponViewModels.ts`, `src/gameplay/ExplosiveManager.ts`, `src/ui/hud/MobileTouchControls.tsx`, `src/ui/hud/GameHUD.tsx` | **`COMPLETED & VERIFIED`** |

---
---

# PART II — EXISTING PROJECT TRANSFORMATION MASTERPLAN ROADMAP (`TRN-01`–`TRN-11`)

## 2. Reconciled Master Transformation Table (`TRN-01`–`TRN-11`)

Every transformation item has one authoritative identifier, scope, priority (`P0`–`P3`), and implementation stage (`Stage 1`–`Stage 4`):

| ID | Authoritative Title | Priority | Stage | Classification | Target Files | Dependencies |
|---|---|---|---|---|---|---|
| **`TRN-01`** | **Tactical AI Navigation and Cover Intelligence** (`TRN-01A`–`TRN-01F`) — **`COMPLETE & VERIFIED (Stage 1)`** | **P0** | **Stage 1** | `IMPROVE` / `REFACTOR` | `src/workers/navigationCore.ts`, `src/workers/WorkerBridge.ts`, `src/workers/navigation.worker.ts`, `src/gameplay/EnemyManager.ts`, `src/schemas/worker.schema.ts`, `src/world/DestructionSystem.ts`, `src/physics/CollisionWorld.ts`, `src/engine/GameEngine.ts`, `src/tests/tacticalNavigation.test.ts` | Baseline `CollisionWorld` + `SpatialHash` |
| **`TRN-04`** | **Mid-Mission Checkpoints** — **`COMPLETE & VERIFIED (Stage 1)`** | **P0** | **Stage 1** | `IMPROVE` | `src/gameplay/MissionCheckpoint.ts`, `src/gameplay/MissionDirector.ts`, `src/engine/GameEngine.ts`, `src/world/DestructionSystem.ts`, `src/gameplay/WeaponSystem.ts`, `src/gameplay/PlayerController.ts`, `src/engine/EngineLifecycle.ts`, `src/stores/gameSessionStore.ts`, `src/ui/screens/Overlays.tsx`, `src/App.tsx`, `src/tests/missionCheckpoints.test.ts` | Baseline `MissionConfig` (`src/data/missions.ts`) |
| **`TRN-03`** | **Rendering and Vignette** (`EffectComposer` All-Tier Pass) — **`COMPLETE & VERIFIED (Stage 1)`** | **P1** | **Stage 1** | `IMPROVE` | `src/engine/Renderer.ts`, `src/tests/adaptiveGraphicsAndLifecycle.test.ts` | `pmndrs/postprocessing` (installed) |
| **`TRN-05`** | **Player Vaulting and Traversal** — **`COMPLETE & VERIFIED (Stage 2)`** | **P1** | **Stage 2** | `IMPROVE` | `src/engine/physics/CollisionSystem.ts`, `src/engine/physics/PhysicsWorld.ts`, `src/physics/CollisionWorld.ts`, `src/gameplay/PlayerController.ts`, `src/gameplay/WeaponSystem.ts`, `src/ui/hud/GameHUD.tsx`, `src/ui/hud/MobileTouchControls.tsx`, `src/tests/vaultTraversal.test.ts` | `CollisionWorld.hasVerticalCapsuleClearance` |
| **`TRN-06`** | **Weapon and Enemy Animation** — **`COMPLETE & VERIFIED (Stage 2)`** | **P1** | **Stage 2** | `IMPROVE` | `src/gameplay/WeaponSystem.ts`, `src/gameplay/WeaponViewModels.ts`, `src/world/rigs/EnemyRigBuilder.ts`, `src/gameplay/EnemyManager.ts`, `src/effects/VFXPool.ts`, `src/tests/weaponAndEnemyAnimation.test.ts` | `TRN-01` (AI cover states) |
| **`TRN-02`** | **Dependency Hygiene (`TRN-02A`) and `GameEngine` Decomposition (`TRN-02B`)** — **`COMPLETE & VERIFIED (Stage 2)`** | **P2** | **Stage 2** | `REMOVE` / `REFACTOR` | `package.json`, `bun.lock`, `src/engine/GameEngine.ts`, `src/engine/HudSnapshotPublisher.ts`, `src/gameplay/CombatDamageResolver.ts`, `src/tests/stage2And3Batch.test.ts` | `TRN-02A` + `TRN-02B` verified |
| **`TRN-07`** | **PBR Materials and Architectural Detail** — **`COMPLETE & VERIFIED (Stage 3)`** | **P2** | **Stage 3** | `IMPROVE` | `src/core/AssetManager.ts`, `src/world/MapBuilder.ts`, `src/tests/stage2And3Batch.test.ts`, `src/tests/combat.test.ts` | `ResourceManager` scope tracking |
| **`TRN-08`** | **Layered Audio** (4-Layer Synthesis + Shared Impulse Reverb + Stage-Synced Reload Foley + 32-Voice Pool) — **`COMPLETE & VERIFIED (Stage 3)`** | **P2** | **Stage 3** | `IMPROVE` | `src/audio/AudioManager.ts`, `src/gameplay/WeaponSystem.ts`, `src/tests/stage2And3Batch.test.ts` | `TRN-06` (reload choreography hooks) |
| **`TRN-09`** | **Vehicle Suspension and Camera-Specific Response** — **`COMPLETE & VERIFIED (Stage 3)`** | **P2** | **Stage 3** | `IMPROVE` | `src/gameplay/VehicleManager.ts`, `src/world/rigs/VehicleRigBuilder.ts`, `src/gameplay/VehicleCameraRig.ts`, `src/tests/stage2And3Batch.test.ts` | Baseline `REP-12` Vehicle Controls |
| **`TRN-12`** | **Player Survivability, Combat Fairness, Hit Registration & Readability + Tactical Downed / Kill-Cam Recovery** — **`COMPLETE & VERIFIED (Stage 4A)`** | **P0 / P1** | **Stage 4A** | `IMPROVE` | `src/schemas/combat.schema.ts`, `src/gameplay/PlayerController.ts`, `src/gameplay/CombatEngagementCoordinator.ts`, `src/gameplay/EnemyManager.ts`, `src/gameplay/BallisticSolver.ts`, `src/gameplay/CombatTelemetryRecorder.ts`, `src/world/rigs/EnemyRigBuilder.ts`, `src/world/MapBuilder.ts`, `src/engine/GameEngine.ts`, `src/ui/hud/GameHUD.tsx`, `src/ui/screens/Overlays.tsx`, `src/ui/debug/CombatDebugOverlay.tsx`, `src/tests/stage4SurvivabilityAndUx.test.ts` | `CombatEngagementCoordinator` + `BallisticSolver` |
| **`TRN-10`** | **Directional Threat Arcs and Post-Mission Debriefing** — **`COMPLETE & VERIFIED (Stage 4A)`** | **P1** | **Stage 4A** | `IMPROVE` | `src/gameplay/PlayerController.ts`, `src/gameplay/MissionDirector.ts`, `src/ui/hud/GameHUD.tsx`, `src/ui/screens/Overlays.tsx`, `src/ui/screens/CampaignScreen.tsx`, `src/tests/stage4SurvivabilityAndUx.test.ts` | `BallisticSolver` / `EnemyManager` hit events |
| **`TRN-11`** | **Mobile Aim Assistance and Physical Hardware QA** — **`FEATURE COMPLETE & VERIFIED (Stage 4A)`** | **P1** *(Feature)* / **Release Gate** *(Hardware QA)* | **Stage 4A** | `IMPROVE` | `src/schemas/settings.schema.ts`, `src/engine/InputManager.ts`, `src/gameplay/PlayerController.ts`, `src/engine/GameEngine.ts`, `src/ui/components/SettingsPanel.tsx`, `src/tests/stage4SurvivabilityAndUx.test.ts`, `CHECKPOINT.md` | All Stage 1–4A gameplay & visual changes |
| **`TRN-13`** | **Mission Lifecycle & Campaign Reliability** — **`COMPLETE & VERIFIED (Stage 4B)`** | **P0** | **Stage 4B** | `IMPROVE` | `src/engine/EngineLifecycle.ts`, `src/engine/GameEngine.ts`, `src/stores/missionSelectionStore.ts`, `src/ui/screens/CampaignScreen.tsx`, `src/ui/screens/Overlays.tsx`, `src/tests/stage4bCampaignAndProgression.test.ts` | `EngineLifecycle` + `ResourceManager` |
| **`TRN-14`** | **Stage-Gated Objective Progression, Target-Bound Demolition & Three-Tier Tactical Guidance** — **`COMPLETE & VERIFIED (Stage 4B)`** | **P0 / P1** | **Stage 4B** | `IMPROVE` | `src/schemas/mission.schema.ts`, `src/schemas/events.schema.ts`, `src/schemas/settings.schema.ts`, `src/data/missions.ts`, `src/gameplay/MissionDirector.ts`, `src/gameplay/TacticalGuidanceSystem.ts`, `src/gameplay/CombatDamageResolver.ts`, `src/gameplay/ExplosiveManager.ts`, `src/gameplay/MissionCheckpoint.ts`, `src/engine/HudSnapshotPublisher.ts`, `src/ui/hud/GameHUD.tsx`, `src/ui/screens/HowToPlayModal.tsx`, `src/ui/components/SettingsPanel.tsx`, `src/tests/stage4bCampaignAndProgression.test.ts` | `MissionDirector` + `DestructionSystem` |
| **`TRN-15`** | **Vertical Tactical World, Oriented Slopes & Multi-Stop Cargo Lifts** — **`COMPLETE & VERIFIED (Stage 5A)`** | **P0** | **Stage 5A** | `IMPROVE` | `src/physics/OrientedSlope.ts`, `src/engine/physics/CollisionResponseSystem.ts`, `src/engine/physics/PhysicsWorld.ts`, `src/physics/CollisionWorld.ts`, `src/gameplay/CargoLiftManager.ts`, `src/world/VerticalStructuresBuilder.ts`, `src/world/MapBuilder.ts`, `src/tests/stage5VerticalPhysicsAndLifts.test.ts` | `CollisionWorld` + `PhysicsWorld` + `ResourceManager` |
| **`TRN-16`** | **Hierarchical Hybrid Multi-Elevation Navigation & Dual-Buffer Worker IPC** — **`COMPLETE & VERIFIED (Stage 5A)`** | **P0** | **Stage 5A** | `IMPROVE` / `REFACTOR` | `src/navigation/AgentTraversalProfile.ts`, `src/workers/navigationCore.ts`, `src/workers/navigation.worker.ts`, `src/workers/WorkerBridge.ts`, `src/schemas/worker.schema.ts`, `src/tests/stage5MultiLayerNavAndCombat.test.ts` | `TRN-01` + `TRN-15` |
| **`TRN-17`** | **3D Vertical Combat, Anatomical Parapet Cover & Missions 1–5 Integration** — **`COMPLETE & VERIFIED (Stage 5A)`** | **P1** | **Stage 5A** | `IMPROVE` | `src/gameplay/EnemyManager.ts`, `src/gameplay/MissionCheckpoint.ts`, `src/data/missions.ts`, `src/engine/HudSnapshotPublisher.ts`, `src/engine/GameEngine.ts`, `src/ui/hud/GameHUD.tsx`, `src/tests/stage5MultiLayerNavAndCombat.test.ts` | `TRN-15` + `TRN-16` |
| **`TRN-18`** | **Five Mission World Transformations & Structure Reconciliation** — **`COMPLETE & VERIFIED (Stage 5B)`** | **P0** | **Stage 5B** | `IMPROVE` | `src/world/VisualBible.ts`, `src/world/StructureReconciliationRegistry.ts`, `src/world/MapBuilder.ts`, `src/world/VerticalStructuresBuilder.ts`, `src/tests/stage5bVisualAndAssetPipeline.test.ts` | `TRN-15` + `TRN-17` |
| **`TRN-19`** | **Operator Arm IK Rig, Interruptible Animation Graph, 9 ViewModels, 7 Factions & 4 Vehicle Rigs** — **`COMPLETE & VERIFIED (Stage 5B)`** | **P0** | **Stage 5B** | `IMPROVE` | `src/gameplay/OperatorArmRig.ts`, `src/gameplay/FirstPersonAnimationGraph.ts`, `src/gameplay/WeaponViewModels.ts`, `src/world/rigs/EnemyRigBuilder.ts`, `src/world/rigs/VehicleRigBuilder.ts`, `src/tests/stage5bVisualAndAssetPipeline.test.ts` | `TRN-06` + `TRN-09` |
| **`TRN-20`** | **Atmospheric GLSL SkyDome, `TacticalLightBudgetManager`, 60/90/120 Hz Refresh & Pointer-Lock Guard** — **`COMPLETE & VERIFIED (Stage 5B)`** | **P1** | **Stage 5B** | `IMPROVE` | `src/world/LightingRig.ts`, `src/engine/RenderingBenchmarkSlice.ts`, `src/engine/Renderer.ts`, `src/engine/PerformanceGovernor.ts`, `src/engine/InputManager.ts`, `src/engine/GameEngine.ts`, `src/tests/stage5bVisualAndAssetPipeline.test.ts` | `TRN-03` + `TRN-08` |
| **`TRN-21`** | **Context-Adaptive Tactical HUD, `[TAB]` Tactical Overview & Radar Intelligence** — **`COMPLETE & VERIFIED (Stage 5B)`** | **P0** | **Stage 5B** | `IMPROVE` / `REFACTOR` | `src/ui/hud/GameHUD.tsx`, `src/ui/hud/WeaponSilhouette.tsx`, `src/engine/HudSnapshotPublisher.ts`, `src/gameplay/EnemyManager.ts`, `src/stores/uiStore.ts`, `e2e/responsive-and-gameplay.spec.ts` | `TRN-10` + `TRN-14` |
| **`TRN-22`** | **Production Asset Pipeline, 5-Layer Domain Model & `AssetQualityGate`** — **`COMPLETE & VERIFIED (Stage 5B)`** | **P0** | **Stage 5B** | `IMPROVE` | `src/assets/AssetPipeline.ts`, `src/core/AssetManager.ts`, `src/tests/stage5bVisualAndAssetPipeline.test.ts` | `TRN-07` + `ResourceManager` |

---

## 3. Finalized Engineering Specifications (`TRN-01`, `TRN-04`, `TRN-02`)

### 3.1 `TRN-01` (`P0`, Stage 1) — Tactical AI Navigation and Cover Intelligence (Algorithm Safety Finalized)

#### `TRN-01A` — Full Map-Boundary Navigation Grid, Explicit Out-of-Bounds Check & Single-Elevation Scope
- **Grid Coordinate System & Half-Open Bounds (`[-160m, +160m)`):**
  - `originX = -160`, `originZ = -160`, `cellSize = 2.0m`, `gridWidth = 160`, `gridHeight = 160` (`totalCells = 25,600`, covering half-open interval **`x, z ∈ [-160m, +160m)`**: `wx = -160` maps to `cx = 0` in-bounds, `wx = 159.999` maps to `cx = 159` in-bounds, and `wx = 160` maps to `cx = 160`, which is strictly out-of-bounds).
- **Explicit Out-of-Bounds `worldToCellIndex(wx, wz, g)` Function & Boundary Tests:**
  - Instead of silently clamping out-of-bounds world coordinates to border cells, `worldToCellIndex(wx: number, wz: number, g: GridState): number` computes:
    ```ts
    if (!Number.isFinite(wx) || !Number.isFinite(wz)) return -1;
    const cx = Math.floor((wx - g.originX) / g.cellSize);
    const cz = Math.floor((wz - g.originZ) / g.cellSize);
    if (cx < 0 || cx >= g.width || cz < 0 || cz >= g.height) {
      return -1; // Explicit out-of-bounds sentinel
    }
    return cz * g.width + cx;
    ```
  - **Mandatory Boundary Tests:** Unit tests verify `(-160, -160) -> 0`, `(159.99, 159.99) -> 25599`, `(160, 0) -> -1`, `(0, 160) -> -1`, `(-160.01, 0) -> -1`, and `(NaN, 0) -> -1`.
  - **Out-of-Bounds Handling Policy in `computeNextWaypoint`:**
    - If `startIdx === -1` or `goalIdx === -1`, the query is flagged as out-of-bounds (`outWaypoint[0] = tx; outWaypoint[1] = tz; return false`) and the caller records an out-of-bounds diagnostic counter rather than corrupting border cell searches.
- **Single-Elevation Navigation Manifold & Building/Multi-Level Limitations:**
  - The `160 × 160` grid is **intentionally a single-elevation 2D navigation manifold** representing the terrain surface `y = heightFn(x, z)` and ground-floor building interiors.
  - **Enterable Ground-Floor Buildings (`MapBuilder.ts:158–368`):** Ground-floor walls (`[y, y + 4.0m]`), window sills (`[y, y + 1.12m]`), and interior partition walls occupy pedestrian height `[0.48m .. 1.85m]` above ground and are rasterized as `blocked = 1`. Centered front/back doorways (`width <= 2.6m`, overhead lintels starting at `minY = y + doorH >= 2.6m`) and bridge decks (`maxY <= 0.28m`) have zero colliders in `[0.48m .. 1.85m]` and are walkable (`blocked = 0`), allowing AI to enter/exit ground-floor rooms through doorways.
  - **Multi-Level Limitation:** Elevated watchtower platforms (`MapBuilder.ts:404`, `y = 8.8m`) and building roofs have no walkable ramps/stairs and cannot be traversed via the single-elevation grid. Units spawned on watchtower decks remain stationary elevated overwatch units; if multi-story walkable interiors with stairs are added in a future expansion, a multi-layered grid or 3D navmesh will be required.

#### `TRN-01B` — Persistent Worker Memory, One-Indexed Binary Heap (`total + 1`), Iteration Budget (`4,096`) & Exhaustion Recovery
- **Preallocated Persistent Worker Buffers (Zero Per-Query Allocations Across All Buffers):**
  - Allocated once in `navigation.worker.ts` when `init_grid` initializes `total = width * height` (`25,600`):
    - `gScore = new Float32Array(total)`
    - `fScore = new Float32Array(total)`
    - `parent = new Int32Array(total)`
    - `visitedGen = new Uint32Array(total)` (tracks the `currentSearchId` in which a node was discovered)
    - `closedGen = new Uint32Array(total)` (tracks the `currentSearchId` in which a node was closed)
    - `heapNodes = new Int32Array(total + 1)` (**1-indexed binary min-heap of length `25,601`**, valid indices `1 .. 25,600` so pushing all `25,600` cells never overflows index `total`)
    - `heapPos = new Int32Array(total)` (`0 .. 25,599`, stores `1 .. heapSize` position of `nodeIdx` in `heapNodes`)
    - `heapGen = new Uint32Array(total)` (tracks the `currentSearchId` for which `heapPos[nodeIdx]` is active in the open heap)
    - `pathChainScratch = new Int32Array(total)` (preallocated buffer for reconstructing the `[startIdx .. targetNode]` path chain during string-pulling without allocating JS arrays)
    - `outWaypoint = new Float32Array(2)` (reusable 2-float output register `[wx, wz]` copied directly into the batch result `Float32Array`)
    - Module-static neighbor tables:
      `const DIRS_DX = new Int8Array([1, -1, 0, 0, 1, -1, 1, -1]);`
      `const DIRS_DZ = new Int8Array([0, 0, 1, -1, 1, 1, -1, -1]);`
      `const DIRS_COST = new Float32Array([1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2]);`
- **Heap Operations (`heapPush`, `heapPop`, `swapHeap`, `siftUp` / `decreaseKey`, Generation Wraparound Safety):**
  - **Open-Set Membership Predicate:** Node `nIdx` is currently in the open heap iff `heapGen[nIdx] === currentSearchId && heapPos[nIdx] > 0`.
  - **`swapHeap(i, j)` Invariant:** Every swap inside both `siftUp` and `siftDown` updates `heapNodes[i]`, `heapNodes[j]`, AND `heapPos[nodeAtI] = i; heapPos[nodeAtJ] = j`.
  - **`heapPop()` Open-Set Removal:** Pops `top = heapNodes[1]`, clears open-set membership (`heapPos[top] = 0; heapGen[top] = 0`), moves `last = heapNodes[heapSize--]` to `heapNodes[1]` (updating `heapPos[last] = 1` when `heapSize > 0`), and calls `siftDown(1)`.
  - **Generation-Counter Wraparound Reset:** Advancing `currentSearchId = (currentSearchId + 1) >>> 0`; on wraparound (`currentSearchId === 0`), reset all generation arrays safely (`visitedGen.fill(0); closedGen.fill(0); heapGen.fill(0); currentSearchId = 1`).
  - **Duplicate Prevention & `decreaseKey`:**
    - When neighbor `nIdx` has `visitedGen[nIdx] !== currentSearchId`:
      Set `visitedGen[nIdx] = currentSearchId`, `parent[nIdx] = curr`, `gScore[nIdx] = tentativeG`, `fScore[nIdx] = tentativeG + h(nIdx)`. Push `nIdx` via `heapPush(nIdx)` (which checks `if (heapSize < total)` before writing `heapNodes[++heapSize] = nIdx; heapGen[nIdx] = currentSearchId; heapPos[nIdx] = heapSize; siftUp(heapSize)`).
    - When neighbor `nIdx` already has `visitedGen[nIdx] === currentSearchId` and `tentativeG < gScore[nIdx]`:
      Update `parent[nIdx] = curr`, `gScore[nIdx] = tentativeG`, `fScore[nIdx] = tentativeG + h(nIdx)`. If `heapGen[nIdx] === currentSearchId && heapPos[nIdx] > 0`, call `siftUp(heapPos[nIdx])` in place ($O(\log N)$ `decreaseKey`—**never** pushing a duplicate entry into `heapNodes`).
  - **Deterministic Comparator `isHigherPriority(nodeA, nodeB)`:**
    1. `diffF = fScore[nodeA] - fScore[nodeB]`; if `Math.abs(diffF) > 1e-5`, return `diffF < 0`.
    2. `diffG = gScore[nodeA] - gScore[nodeB]`; if `Math.abs(diffG) > 1e-5`, return `diffG > 0` (prefers nodes further along the search frontier toward the goal).
    3. Return `nodeA < nodeB` (strict cell-index determinism).
- **Reassessed Iteration Budget (`maxIter = 4,096`) & Exhaustion / Unreachable Goal Recovery:**
  - On the `160 × 160` (`25,600`-cell) grid, routing across complex barriers or across the `jungle_zone` river channel (`130` cells wide between bridges at `x ∈ {-28, 0, 28}`) requires `800–2,800` node expansions. `maxIter` is set to **`4,096` node expansions per query**.
  - **Measured Stage 1 Benchmark Workload (`src/tests/tacticalNavigation.test.ts`):**
    - Open `160 × 160` path query: **`0.1175 ms/query`** (averaged over 200 queries).
    - Cross-map `jungle_zone` river bridge detour (`(-80, 40) -> (-80, -40)`, **`919` expansions**): **`0.3859 ms/query`** (averaged over 100 queries; `0.42 µs/node`, within `<= 0.50 ms` budget).
    - Sealed unreachable goal partial-path recovery (`4,096` expansions): **`1.8540 ms/query`** (averaged over 25 queries; `0.45 µs/node`).
    - 15-enemy `EnemyManager.update()` combat tick with 3-ray whisker steering + squad separation: **`0.4402 ms/tick`** (averaged over 60 ticks, within `< 1.50 ms` frame budget).
  - **Recovery When Budget Is Exhausted (`iterations === maxIter`) or Goal Is Unreachable (`heapSize === 0`):**
    - During expansion, track `bestHeuristicNode` (initialized to `startIdx`, `bestH = Math.hypot(tcx - scx, tcz - scz)`). Whenever a popped node `curr` has Euclidean distance `dGoal = Math.hypot(tcx - cx, tcz - cz) < bestH - 1e-4` (or `Math.abs(dGoal - bestH) <= 1e-4 && gScore[curr] < gScore[bestHeuristicNode]`), update `bestHeuristicNode = curr; bestH = dGoal`.
    - If `goalIdx` is not reached before `heapSize === 0` or `iterations === maxIter`, reconstruct the path chain in `pathChainScratch` from `bestHeuristicNode` back to `startIdx` and string-pull along that valid reachable partial path—**never** falling back to raw `[tx, tz]` when `bestHeuristicNode !== startIdx` (which would walk the unit directly into the blocking wall or river). Only if `bestHeuristicNode === startIdx` (the start cell itself is completely boxed in) does `computeNextWaypoint` return the start cell center so local whisker steering handles micro-clearance.

#### `TRN-01C` — Incremental Dynamic Obstacle Updates After Destruction
- Add `WorkerBridge.updateCollisionRegion(spatialHash: SpatialHash, minX: number, minZ: number, maxX: number, maxZ: number): void` sending `{ type: 'update_cells', jobId, jobVersion, cellUpdatesBuffer }` (`Uint16Array` of `[cellIndex, blockedFlag]` pairs for the overlapped `[cxMin..cxMax] × [czMin..czMax]` cells) whenever `DestructionSystem` destroys or lowers a collider below `0.48m`.

#### `TRN-01D` — LOS-Verified Cover Selection & Squad Cover Ownership
- `EnemyManager.findTacticalCover()` computes the leeward offset (`1.1m` behind the cover node away from `threatPos`), verifies standing clearance via `collision.canStandUp()`, rejects nodes within `2.2m` of any living squadmate's `coverTarget` or `position`, and verifies physical LOS occlusion from `threatPos` using `collision.sweptSegmentTest()`.

#### `TRN-01E` — Local Obstacle Avoidance & Tactical Flanking (3-Ray Forward Whisker Fan)
- Moving units cast at most 3 short horizontal rays (`0°` at `2.2m`, `±35°` at `1.6m` at `y + 0.9m` against `PHYSICS_MASKS.CHARACTER_SOLID`) plus wall-normal tangent sliding when `moveRes.hitHorizontal` is true.

#### `TRN-01F` — Zero-Alloc Path Reconstruction & Bresenham LOS String-Pulling
- Reconstruct the cell chain from `targetNode` (`goalIdx` or `bestHeuristicNode`) back to `startIdx` inside preallocated `pathChainScratch: Int32Array(25600)`, then step forward from `startIdx` using integer Bresenham line-of-sight checks (requiring orthogonal neighbor clearance on diagonal steps) to return the furthest directly visible waypoint in `outWaypoint`.

---

### 3.2 `TRN-04` (`P0`, Stage 1) — Mid-Mission Checkpoints (Restoration Policy Finalized)

#### 1. Serializable Checkpoint State & Persistent `MissionAttemptContext`
`MissionAttemptContext` lives outside `MissionDirector` (owned by `GameEngine`) so cumulative attempt time and checkpoint deaths persist cleanly across `MissionDirector` reconstruction during `restartCheckpoint()`, and reset only on fresh mission start / full `restartMission()`:

```ts
export interface MissionAttemptContext {
  missionId: number;
  difficulty: Difficulty;
  cumulativeElapsedSec: number;        // Monotonic across checkpoint deaths; never rolled back on restartCheckpoint()
  checkpointDeathsCount: number;       // 0 at mission start; increments by 1 on each restartCheckpoint()
}

export interface MissionCheckpointSnapshot {
  missionId: number;
  difficulty: Difficulty;
  checkpointSequence: number;          // 0 at mission start; increments on each objective completion
  activeObjectiveIndex: number;        // Index of first incomplete objective in config.objectives
  completedObjectiveIds: string[];     // Immutable list of completed objective IDs at snapshot time
  playerSpawn: { x: number; y: number; z: number; yaw: number };
  healthAtCheckpoint: number;          // Raw player health at snapshot time
  armorAtCheckpoint: number;           // Raw player armor at snapshot time
  activeWeaponId: WeaponId;
  weaponAmmoState: Record<WeaponId, { mag: number; reserve: number }>;
  scoreAtCheckpoint: number;
  killsAtCheckpoint: number;
  headshotsAtCheckpoint: number;
  airKillsAtCheckpoint: number;
}
```

#### 2. Finalized Restoration Policies

1. **Mission Timer Behavior & Completion-Time Records Across Checkpoint Deaths (`MissionAttemptContext`):**
   - `GameEngine` preserves `MissionAttemptContext` (`cumulativeElapsedSec`, `checkpointDeathsCount`) across `MissionDirector` reconstruction during `restartCheckpoint()`, continuously keeping `MissionDirector.elapsedSec` synchronized with `attemptContext.cumulativeElapsedSec` so it is **monotonic and never rolled back**.
   - Each `restartCheckpoint()` increments `attemptContext.checkpointDeathsCount` (`0, 1, 2, ...`).
   - When the mission finishes in victory, `buildSummary()` and `progressionStore.recordMissionResult()` evaluate `parTimeSec` time bonus, `grade` (`S/A/B/C`), and `fastestTimeSec` using the full cumulative `elapsedSec` (including all time spent before checkpoint deaths). A full mission restart (`restartMission()` or fresh `startMission()`) resets `MissionAttemptContext` (`cumulativeElapsedSec = 0`, `checkpointDeathsCount = 0`).
2. **Maximum Health and Armor Restoration Limits:**
   - Restored player health is bounded by:
     `restoredHealth = Math.min(maxHealth, Math.max(75, Math.round(snapshot.healthAtCheckpoint)))` (minimum floor `75 HP`, difficulty-scaled ceiling `150 / 125 / 100 / 100 HP`).
   - Restored player armor is bounded by:
     `restoredArmor = Math.min(maxArmor, Math.max(50, Math.round(snapshot.armorAtCheckpoint)))` (minimum floor `50 Armor`, difficulty-scaled ceiling `150 / 125 / 100 / 75 Armor`).
3. **Ammunition Floors for Mission-Relevant Weapons Only & Unavailable/Locked Weapon Policy:**
   - **Unavailable / Locked Weapons:** During `restoreCheckpointLoadout()`, only weapons present in `WeaponSystem` (`this.weapons.has(id)`) and available to the player are restored; any unavailable or locked weapon ID is ignored and can never be granted or force-equipped.
   - **Mission-Relevant Ammo Floor Scope:** All weapons first restore their exact `snapshot.weaponAmmoState[id]` (`mag` and `reserve`, clamped to `[0, maxMag]` and `[0, maxReserve]`). A minimum reserve floor is then applied **exclusively** to **mission-relevant weapons**:
     1. Weapons explicitly listed in `mission.recommendedLoadout` (`src/data/missions.ts`),
     2. The player's active weapon (`snapshot.activeWeaponId`) and fallback sidearm (`pistol`), and
     3. Anti-armor launchers (`rocket_launcher` and `guided_missile`) **if and only if** at least one remaining incomplete objective has `type === 'air_defense' | 'convoy_intercept' | 'destroy_targets' | 'plant_charge'` or `actionMeta.recommendedSlot === 7 | 8`.
   - For those mission-relevant weapons only, `ammoInMag` is restored to `magSize` and `reserveAmmo` is raised to `Math.max(snapshot.weaponAmmoState[id].reserve, Math.ceil(maxReserve * 0.5))` (or `>= 3` rockets for relevant launchers, capped at `maxReserve`). Non-relevant weapons retain their exact snapshot ammo without free refills.
4. **Safe Validation of Every Mission Checkpoint Spawn Location (`validateSafeCheckpointSpawn`):**
   - Before spawning the player at a stage anchor `(candX, candY, candZ, yaw)`:
     1. Compute terrain height `groundY = collisionWorld.getGroundHeightAt(candX, candZ)`.
     2. Verify capsule standing clearance `collisionWorld.canStandUp(new THREE.Vector3(candX, groundY, candZ), 0.45, 1.75, 'player') === true`.
     3. Verify horizontal separation `>= 8.0m` from every active hostile infantry wave center, hostile vehicle spawn, and intact volatile explosive barrel/tank.
   - If the primary stage coordinate fails any check, deterministically test 8 radial offsets at `r = 2.5m, 5.0m, 7.5m` (`0°, 45°, ..., 315°`) and select the first valid point; if none pass, fall back to `mission.playerSpawn`.
5. **Idempotent Reconstruction & Prevention of Duplicate Rewards, Kills & Completion Events:**
   - On `restartCheckpoint()`, `MissionDirector` restores `score = snapshot.scoreAtCheckpoint`, `kills = snapshot.killsAtCheckpoint`, `headshots = snapshot.headshotsAtCheckpoint`, and `airKills = snapshot.airKillsAtCheckpoint`. Any kills, headshots, or score gained after the checkpoint during the failed attempt are discarded.
   - Pre-completed objectives in `snapshot.completedObjectiveIds` are initialized with `{ completed: true, current: target }` before any world entities are spawned, and their destructible world targets (`radar_relay`, `fuel_tank`, `weapons_cache`, industrial vats) are transitioned via `DestructionSystem.markDestroyedSilently(id)` (which removes their collider and applies the charred mesh state **without** invoking `onObjectiveDestroyed`, `onEnemyKilled`, `showAlert`, or awarding `350` objective bonus points).
   - `progressionStore.recordMissionResult()` is invoked only once when the mission concludes in `victory: true` (or when the player aborts/fails permanently to menu), never during checkpoint restarts.

---

### 3.3 `TRN-02` (`P2`, Stage 2) — Dependency Hygiene (`TRN-02A`) & `GameEngine` Decomposition (`TRN-02B`) (`COMPLETE & VERIFIED`)

1. **`TRN-02A` — Verified Unused Dependency Removal (`COMPLETE & VERIFIED`):**
   - Removed confirmed unused server/AI template packages (`@google/genai@^2.4.0`, `express@^4.21.2`, `@types/express@^4.17.21`, `dotenv@^17.2.3`) from `package.json` (`38 → 35` production dependencies, `10 → 9` `devDependencies`).
   - Updated `bun.lock` cleanly via `bun install` (`-238` lines, `113,294 B → 89,411 B`, removing `google-auth-library`, `protobufjs`, `ws`, `body-parser`, `send`, `serve-static`, and `qs` transitive trees; verified reproducible via `bun install --frozen-lockfile`).
2. **`TRN-02B` — Concrete Ownership Boundaries in `GameEngine.ts` (`COMPLETE & VERIFIED`):**
   - Extracted `HudSnapshotPublisher` (`src/engine/HudSnapshotPublisher.ts`) owning HUD snapshot assembly, radar blips, world-to-screen objective projection, and developer inspector row construction (`getDebugInspectorRows()` gated behind `devActive`).
   - Extracted `CombatDamageResolver` (`src/gameplay/CombatDamageResolver.ts`) owning player/enemy/vehicle/air/destructible damage routing, solid-wall blast occlusion (`CollisionWorld.sweptSegmentTest`), and `45 HP` self-damage cap for Slot 7 `rocket_launcher`.

### 3.4 `TRN-07` (`P2`, Stage 3) — Multi-Channel PBR Materials and Architectural Detail (`COMPLETE & VERIFIED`)
- **Multi-Channel PBR Synthesis (`src/core/AssetManager.ts`):**
  - Synthesizes deterministic seeded `THREE.DataTexture` sets (`albedoMap` in `THREE.SRGBColorSpace`, tangent-space Sobel `normalMap`, spatially varying `roughnessMap`, and `metalnessMap` in `THREE.NoColorSpace`) for all 8 surface profiles (`concrete`, `asphalt`, `sand`, `jungle_ground`, `metal_plate`, `warning_stripe`, `crate_wood`, `weathered_structural`).
  - Quality-tier resolution scaling (`512×512` on `high`/`ultra` = `42.67 MiB`, `256×256` on `medium` = `10.67 MiB`, `128×128` on `low` = `2.67 MiB`, strictly `< 45 MiB` GPU budget) with optional external texture loader fallback (`loadExternalPbrOverride`).
- **Architectural Building Detailing (`src/world/MapBuilder.ts`):**
  - Added shared-geometry doorway jambs (`door_frame_jamb`), structural headers (`door_header_beam`), window mullions (`window_mullion`), window lintels (`window_header`), roof cornices (`roof_cornice`), story cornice bands (`story_cornice_band`), interior baseboards (`interior_baseboard`), corner pilasters (`corner_pilaster`), and interior columns (`structural_column`) to `buildEnterableBuildingMesh()` while preserving full doorway and vault clearances.

### 3.5 `TRN-08` (`P2`, Stage 3) — Hybrid Layered Tactical Audio (`COMPLETE & VERIFIED`)
- **4-Layer Synthesis + Shared Impulse Reverb + 32-Voice Priority Pool (`src/audio/AudioManager.ts`):**
  - Synthesizes 4-layer stereo weapon/ordnance buffers (high-frequency mechanical transient, mid-frequency muzzle body, low-frequency sub-bass punch, and stereo environmental tail) routed through a shared procedural `ConvolverNode` impulse reverb bus with distance attenuation (`120m` combat / `180m` ordnance) and a 32-voice deterministic priority pool (`combat_spatial <= 8`, `reload_foley <= 2`).
- **Stage-Synchronized Reload Foley (`src/gameplay/WeaponSystem.ts`):**
  - Synchronized `playReloadFoley()` cues (`mag_out`, `mag_in`, `chamber`, `bolt_cycle`, `pump_cycle`, `drum_index`) to authoritative reload stages (`MAG_OUT`, `MAG_IN`, `CHAMBER`) and post-shot cycling, with immediate `cancelReloadFoley()` cutoff on weapon switch, vehicle entry, player death, or mission reset.

### 3.6 `TRN-09` (`P2`, Stage 3) — Vehicle Suspension and Camera-Specific Response (`COMPLETE & VERIFIED`)
- **Articulated 3D Vehicle Rig (`src/world/rigs/VehicleRigBuilder.ts`) & Sub-Stepped Spring-Damper Solver (`src/gameplay/VehicleManager.ts`):**
  - Separated `chassisGroup` (sprung hull, cabin, interior, roof turret) from unsprung `wheels` (`4` on `jeep`/`truck`/`technical`, `6` on `enemy_apc`) and `suspensionStruts`.
  - Fixed sub-step (`<= 1/120s`) spring-damper integration (`updateVehicleSuspension`) simulates acceleration squat, braking nose-dive, cornering roll, vertical heave, and wheel terrain contact compression while keeping `meshRoot` and turret ballistic raycasts anchored to the un-tilted authoritative vehicle frame.
- **Perspective-Specific Camera Filtering (`src/gameplay/VehicleCameraRig.ts`):**
  - `driver_fpv` applies horizon-stabilized, heavily damped suspension feedback (`pitch <= ±0.045 rad`, `roll <= ±0.038 rad`, `heave <= ±0.055m`) anchored to the un-tilted cabin seat to prevent motion sickness and cabin clipping; `chase`/`orbit` smoothly tracks the vehicle while showcasing full 3D chassis articulation.

### 3.7 `TRN-12`, `TRN-10`, `TRN-11` (`P0`/`P1`, Stage 4A) — Survivability, Combat Fairness, Tactical Recovery, Threat Arcs, Debriefing & Mobile Aim Assist (`COMPLETE & VERIFIED`)
- **Survivability & Difficulty Tuning (`TRN-12`):**
  - Balanced 4-tier difficulty combat table (`Easy: 150/150 HP/Armor, 85% absorption, 6.0s spawn grace, 14 HP/s regen to 100 after 3.2s`; `Normal: 125/125 HP/Armor, 78% absorption, 4.5s spawn grace, 11 HP/s regen to 85 after 4.0s`; `Hard: 100/100 HP/Armor, 68% absorption, 2.5s spawn grace, 8 HP/s regen to 65 after 5.0s`; `Extreme: 100/75 HP/Armor, 55% absorption, 1.5s spawn grace, 6 HP/s regen to 50 after 6.5s`).
  - Added starter concrete cover barriers ahead of player spawn across all 5 missions (`MapBuilder.ts`), sniper/rocket windup telegraphing (`1.4s / 1.0s / 0.65s / 0.4s`) with 3D laser sight + HUD warning banner, contiguous 3-zone enemy hitboxes (`0..0.75m`, `0.75..1.45m`, head sphere at `1.65m`) scaled by difficulty `enemyHitboxScale` (`1.12× / 1.08× / 1.0×`), and a ~`2.4s` tactical downed/kill-cam transition with fatal attacker breakdown.
- **Directional Threat Arcs & Debriefing (`TRN-10`):**
  - Player-local forward/right dot-product projection (`computeRelativeThreatAngle`) drives HUD directional incoming-damage threat arcs, and post-mission debriefing (`MissionDirector.buildSummary`, `Overlays.tsx`, `CampaignScreen.tsx`) calculates and persists deterministic `S / A / B / C` ranks, fastest completion time, accuracy %, headshot %, death count, and damage received.
- **Mobile Rotational-Friction Aim Assist (`TRN-11`):**
  - Optional user-configurable mobile touch aim assistance (`mobileAimAssist` toggle + `mobileAimAssistStrength` `0.10–0.75` slider in `SettingsPanel.tsx`) dampens touch look sensitivity (`0.55×–1.0×`) when the reticle crosses a visible (LOS-verified) hostile target without camera snapping or affecting desktop mouse input.

### 3.8 `TRN-13` & `TRN-14` (`P0`/`P1`, Stage 4B) — Mission Lifecycle Reliability, Stage-Gated Objective Director, Target-Bound Demolition & Three-Tier Tactical Guidance (`COMPLETE & VERIFIED`)
- **Mission Lifecycle Integrity (`TRN-13`):**
  - Hardened `EngineLifecycle.ts` so `SELECT_MISSION` transitions cleanly from `boot`, `menu`, `preloading`, `initializingWorld`, `gameover`, `victory`, and `error` states, eliminating dropped transitions across consecutive mission restarts, checkpoint retries, difficulty switches, and debrief continuations.
- **Stage-Gated Objective Progression with Retroactive Credit (`TRN-14` — Decision 1):**
  - Structured all 5 missions (`src/data/missions.ts`) into sequential tactical stages (`stageIndex`, `stageTitle`, `prerequisiteIds`) with deterministic objective states (`'locked' | 'available' | 'active' | 'completed' | 'bypassed' | 'failed' | 'blocked'`).
  - Destroying a later-stage target early (e.g., an AA radar relay or fuel tank before Stage 1 completes) is recorded in `MissionDirector.retroactiveCreditedObjectiveIds` (`getRetroactiveCreditedObjectiveIds()`, `getNeutralizedTargetIds()`) and automatically resolves the later stage upon stage advancement without stranding the player.
- **Target-Bound Demolition Validation (`TRN-14` — Decision 2):**
  - Separated physical target destruction (`DestructionSystem`) from mission-action validation (`MissionDirector`) for `plant_charge` objectives (`demolitionPolicy: 'charge_or_c4_only'`, Mission 4's `obj_jungle_cache`).
  - Deliberate `[E]` charge placement (`onChargePlanted`) or placed `C4` detonated within `6.5m` (`cause === 'c4'`) marks the objective `'completed'` with full `+400` bonus points.
  - Destroying a `weapons_cache` with RPGs, grenades, air strikes, vehicle weapons, or gunfire (`cause === 'weapon' | 'explosion'`) marks the demolition objective `'bypassed'` (`bypassed: true`), awards reduced salvage points (`+125`), and emits a Command radio warning (`'uncalibrated blast'`) so the player is never asked to plant a charge on a destroyed target.
- **Extraction Prerequisite Lock & Anti-Stall Wave Progression (`TRN-14.4` & `TRN-14.5`):**
  - Entering the extraction zone while mandatory stages remain incomplete returns `extractionStatus = 'locked'` and displays `extractionBlockReason` plus a Tier 2 radio subtitle.
  - `evaluateWaveProgression()` prevents wave-kill deadlocks by immediately triggering reinforcements (`waveStatusText: 'REINFORCEMENTS DEPLOYING (+N) ...'`) when alive enemies drop below remaining required wave kills or when stragglers stall `>10s`.
- **Three-Tier Military Tactical Guidance System (`TacticalGuidanceSystem.ts` — Decision 3):**
  - **Tier 1:** Non-blocking HUD hints (`RELOAD`, `FIND COVER`, `DEMOLITION ZONE`, `EXTRACTION LOCKED`, `AIR THREAT ACTIVE`) with priority (`critical` > `tactical` > `onboarding`), cooldowns, deduplication, dismissal persistence (`missionSelectionStore`), and intense-combat suppression.
  - **Tier 2:** Short, deduplicated radio subtitles for stage transitions, incoming reinforcements, extraction blocks, and demolition bypass events.
  - **Tier 3:** Optional field-manual mechanic cards (`TIER3_MECHANIC_CARDS`) in `HowToPlayModal.tsx`, plus Settings toggles for `Contextual Tactical HUD Hints` and `Tactical Radio Subtitles`.

### 3.9 `TRN-15`, `TRN-16`, `TRN-17` (`P0`/`P1`, Stage 5A) — Vertical Tactical World, Hierarchical Multi-Elevation Navigation & Vertical Combat (`COMPLETE & VERIFIED`)
- **Vertical Physics, Oriented Slopes & Multi-Stop Cargo Lifts (`TRN-15`):**
  - Replaced axis-bound ramps with `OrientedSlopeRegion` (`src/physics/OrientedSlope.ts`) supporting arbitrary compass headings (`0°`, `45°`, `90°`, `180°`), reference-elevation surface sampling (`CollisionWorld.getGroundHeightAt(x, z, referenceFeetY)`), and headroom/ceiling clamping (`CollisionSystem.resolveCharacterCapsule`).
  - Implemented `CargoLiftManager` (`src/gameplay/CargoLiftManager.ts`) with generalized multi-floor stops, an 8-state FSM (`idle_at_floor`, `requested`, `doors_closing`, `traveling`, `doors_opening`, `blocked`, `disabled`, `resetting`), unambiguous capacity (`1` player + `2` AI concurrent riders), fixed-step platform displacement carry, swept shaft ceiling/gate clamping, `[E]` boarding and floor cycling, and safe checkpoint normalization.
  - Built multi-story walkable buildings, exterior switchback stairs, elevated catwalks, watchtowers, and lifts across Missions 1–5 (`VerticalStructuresBuilder.ts`, `MapBuilder.ts`), caching shared `three-mesh-bvh` geometry bounds trees cleanly.
- **Hierarchical Hybrid Multi-Elevation Navigation (`TRN-16`):**
  - Preserved the `160×160` (`25,600`-cell) ground grid (`Surface 0`) and added sparse bounded elevated navigation surfaces linked via typed directional/bidirectional portals (`ramp`, `stair`, `cargo_lift`, `bridge`) in `navigationCore.ts`, with 4 capability profiles (`AgentTraversalProfile.ts`), dynamic lift-wait portal rerouting, and dual-buffer `Float32Array` + `Int32Array` worker IPC (`WorkerBridge.ts`, `worker.schema.ts`).
  - Measured benchmark: `groundBytes = 25,600`, `elevatedBytes = 900` (**`98.2%` memory saved vs duplicate full `160×160` grids**), `portalBytes = 1,424`, `avgMultiLayerQuery = 0.1027ms`.
- **3D Vertical Combat & Campaign Missions 1–5 Rollout (`TRN-17`):**
  - Extended `EnemyManager.findTacticalCover()` with 3D anatomical crouch-vs-standing ray verification (chest `0.72m`, crouch head `1.08m`, stand head `1.58m`) against rooftop parapets and elevated cover, added elevated enemy wave spawns across Missions 1–5 (`missions.ts`, `GameEngine.ts`), added elevation delta HUD objective badges (`▲+XM` / `▼XM`) + `hud-lift-status` (`HudSnapshotPublisher.ts`, `GameHUD.tsx`), and added multi-floor spawn safety to `MissionCheckpoint.ts`.

### 3.10 `TRN-18` through `TRN-22` (`P0`/`P1`, Stage 5B) — AAA Visual Experience, Hybrid Asset Pipeline, Articulated First-Person Rig & Context-Adaptive HUD (`COMPLETE & VERIFIED`)
- **World Visual Transformation & Structure Reconciliation (`TRN-18`):** `VisualBible.ts` defines distinct palettes, fog, sky gradients, and architectural standards across Missions 1–5, while `StructureReconciliationRegistry.ts` preserves authoritative Stage 5A collision/navigation elevations including `+9.0m` watchtowers across `MapBuilder.ts` and `VerticalStructuresBuilder.ts`.
- **Operator Arm IK Rig, Interruptible Animation Graph, Factions & Vehicles (`TRN-19`):** `OperatorArmRig.ts` (2-bone shoulder/elbow/wrist IK + 10 articulated fingers) drives `FirstPersonAnimationGraph.ts` (interruptible equip/reload/fire/ADS/sprint/vault state machine + optic configs) across all 9 weapon viewmodels (`slideRestZ === -0.14`), alongside 7 enemy faction silhouettes (`EnemyRigBuilder.ts`) and 4 multi-part vehicle rigs (`VehicleRigBuilder.ts`).
- **Atmospheric Rendering, Lighting Budgets & Camera Stability (`TRN-20`):** GLSL Rayleigh/Mie `skyDome` (`LightingRig.ts`) renders across all graphics presets (`camera.far >= 520` in `Renderer.ts`), governed by `TacticalLightBudgetManager` (`RenderingBenchmarkSlice.ts`), 60/90/120 Hz display budget scaling (`PerformanceGovernor.ts`), immediate Frame 0 `syncCamera()` alignment (`GameEngine.ts`), and Chromium pointer-lock cursor-warp spike rejection (`InputManager.ts`).
- **Context-Adaptive Tactical HUD & Radar Intelligence (`TRN-21`):** `GameHUD.tsx` and `WeaponSilhouette.tsx` deliver non-overlapping top-bar telemetry on Desktop (`1920×1080` / `1280×720`) and Mobile Landscape (`844×390`), non-pausing `[TAB]` Tactical Overview (`uiStore.ts`), preserved `[N] TRIDENT-X`, LOS/stale/elevation radar blips (`EnemyManager.ts`), and zero `backdrop-filter` over the active 3D scene.
- **Production Asset Pipeline (`TRN-22`):** `AssetPipeline.ts` establishes the 5-layer domain model across `32` canonical asset definitions with provenance/license metadata, content-addressed hashing, build-time compression selection, and `AssetQualityGate.validateCatalog()`.

---

## 4. Measurable Gameplay Acceptance Criteria & Practical Playtest Plan

### 4.1 Player-Experience Acceptance Criteria
| Area | Measurable Gameplay & Player-Experience Outcome |
|---|---|
| **1. Cover Intelligence (`TRN-01D` & `TRN-17`)** | Under player fire (`REPOSITIONING` / `RETREATING`), `>= 90%` of enemies that select a cover target move to the leeward side of a solid collider that physically blocks player LOS (`collision.sweptSegmentTest` confirms occlusion across chest/crouch-head/stand-head zones), and two squadmates never claim cover within `2.2m` of each other. |
| **2. Flanking, Multi-Elevation Traversal & Obstacle Pathing (`TRN-01`, `TRN-15`, `TRN-16`)** | Infantry units climb switchback stairs, ramps, and multi-stop cargo lifts across elevated surfaces (`98.2%` sparse memory savings vs duplicate grids, `0.1027 ms` avg query), respect agent traversal capabilities, and reroute dynamically when lifts are congested or disabled. |
| **3. Checkpoint Recovery (`TRN-04` & `TRN-17`)** | Dying after completing Objective 1, 2, or 3 resumes at a validated safe ground or multi-floor spawn (`floorLayer` + `canStandUp` clearance) with normalized cargo lifts, `[75..maxHealth] HP`, `[50..maxArmor] Armor`, mission-relevant ammo floor, monotonic `elapsedSec` timer, and zero duplicated score/kills/XP. |
| **4. Survivability, Fairness & Debrief (`TRN-12`, `TRN-10`, `TRN-11`)** | Player spawn protection (`6.0s–1.5s`), starter cover barriers, sniper/rocket telegraph windup (`1.4s–0.4s`), contiguous 3-zone enemy hitboxes, ~`2.4s` tactical downed/kill-cam breakdown, deterministic `S/A/B/C` debrief ranking, and LOS-verified touch aim friction verified across 24 Vitest suites (`175` tests) and 8 Playwright E2E tests. |
| **5. Stage-Gated Progression, Demolition Validation & Guidance (`TRN-13`, `TRN-14`)** | Sequential stage unlocking with retroactive early-kill credit, target-bound `plant_charge` validation (`[E]`/`C4` = `completed` vs RPG/gunfire = `bypassed`), extraction prerequisite lock feedback, anti-stall reinforcement waves, and 3-tier tactical HUD/radio/manual guidance verified in `stage4bCampaignAndProgression.test.ts`. |
| **6. Visual, Atmospheric, Asset Pipeline & HUD Quality (`TRN-03`, `TRN-07`–`TRN-09`, `TRN-18`–`TRN-22`)** | `VignetteEffect` and GLSL atmospheric `skyDome` remain active across all quality tiers (`camera.far >= 520`); `32` canonical assets pass `AssetQualityGate.validateCatalog()`; context-adaptive HUD maintains zero top-bar overlap on desktop and `844×390` mobile landscape with non-pausing `[TAB]` overview and zero `ResourceManager` leaks across all 5 missions. |

---

## 5. Historical Stage 5 Architectural Design Baseline (Superseded & Implemented by Stage 5A Above)

> **Status Note:** Section 5 below is retained for design provenance; Stage 5A (`TRN-15`, `TRN-16`, `TRN-17`) upgraded the initial 2-layer proposal into the generalized arbitrary-floor sparse-surface + portal-graph + multi-stop `CargoLiftManager` architecture implemented and verified in Section 3.9 above.

### 5.1 Current Single-Elevation Constraints (Source-Verified)
1. **Building Geometry & Colliders (`src/world/MapBuilder.ts:158–368`):**
   - `buildEnterableBuildingMesh()` constructs ground-floor perimeter walls (`[y, y + 4.0m]`), doorway openings (`2.6m` wide × `2.6m` high), window sills (`1.12m`), and a solid overhead roof slab (`[y + 3.85m, y + 4.15m]`), even when visual `stories >= 2`. There are currently no interior floor slabs at `y + 4.0m`, stairwell ceiling openings, or walkable stair/ramp colliders connecting ground level to upper stories or rooftops.
2. **Capsule Controller (`src/engine/physics/CollisionSystem.ts`):**
   - `resolveCharacterCapsule()` supports step-up heights up to `0.45m` and `TerrainSlopeRegion` ramps, plus `0.46m–1.15m` vaulting (`TRN-05`), and clamps upward movement against any ceiling collider (`box.minY` above capsule feet).
3. **2D Single-Manifold Navigation Worker (`src/workers/navigationCore.ts`, `src/workers/WorkerBridge.ts`):**
   - `uploadCollisionGrid()` samples `SpatialHash` in a single pedestrian vertical slice `[groundY + 0.48m .. groundY + 1.85m]` across `160 × 160` cells (`25,600` cells). Elevated watchtowers (`y = 8.8m`) and rooftops have no representation in the 2D grid.

### 5.2 Proposed Stage 5 Architecture (Multi-Layer Linked Navigation + Analytical Stair Volumes)

| Subsystem | Proposed Stage 5 Design | Performance & Memory Impact |
|---|---|---|
| **1. Walkable Stairs, Ramps & Roof Cutouts (`MapBuilder.ts`, `CollisionSystem.ts`)** | Extend `buildEnterableBuildingMesh()` for `stories >= 2` with: (a) a split second-floor/roof slab leaving a `2.8m × 4.6m` stairwell opening (`ceiling cutout`) so `resolveCharacterCapsule` does not bonk the player's head while ascending; (b) an analytical `TerrainSlopeRegion` + visual stepped stair flight (`slope <= 32°`, width `2.2m`) connecting `Layer 0` (`y = 0m`) to `Layer 1` (`y = 4.0m`); and (c) perimeter rooftop parapet walls (`0.95m` tall, vaultable via `TRN-05` and usable as crouch cover). | `+12–18` static `SpatialAABB` colliders and `1` `TerrainSlopeRegion` per multi-story building (`< 0.03ms` narrowphase impact). |
| **2. 2-Layer Linked Navigation Grid (`navigationCore.ts`, `navigation.worker.ts`)** | Upgrade the navigation grid from `1 × 25,600` to **`2 × 25,600` (`51,200` total cells: `Layer 0` Ground + `Layer 1` Upper Floor/Roof at `y = groundY + 4.0m`)** connected by explicit bidirectional **`PortalLink`s** (`stairBottomCellIdx <-> stairTopCellIdx`, traversal cost `3.2`). A* expands 8 planar neighbors on the current layer plus any registered `PortalLink` at `curr`, with 3D heuristic $h(n) = \hypot(\Delta x, \Delta z) + 2.5 \cdot |\Delta \text{layer}|$. | Preallocated worker typed arrays double from `~360 KB` to **`~720 KB`** (`heapNodes = Int32Array(51201)`); worst-case query latency stays **`< 0.65ms`**. |
| **3. Elevation-Aware LOS, Cover & Threat Selection (`EnemyManager.ts`, `BallisticSolver.ts`)** | Extend `findTacticalCover()` to reject cover nodes where vertical threat elevation angle $\arctan2(threatY - nodeY, \text{distXZ}) > 22^\circ$ unless overhead roof/lintel occlusion is confirmed by `collision.sweptSegmentTest()` (preventing ground units from hiding behind low `1.0m` barriers when the player has high-ground rooftop LOS). | Zero additional allocations; 1 extra analytical raycast per candidate cover evaluation (`< 0.02ms`). |
| **4. Multi-Floor Checkpoint & Spawn Safety (`MissionCheckpoint.ts`, `GameEngine.ts`)** | Add `floorLayer: 0 | 1` and explicit `spawnY` to `MissionCheckpointSnapshot.playerSpawn`. `validateSafeCheckpointSpawn()` evaluates capsule standing clearance (`canStandUp`) at the target floor slab `y` rather than projecting solely to `getGroundHeightAt(x, z)`. | Deterministic checkpoint recovery on upper floors and rooftops with zero fall-through bugs. |

