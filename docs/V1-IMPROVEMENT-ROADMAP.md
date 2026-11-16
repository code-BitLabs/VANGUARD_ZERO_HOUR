# VANGUARD: ZERO HOUR — V1 IMPROVEMENT ROADMAP

**Roadmap Date:** 2026-11-15  
**Companion Document:** `docs/V1-PRODUCTION-READINESS-AUDIT.md`  
**Objective:** Make VANGUARD: ZERO HOUR (V1) responsive, visually cohesive, allocation-disciplined, leak-free, and production-ready without scope creep or speculative rewrites.

---

## 1. Prioritized Repair Backlog (`P0` / `P1` / `P2` / `P3`)

| ID | Priority | Category | Title | Target Files | Complexity | Risk |
|---|---|---|---|---|---|---|
| **REP-01** | **P0** | Gameplay / Visual | Fix weapon view-model slide/bolt recoil spring return so the slide never drifts off the receiver | `src/gameplay/WeaponSystem.ts` | Low | Low |
| **REP-02** | **P0** | Gameplay / Feel | Restore `sprintToFireSec` weapon handling delay when exiting sprint | `src/gameplay/WeaponSystem.ts` | Low | Low |
| **REP-03** | **P0** | Performance / GC | Eliminate unconditional 60Hz `getDebugInspectorRows()` allocations when Developer Mode is disabled | `src/engine/GameEngine.ts` | Low | Low |
| **REP-04** | **P0** | Memory / Physics | Stop idle per-frame Rapier WASM stepping/collider duplication and dispose `bvhGeometries` on `PhysicsWorld.clear()` | `src/engine/physics/PhysicsWorld.ts` | Low | Low |
| **REP-05** | **P1** | Memory / GC | Eliminate per-shot `THREE.Vector3.clone()` allocations and 60Hz spread-array allocations in `WeaponSystem` & `GameEngine` | `src/gameplay/WeaponSystem.ts`, `src/engine/GameEngine.ts` | Medium | Low |
| **REP-06** | **P1** | Visual / Rendering | Add procedural `bumpMap` micro-surface relief to `AssetManager.getSharedMaterial()` for concrete, asphalt, sand, wood, and metal | `src/core/AssetManager.ts` | Low | Low |
| **REP-07** | **P1** | Audio / Immersion | Restrict random pitch jitter in `AudioManager` to organic combat/footstep sounds while keeping tactical UI/lock cues pitch-accurate | `src/audio/AudioManager.ts` | Low | Low |
| **REP-08** | **P2** | Rendering / Shadows | Follow player position with texel-snapped directional shadow frustum in `LightingRig` | `src/world/LightingRig.ts`, `src/engine/GameEngine.ts` | Medium | Medium |
| **REP-09** | **P2** | Bundle / Audio | Remove unused `howler` dependency (`36.46 kB`) and rely exclusively on native `AudioContext` | `package.json`, `src/audio/AudioManager.ts` | Low | Low |
| **REP-10** | **P3** | Maintainability | Extract procedural mesh rig builders (`EnemyRigBuilder`, `VehicleRigBuilder`, `AirRigBuilder`) out of manager classes | `src/gameplay/EnemyManager.ts`, `src/gameplay/VehicleManager.ts`, `src/gameplay/AirCombatManager.ts` | Medium | Medium |
| **REP-11 (`FND-14`)** | **P0** | Input / Movement | Repair left/right directional movement (`"Left right kaj kore na, movement problem."`): immediate 8-way joystick response inside `1.45×` ring, deduplicated `TouchEvent` edge-swipe recovery, `ArrowKey` + non-QWERTY support, diagonal sprint (`W+A`/`W+D`), and lateral slide steering | `src/engine/InputManager.ts`, `src/gameplay/PlayerController.ts`, `src/ui/hud/MobileTouchControls.tsx` | Medium | Low |
| **REP-12 (`FND-15`)** | **P0** | Vehicle / HUD | Repair vehicle directional driving (`"Car only forward jai."`): unified `getVehicleControls()`, PUBG Mobile-inspired Vehicle Driving HUD (`STEER LEFT`/`RIGHT` or `WHEEL`, `GAS`, `BRAKE/REV`, `HANDBRAKE`, `EXIT`), speed-sensitive steering with self-centering, brake-to-reverse hysteresis (`160ms` hold), smooth Chase Camera heading follow, and Vehicle HUD Editor mode | `src/gameplay/VehicleManager.ts`, `src/gameplay/VehicleCameraRig.ts`, `src/ui/hud/MobileTouchControls.tsx`, `src/ui/components/MobileHudEditorModal.tsx` | Medium | Low |
| **REP-13 (`FND-16`)** | **P1** | UX / Objectives | Clearer in-mission tactical directives (`"Mission e kora lagbe eta aro valo kore bola lagbe."`): structured `actionMeta` per objective and platform-matched `NEXT ACTION` HUD directive (`hud-action-directive`) | `src/schemas/mission.schema.ts`, `src/data/missions.ts`, `src/gameplay/MissionDirector.ts`, `src/ui/hud/GameHUD.tsx` | Low | Low |
| **REP-14 (`FND-17`)** | **P1** | UX / Onboarding | Pre-deployment mission briefing (`"Mission start hower age kora lagbe eta add koro."`): versioned `(missionKey, briefingVersion)` persistence, Pre-Deployment Briefing panel (`mission-briefing-panel`), platform controls guide, and `Full Briefing Dossier` modal (`mission-briefing-modal`) | `src/stores/missionSelectionStore.ts`, `src/ui/screens/TitleScreen.tsx`, `src/ui/screens/CampaignScreen.tsx` | Low | Low |
| **REP-15 (`FND-18`)** | **P1** | Gameplay / Sustain | Collectible 3D Heart ❤️ health pickups: 4 map med-stations + single-evaluation enemy drops (`healthDropEvaluated`, max 3 active drops), restoring `+35 HP` up to `100` max within `2.25m` with shared `'mission:world'` GPU resource ownership | `src/gameplay/HealthPickupManager.ts`, `src/engine/GameEngine.ts` | Low | Low |
| **REP-16 (`FND-19`)** | **P1** | Weapons / HUD | Slot 7 Bazooka / RPG (`"Can you add Baduka? RPG"`): upgraded `AT-4X / RPG-7V Bazooka` 3D view-model with conical PG-7V warhead, 1-tap `RPG` quick-equip HUD button (`touch-btn-rpg` / `desktop-btn-rpg`), `45 HP` self-damage cap, and wall LOS blast occlusion | `src/data/weapons.ts`, `src/gameplay/WeaponViewModels.ts`, `src/gameplay/ExplosiveManager.ts`, `src/ui/hud/MobileTouchControls.tsx`, `src/ui/hud/GameHUD.tsx` | Low | Low |

---

## 2. Detailed Engineering Specifications Per Backlog Item

### `REP-01` (P0) — Fix Weapon View-Model Slide/Bolt Recoil Return
- **Root Cause:** `src/gameplay/WeaponSystem.ts:697–700` computes `rig.slideOrBolt.position.z + (this.recoilKickZ * 0.5 - rig.slideOrBolt.position.z * 0.0) * 0.1`. Because `rig.slideOrBolt.position.z` is multiplied by `0.0`, the slide never returns toward its rest Z offset and drifts backward indefinitely.
- **Proposed Solution:**
  1. Add `slideRestZ: number` to `ViewModelRig` (`WeaponSystem.ts:27–32`) and populate it with `slideOrBolt ? slideOrBolt.position.z : 0` when building the weapon rig (`WeaponSystem.ts:675`).
  2. In `updateViewModelTransform()` (`WeaponSystem.ts:697–700`), compute target Z as `const targetSlideZ = rig.slideRestZ + this.recoilKickZ * 0.55;` and smoothly damp toward `targetSlideZ` (`rig.slideOrBolt.position.z += (targetSlideZ - rig.slideOrBolt.position.z) * Math.min(1, dt * 28)`).
- **Acceptance Criteria:** Firing 100+ consecutive rounds kicks the slide backward during fire and returns `rig.slideOrBolt.position.z` within `1e-3` of `rig.slideRestZ` once recoil settles.
- **Regression Test:** Unit test in `src/tests/weapons.test.ts` verifying slide/bolt displacement during fire and full return to `slideRestZ` after recovery.

### `REP-02` (P0) — Restore Sprint-to-Fire Weapon Handling Delay
- **Root Cause:** `src/gameplay/WeaponSystem.ts:292–293` sets `this.sprintToFireTimer = 0` unconditionally on every frame instead of triggering `cfg.sprintToFireSec` when `this.wasSprinting && !player.isSprinting`.
- **Proposed Solution:**
  - When `player.isSprinting` is `true`, keep `this.sprintToFireTimer = cfg.sprintToFireSec`.
  - When transitioning from sprinting to non-sprinting (`this.wasSprinting && !player.isSprinting`), set `this.sprintToFireTimer = cfg.sprintToFireSec`.
  - Otherwise, decrement `this.sprintToFireTimer = Math.max(0, this.sprintToFireTimer - dt)`.
- **Acceptance Criteria:** Attempting to fire while sprinting or immediately on the frame sprint ends delays the shot by `cfg.sprintToFireSec` (`0.11s`–`0.30s`), matching each weapon's configured handling profile.
- **Regression Test:** Unit test in `src/tests/weapons.test.ts` verifying sprint-to-fire delay blocks firing until `sprintToFireSec` elapses.

### `REP-03` (P0) — Eliminate Unconditional 60Hz Debug Inspector Row Allocations
- **Root Cause:** `src/engine/GameEngine.ts:1161–1166` calls `getDebugInspectorRows()` on `enemies`, `airCombat`, and `vehicles` on every 60Hz fixed step outside `if (devActive)` just to evaluate `anyEnemyHasLos`.
- **Proposed Solution:**
  - Compute `anyEnemyHasLos` using the existing zero-allocation methods:
    `const anyEnemyHasLos = this.enemies.hasAnyEnemyWithLos() || this.airCombat.hasAnyUnitWithLos() || this.vehicles.hasAnyHostileWithLos();`
  - Only call `getDebugInspectorRows()` inside `if (devActive && this.debugPublishAccum >= publishPeriod)`.
- **Acceptance Criteria:** Zero calls to `getDebugInspectorRows()` during standard gameplay (`devModeEnabled === false`).

### `REP-04` (P0) — Stop Idle Rapier Stepping & Fix BVH Disposal on Mission Reset
- **Root Cause:** `src/engine/physics/PhysicsWorld.ts` steps `rapierWorld.step()` every frame and duplicates static colliders into WASM despite all gameplay queries running against `CollisionSystem` + `SpatialHash`. In addition, `PhysicsWorld.clear()` fails to dispose `this.bvhGeometries`.
- **Proposed Solution:**
  - Remove redundant per-frame `this.rapierWorld.step()` and static collider duplication in `PhysicsWorld.ts` while keeping `CollisionSystem`, `SpatialHash`, and `three-mesh-bvh` authoritative.
  - In `PhysicsWorld.clear()`, iterate `this.bvhGeometries`, call `disposeBoundsTree()` on each geometry, and clear `this.bvhGeometries.length = 0`.
- **Acceptance Criteria:** `PhysicsWorld.clear()` leaves zero retained BVH geometries and zero stale static colliders across repeated mission loads.
- **Regression Test:** Unit test in `src/tests/physics.test.ts` verifying `registerMeshBVH()` and `clear()` properly dispose BVH bounds trees.

### `REP-05` (P1) — Eliminate Per-Shot Vector Clones & 60Hz Spread Arrays
- **Root Cause:** `WeaponSystem.ts` allocates `new THREE.Vector3` via `.clone()` in `getMuzzleWorldPosition()`, `fireShot()`, and `spawnProjectileShot()`. `GameEngine.ts` allocates new arrays via `[...]` on every 60Hz fixed step for `allHitscan`, `lockCandidates`, and `prox`.
- **Proposed Solution:**
  - Use pre-allocated scratch vectors (`_shotDir`, `_endPoint`) in `WeaponSystem.ts`.
  - Reuse pre-allocated array buffers (`_allHitscanBuffer`, `_lockCandidatesBuffer`, `_proxBuffer`) on `GameEngine`.
- **Acceptance Criteria:** Zero `Vector3.clone()` calls in `WeaponSystem.fireShot` and zero spread-array allocations in `GameEngine.onFixedStep`.

### `REP-06` (P1) — Procedural `bumpMap` Surface Micro-Relief
- **Root Cause:** `src/core/AssetManager.ts:129–138` only sets `map` on `MeshStandardMaterial`, causing flat specular highlights across buildings, roads, and props.
- **Proposed Solution:**
  - Attach the procedural canvas texture as both `map` and `bumpMap` with pattern-appropriate `bumpScale` (`0.025` for concrete/asphalt/sand/jungle_ground, `0.015` for metal_plate/crate_wood) so directional sunlight and PMREM environment lighting catch realistic micro-surface grain.
- **Acceptance Criteria:** Shared patterned `MeshStandardMaterial` instances include a valid `bumpMap` and `bumpScale > 0`.

### `REP-07` (P1) — Pitch-Accurate Tactical Audio Cues & Organic Combat Variance
- **Root Cause:** `src/audio/AudioManager.ts:315` applies `playbackRate = 0.96 + Math.random() * 0.08` to all sounds indiscriminately, causing `lock_beep`, `lock_ready`, `c4_beep`, `hit_marker`, and `ui_click` to waver in pitch.
- **Proposed Solution:**
  - Keep deterministic `playbackRate = 1.0` for UI, hit-marker, and lock-on cues (`ui_click`, `hit_marker`, `headshot`, `lock_beep`, `lock_ready`, `c4_beep`, `nuke_siren`), while applying natural pitch variation (`0.94–1.06`) to gunshots, explosions, impacts, and footsteps.
- **Acceptance Criteria:** Tactical UI/lock cues play at exact pitch (`1.0`), while gunshots and footsteps vary naturally.

### `REP-11` (`FND-14`, P0) — Player Movement & Input Reliability (`"Left right kaj kore na, movement problem."`)
- **Root Causes:**
  1. In fixed joystick mode (`touchJoystickMode = 'fixed'`), tapping the left or right side of the visible joystick ring (`dist <= radius * 1.45`) re-centered the origin under the finger (`applyStickPosition(x, y)` with `dx = 0`), producing zero strafe movement unless the player dragged a second time.
  2. Mobile browsers / WebViews near the left edge can emit premature `pointercancel` during horizontal swipes while the physical finger (`Touch.identifier`) remains on glass.
  3. Desktop movement only bound `KeyW/A/S/D` without `ArrowUp/Down/Left/Right` or `e.key` fallback, and `PlayerController` canceled sprint when diagonal strafe exceeded `0.78 * forward`.
- **Implemented Repair:**
  - `MobileTouchControls.tsx` preserves the fixed joystick center for all touches within `1.45×` base radius so tapping left/right on the ring immediately strafes, adds N/S/E/W directional chevrons, and provides a deduplicated `TouchEvent` fallback when a mobile browser cancels the active pointer prematurely.
  - `InputManager.ts` adds `ArrowUp/Down/Left/Right` secondary bindings, `normalizeKeyCode(e)`, `visibilitychange` cleanup, and `onVirtualInputsCleared()` notifications.
  - `PlayerController.ts` supports full diagonal sprinting (`W+A` / `W+D`) and lateral steering while sliding.

### `REP-12` (`FND-15`, P0) — Vehicle Driving HUD, Physics & Chase Camera (`"Car only forward jai."`)
- **Root Causes:**
  1. Mobile HUD kept the infantry analog joystick when boarding a vehicle instead of providing dedicated steering and gas/brake/reverse pedals.
  2. `VehicleManager.ts` gated turning by `Math.min(1, Math.abs(v.speed) / 3.2)` with no progressive wheel angle interpolation (`steerAngle`) and no brake-to-reverse hysteresis state machine.
  3. `VehicleCameraRig.ts` did not smoothly follow vehicle heading in Chase mode when turning without manual camera drag.
- **Implemented Repair:**
  - Added `InputManager.getVehicleControls()` returning normalized `{ gas, brakeReverse, steer, handbrake }`.
  - Built the PUBG Mobile-inspired Vehicle Driving HUD (`mobile-vehicle-hud`) with left-side `STEER LEFT` / `STEER RIGHT` (or optional `WHEEL`), right-side `GAS`, `BRAKE / REV`, and `HANDBRAKE`, upper-right `EXIT`, dismissible First-Time Vehicle Control Hint, and full Vehicle HUD Editor + Left-Handed preset.
  - Upgraded `VehicleManager.ts` with progressive speed-sensitive `steerAngle`, smooth self-centering, front-wheel mesh steering rotation, and a `FORWARD` → `BRAKING` → `NEUTRAL_HOLD` (`160ms` at `<= 0.45 m/s`) → `REVERSE` state machine.
  - Upgraded `VehicleCameraRig.ts` to smoothly align Chase Camera yaw behind the turning vehicle when not manually looking (`1.15s` manual-look hold window).

### `REP-13` & `REP-14` (`FND-16`, `FND-17`, P1) — Pre-Deployment Briefing & Platform-Aware In-Combat Directives
- **Implemented Repair:**
  - Added structured `actionMeta` (`ObjectiveActionMetadataSchema`) and `missionKey` + `briefingVersion: 'v1.2'` + `locationDetail` + `threatSummary` + `requiredActionsSummary` + `extractionConditions` across all 5 missions in `src/data/missions.ts`.
  - Added `MissionDirector.getActiveActionDirective(inputDevice, inVehicle, rpgEquipped)` rendered live in `GameHUD.tsx` (`hud-action-directive`).
  - Added versioned `seenMissionBriefings` tracking in `missionSelectionStore.ts`, Pre-Deployment Mission Briefing panel (`mission-briefing-panel`), platform-matched controls guide (`briefing-controls-guide`), and `Full Briefing Dossier` modal (`mission-briefing-modal`) in `CampaignScreen.tsx`.

### `REP-15` (`FND-18`, P1) — Collectible 3D Heart ❤️ Health Pickups
- **Implemented Repair:**
  - Created `src/gameplay/HealthPickupManager.ts` with shared `'mission:world'` geometries/materials, 4 curated map med-stations per mission, single-evaluation enemy drops (`healthDropEvaluated` guard, max 3 active drops), and `< 2.25m` proximity auto-collect restoring `+35 HP` up to `100` max (never consumed at full health).

### `REP-16` (`FND-19`, P1) — Slot 7 Bazooka / RPG & 1-Tap Quick-Equip (`"Can you add Baduka? RPG"`)
- **Implemented Repair:**
  - Upgraded Slot 7 `rocket_launcher` (`AT-4X / RPG-7V Bazooka`) 3D view-model (`WeaponViewModels.ts`) with a protruding olive-drab conical PG-7V warhead (hidden when empty), added 1-tap `RPG` quick-equip buttons (`touch-btn-rpg` and `desktop-btn-rpg`) that switch to Slot 7 without auto-firing, enforced a `45 HP` player self-damage cap, and verified solid-wall blast occlusion in `ExplosiveManager.ts`.

---

## 3. Implementation Order & Milestones

### Milestone 1 — P0 & High-Impact P1 Stabilization (`REP-01`–`REP-07`) — `COMPLETED & VERIFIED`
### Milestone 2 — Shadow Frustum Follow & Bundle Trimming (`REP-08`, `REP-09`) — `COMPLETED & VERIFIED`
### Milestone 3 — Procedural Rig Modularization & Additional Defect Cleanup (`REP-10`, `FND-09`–`FND-13d`) — `COMPLETED & VERIFIED`
### Milestone 4 — Real Player Feedback Implementation (`FND-14`–`FND-19` / `REP-11`–`REP-16`) — `COMPLETED & VERIFIED`

---

## 4. Release Acceptance Checklist

- [x] **Zero P0 Gameplay Defects:** Weapon slide/bolt returns to rest offset after sustained fire; `sprintToFireSec` weapon handling weight functions across all 9 weapons; 8-direction movement (`FND-14`) and PUBG-style vehicle steering/braking/reverse (`FND-15`) work reliably across keyboard and touch.
- [x] **Pre-Deployment Briefing, In-Combat Directives, Collectible 3D Hearts & 1-Tap RPG (`FND-16`–`FND-19`):** Versioned briefings, platform-aware `NEXT ACTION` prompts, `+35 HP` 3D Heart pickups, and Slot 7 `RPG-7V` 1-tap quick-equip are implemented and verified.
- [x] **Zero Mission-Unload BVH & Scope Leaks:** `PhysicsWorld.clear()` disposes all registered BVH geometries cleanly; 12-cycle multi-mission `ResourceManager` stress test, shared `'mission:world'` Heart pickup geometry disposal, and repeated `mission:audio` checkpoint restarts pass with zero leaks.
- [x] **Zero Unconditional 60Hz Debug or Hot-Path Target Allocations:** `getDebugInspectorRows()` only executes when Developer Mode is enabled; slot-pooled `fill*()` target buffers, zero-alloc `BallisticSolver.checkLineOfSight()`, and scratch vectors are reused across 60Hz simulation.
- [x] **Shadow Tracking, Procedural Relief & Bundle Trim:** Texel-snapped `updateShadowFocus`, procedural `bumpMap` micro-relief, and removal of runtime Rapier WASM + `howler` chunks verified.
- [x] **Mobile Landscape HUD & Controls Verified (Headless Browser Emulation):** 2-Finger, 3-Finger Claw, and Vehicle Driving HUD layouts pass zero-overlap and 360° camera look headless Chromium E2E checks across desktop, tablet, and mobile viewports (`1920×1080`, `1366×768`, `1024×768`, `844×390`, `844×315`, `915×412`, `390×844`).
- [x] **Automated Test Gates Green:** Vitest (14 files / 92 tests), `tsc --noEmit` (0 errors), Vite build, and Playwright E2E (7 / 7 passed) all green. *(Physical iOS/Android hardware QA remains Not verified in container; see `CHECKPOINT.md` Section H.)*
