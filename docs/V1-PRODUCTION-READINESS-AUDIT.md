# VANGUARD: ZERO HOUR — V1 PRODUCTION-READINESS AUDIT

**Audit Date:** 2026-11-15  
**Target Version:** V1 (Single-Player Tactical Browser FPS — Mobile Landscape & Desktop WebGL2)  
**Scope:** End-to-End Source Code, Runtime Architecture, Physics/Collision Pipeline, Rendering & Shaders, CPU/GPU Performance, Memory/GC Lifecycle, Mobile Browser Controls, Audio Engine, and Open-Source Technology Evaluation.

---

## 1. Executive Summary

**VANGUARD: ZERO HOUR (V1)** is a self-contained browser-based first-person tactical shooter built on **Three.js (`^0.187.0`)**, **React 19**, **Zustand 5**, **Tailwind CSS 4**, a deterministic custom **SpatialHash + Capsule/OBB Collision System**, **three-mesh-bvh**, and a procedural **Web Audio API** synthesizer. Across 5 campaign missions, V1 supports infantry firefights, destructible cover, drivable ground vehicles with roof-mounted turrets, hostile air units (helicopters, drones, strike jets), guided ordnance, and a 2-finger / 3-finger claw mobile HUD with a 1:1 interactive layout editor.

During the initial production-readiness audit and follow-up completion audit, all primary engineering defects and bottlenecks were identified and resolved in `REP-01` through `REP-10` plus `FND-09` through `FND-17`:

1. **Weapon View-Model & Handling Mechanics (`RESOLVED` — `REP-01`, `REP-02`):** Repaired slide/bolt recoil spring return (`slideRestZ`) and restored per-weapon `sprintToFireSec` handling delays across all 9 weapons.
2. **Redundant Dual-Physics Stepping & Unreleased BVH/WASM Memory (`RESOLVED` — `REP-04`, `FND-12`):** Removed idle `@dimforge/rapier3d-compat` WASM stepping and duplicate collider syncing (`2.17 MB` runtime bundle eliminated) and added `disposeBoundsTree()` cleanup on `PhysicsWorld.clear()`.
3. **60Hz Fixed-Step Garbage Collection & Unconditional Debug Row Construction (`RESOLVED` — `REP-03`, `REP-05`, `FND-09`):** Gated `getDebugInspectorRows()` behind Developer Mode ticks and replaced 60Hz spread arrays, closures, capsule results, and per-shot `Vector3.clone()` allocations with slot-pooled `fill*()` APIs and reusable scratch buffers.
4. **Procedural PBR Surface Response & Shadow Focus (`RESOLVED` — `REP-06`, `REP-08`):** Added procedural `bumpMap` micro-surface relief in `AssetManager.ts` and a texel-snapped player-following directional shadow frustum in `LightingRig.ts`.
5. **Unused Audio Vendor Bundle & Lifecycle Mute Hygiene (`RESOLVED` — `REP-07`, `REP-09`, `FND-11`):** Removed `howler` (`36.46 kB` `vendor-audio` chunk), unified native Web Audio lifecycle muting (`syncMasterGain()`), and locked tactical UI/lock cues to `playbackRate = 1.0`.

---

## 2. Actual Architecture Overview

### 2.1 High-Level Module Graph
| Subsystem | Primary Source Files | Actual Runtime Responsibility |
|---|---|---|
| **Boot & Lifecycle** | `src/engine/GameEngine.ts`, `src/core/LifecycleStateMachine.ts`, `src/core/ResourceManager.ts` | Owns the `requestAnimationFrame` loop, fixed-step accumulator (`1/60s`, max 4 substeps), mission loading/unloading, and scoped resource disposal (`shared`, `mission:<id>`, `pool:<id>`). |
| **Rendering & GPU Scaling** | `src/engine/Renderer.ts`, `src/engine/PerformanceGovernor.ts`, `src/engine/GpuCapabilityDetector.ts`, `src/world/LightingRig.ts` | Manages `THREE.WebGLRenderer`, perspective camera, `RoomEnvironment` PMREM reflections, `pmndrs/postprocessing` (`EffectComposer`, `BloomEffect`, `VignetteEffect`), and dynamic resolution/tier scaling. |
| **Input & Mobile HUD** | `src/engine/InputManager.ts`, `src/ui/hud/MobileTouchControls.tsx`, `src/ui/hud/mobileHudLayoutEngine.ts`, `src/ui/components/MobileHudEditorModal.tsx` | Unified desktop (Keyboard + Pointer Lock + Gamepad) and mobile touch (Left 360° analog joystick + Right-screen camera look surface + 2-Finger / 3-Finger Claw / Custom HUD layout engine). |
| **Physics & Collision** | `src/physics/CollisionWorld.ts`, `src/physics/SpatialHash.ts`, `src/engine/physics/PhysicsWorld.ts`, `src/engine/physics/CollisionResponseSystem.ts` | 2D spatial hash grid (`cellSize = 8m`) storing `SpatialAABB` colliders, custom iterative capsule-vs-AABB/OBB solver, swept-sphere queries, and `three-mesh-bvh` acceleration structures. |
| **Combat & Weapons** | `src/gameplay/PlayerController.ts`, `src/gameplay/WeaponSystem.ts`, `src/gameplay/BallisticSolver.ts`, `src/gameplay/ProjectilePool.ts`, `src/gameplay/ExplosiveSystem.ts` | First-person kinematic controller, 9-weapon state machine (hitscan + pooled ballistic/guided ordnance), procedural view-model rig, recoil/spread solver, and C4/airstrike/nuclear ordnance. |
| **AI & Vehicles** | `src/gameplay/EnemyManager.ts`, `src/gameplay/CombatEngagementCoordinator.ts`, `src/gameplay/VehicleManager.ts`, `src/gameplay/AirCombatManager.ts` | Token-leased AI fire coordination (`MAX_SIMULTANEOUS_ATTACKERS`), ground infantry state machine (`UNAWARE` → `COMBAT` / `COVER` / `FLANK`), OBB vehicles with spring-arm camera, and multi-phase aircraft. |
| **World & Assets** | `src/world/MapBuilder.ts`, `src/core/AssetManager.ts`, `src/effects/VFXPool.ts`, `src/gameplay/DestructionSystem.ts` | Procedural urban/desert/jungle/industrial/night map generation, `InstancedMesh` static batching (`63` colliders / `20+` buildings), procedural canvas textures, and pooled particle/tracer/nuke VFX. |
| **State & Telemetry** | `src/state/gameSessionStore.ts`, `src/state/settingsStore.ts`, `src/state/uiStore.ts`, `src/gameplay/CombatTelemetryRecorder.ts` | Zustand state stores for HUD, persisted player settings (`localStorage`), and developer combat/physics telemetry. |

### 2.2 Frame Execution Path (`GameEngine.loop`)
1. `requestAnimationFrame` callback computes `rawDt` and clamps frame delta (`max 0.1s`).
2. `InputManager.pollGamepad()` updates gamepad axes/buttons.
3. Fixed-step accumulator (`FIXED_STEP = 1/60s`, clamped to `MAX_SUBSTEPS = 4`) executes `onFixedStep(FIXED_STEP)`:
   - Updates `CollisionWorld.beginFrame(dt)` → `PhysicsWorld.beginFrame(dt)`.
   - Updates `PlayerController.update()` (or `VehicleManager.update()` when driving).
   - Gathers hitscan targets and lock candidates from `EnemyManager`, `AirCombatManager`, and `VehicleManager`.
   - Updates `WeaponSystem.update()` (recoil, spread, hitscan/projectile firing, view-model transform).
   - Steps `EnemyManager.update()`, `AirCombatManager.update()`, `ProjectilePool.update()`, and `ExplosiveSystem.update()`.
   - Ticks `MissionDirector.update()`, `CombatEngagementCoordinator.tick()`, and HUD/telemetry snapshots.
4. Variable-rate render tail executes `VFXPool.update(clampedDt)`, `AudioManager.updateListener()`, `PerformanceGovernor.recordSample()`, and `EngineRenderer.renderFrame()`.

---

## 3. Post-Repair Test & Benchmark Results

### 3.1 Automated Unit & Integration Suite (`Vitest`)
- **Command:** `npx vitest run --pool=vmThreads`
- **Post-Repair Status (`VERIFIED`):** **14 test files passed, 92 tests passed (`0` failures)** (`playerFeedbackRepairs.test.ts` + `v1RepairsVerification.test.ts` + all 12 core suites).
- **Coverage:** Physics capsule/OBB collision & BVH disposal, combat LOS/token leases, zero-alloc `BallisticSolver.checkLineOfSight()` & `fireWeaponRay()`, weapon ballistics/recoil/sprint-to-fire, GPU capability scoring, native audio lifecycle muting & idempotent `mission:audio` cleanup, texel-snapped shadow frustum tracking, zero-alloc target buffers & clean `clear()` release, modular rig builders + 12-cycle `ResourceManager` load/unload leak stress test, 8-direction movement & diagonal sprint/slide steering (`FND-14`), PUBG-style vehicle controls + brake-to-reverse hysteresis + Chase Camera heading follow (`FND-15`), structured mission directives & versioned pre-deployment briefings (`FND-16`, `FND-17`), Collectible 3D Heart health pickups (`FND-18`), Slot 7 RPG/Bazooka + `45 HP` self-damage cap + wall occlusion (`FND-19`), and mobile HUD layout non-overlap across Infantry & Vehicle modes.

### 3.2 Production Bundle & Build Verification (`Vite 8.3.8`)
- **Command:** `npm run build` (`vite build`)
- **Post-Repair Status (`VERIFIED`):** Clean TypeScript (`tsc --noEmit`: 0 errors) + Vite production build.
- **Verification Note (`VERIFIED`):** Both the `2,175.87 kB` Rapier WASM chunk (`vendor-physics`) and the `36.46 kB` `howler` chunk (`vendor-audio`) have been completely eliminated from the production client bundle. (`@dimforge/rapier3d-compat` stays in `package.json` solely for the standalone `src/physics/PhysicsBenchmark.ts` developer helper via dynamic import and is never bundled into `dist/assets/`.)

### 3.3 Playwright Browser E2E & Mobile Viewport Verification
- **Command:** `npx playwright test e2e/responsive-and-gameplay.spec.ts`
- **Post-Repair Status (`VERIFIED` in headless Chromium — Automated Browser Verification + Browser Emulation):** **7 passed** across `1920×1080` (Desktop), `1366×768` (Laptop), `1024×768` (Tablet), `844×390` (Phone Landscape), `915×412` (Pixel Landscape), `390×844` (Mobile Portrait gate), and live Mission 1 `844×390` / `844×315` multitouch gameplay.
- **Verified Runtime Metrics:**
  - Zero horizontal/vertical document overflow (`scrollWidth <= innerWidth + 1`).
  - Pre-Deployment Mission Briefing (`mission-briefing-panel`, `briefing-version-badge`, `briefing-controls-guide`, `mission-briefing-modal`), in-combat `NEXT ACTION` directive (`hud-action-directive`), and 1-tap `RPG` quick-equip (`touch-btn-rpg`) verified in live browser gameplay.
  - Zero bounding-box overlap across all visible touch controls in **2-Finger**, **3-Finger Claw**, and **Vehicle Driving HUD** profiles (including 1:1 Full-Screen HUD Editor Infantry & Vehicle mode round-trip and `844×315` compact browser height).
  - Full 360° camera yaw traversal, independent 4-way movement + strafe, and 3rd-finger firing verified in live headless Chromium gameplay with zero page/console errors.

---

## 4. Gameplay & Realism Findings

| ID | Status | Severity | Location | Finding & Technical Proof |
|---|---|---|---|---|
| **G-01** | `VERIFIED` | **P0** | `src/gameplay/WeaponSystem.ts:697–700` | **Weapon Slide/Bolt Permanent Backward Drift:** `rig.slideOrBolt.position.z = rig.slideOrBolt.position.z + (this.recoilKickZ * 0.5 - rig.slideOrBolt.position.z * 0.0) * 0.1;` multiplies the current position by `0.0`. Instead of springing back to its initial rest Z coordinate, the slide/bolt accumulates `0.05 * recoilKickZ` every frame while `recoilKickZ > 0`, permanently detaching backward behind the gun body. |
| **G-02** | `VERIFIED` | **P0** | `src/gameplay/WeaponSystem.ts:67–68, 292–293, 345` | **Sprint-to-Fire Delay Hardcoded to Zero:** Every weapon in `src/data/weapons.ts` specifies `sprintToFireSec` (`0.11s` for pistol/SMG up to `0.30s` for LMG/launchers). `WeaponSystem` tracks `wasSprinting` (`line 68`) and checks `this.sprintToFireTimer <= 0` (`line 345`), but `line 293` sets `this.sprintToFireTimer = 0` unconditionally every frame instead of arming `this.sprintToFireTimer = cfg.sprintToFireSec` when transitioning out of sprint. |
| **G-03** | `VERIFIED` | **P2** | `src/gameplay/WeaponSystem.ts:606–676` | **Box-Primitive Weapon View-Models:** Weapon view-models are constructed from 4–6 untextured `BoxGeometry` / `CylinderGeometry` primitives without barrel rifling, iron-sight apertures, rails, or surface wear maps, limiting first-person visual immersion. |
| **G-04** | `VERIFIED` | **P2** | `src/gameplay/EnemyManager.ts:1100–1234` | **Procedural Box-Limb Enemy Rigs:** Enemy soldiers use hierarchical box primitives with procedural sinusoidal walk cycles (`walkCycle += dt * speed`). While readable and fast to render, hit reactions are limited to a brief torso pitch kick (`hitReactTimer`). |

---

## 5. Visual & Rendering Limitations

| ID | Status | Severity | Location | Finding & Technical Proof |
|---|---|---|---|---|
| **R-01** | `VERIFIED` | **P1** | `src/core/AssetManager.ts:125–138` | **Missing Bump/Roughness Micro-Detail on Procedural Materials:** `getSharedMaterial()` creates `THREE.MeshStandardMaterial` with only `map` (a 256×256 procedural 2D canvas texture) and scalar `roughness` / `metalness`. Without a `bumpMap` (`bumpScale`), large concrete walls, asphalt roads, sand dunes, and metal plates produce flat, mirror-uniform specular lobes under the directional sun light and `RoomEnvironment` IBL. |
| **R-02** | `VERIFIED` | **P2** | `src/engine/Renderer.ts:207–214` | **EffectComposer Bypassed When Bloom Is Disabled:** `renderFrame()` only runs `this.composer.render()` when `this.bloomEnabled && this.composer` is truthy. On `low` and `medium` tiers (or mobile `high` where bloom defaults to `false`), `VignetteEffect` is also bypassed. |
| **R-03** | `VERIFIED` | **P2** | `src/world/LightingRig.ts:29–46` | **Static Non-Cascaded Shadow Frustum Centered on Origin:** The directional light shadow camera uses a fixed ortho frustum (`[-shadowDistance, shadowDistance]`) targeting `(0, 0, 0)` rather than snapping to the player's texel-aligned camera frustum, reducing effective shadow texel density when the player moves 100m+ from the map center. |

---

## 6. CPU / GPU Performance Findings

| ID | Status | Severity | Location | Finding & Technical Proof |
|---|---|---|---|---|
| **P-01** | `VERIFIED` | **P0** | `src/engine/GameEngine.ts:1161–1166` | **Unconditional 60Hz Debug Inspector Row Construction:** On every fixed step (`60Hz`), `GameEngine.onFixedStep` calls `this.enemies.getDebugInspectorRows(this.player)`, `this.airCombat.getDebugInspectorRows(this.player)`, and `this.vehicles.getDebugInspectorRows(this.player)` outside `if (devActive)` just to compute `const anyEnemyHasLos = allDebugUnits.some((u) => u.hasLos)`. Each call iterates all units, computes Euclidean distances, formats 12+ numbers via `Number(val.toFixed(1))`, and allocates a 31-property object per unit—even in production gameplay when Developer Mode is OFF. |
| **P-02** | `VERIFIED` | **P1** | `src/engine/physics/PhysicsWorld.ts:91–94, 108–150` | **Redundant Per-Frame Rapier WASM Stepping:** `PhysicsWorld.beginFrame(dt)` calls `this.rapierWorld.step()` every frame and `syncRapierCollider()` creates WASM rigid bodies/colliders for every static AABB, even though all gameplay physics queries (`resolveCharacterCapsule`, `resolveVehicleMovement`, `raycast`, `sweptSphere`) execute against `CollisionSystem` + `SpatialHash`. |
| **P-03** | `VERIFIED` | **P1** | `src/engine/GameEngine.ts:970–971, 1082–1085` | **60Hz Spread-Array Allocations in Fixed Step:** `allHitscan`, `lockCandidates`, and `prox` arrays are reconstructed via spread syntax (`[...a, ...b, ...c]`) on every 60Hz tick instead of reusing pre-allocated buffers on `GameEngine`. |

---

## 7. Memory & Garbage-Collection Findings

| ID | Status | Severity | Location | Finding & Technical Proof |
|---|---|---|---|---|
| **M-01** | `VERIFIED` | **P0** | `src/engine/physics/PhysicsWorld.ts:152–182` | **Unreleased `three-mesh-bvh` & Rapier Colliders on `PhysicsWorld.clear()`:** `registerMeshBVH()` computes a `MeshBVH` (`computeBoundsTree()`) and pushes the geometry into `this.bvhGeometries`, and `syncRapierCollider()` inserts colliders into `this.rapierWorld`. However, `PhysicsWorld.clear()` only clears `staticColliders` and `rapierColliderHandles` without calling `disposeBoundsTree()` on `this.bvhGeometries` or removing colliders from `this.rapierWorld`, leaking memory across mission transitions. |
| **M-02** | `VERIFIED` | **P1** | `src/gameplay/WeaponSystem.ts:281, 449–453, 494–498, 573` | **Per-Shot & Per-Pellet `THREE.Vector3` Heap Allocations:** `getMuzzleWorldPosition()` returns `this._muzzleWorld.clone()`, `fireShot()` clones `dir` and `endPoint` (`dir.clone().multiplyScalar(...)`), and `spawnProjectileShot()` clones `muzzlePos` and `aimDir`, creating short-lived heap allocations during rapid automatic or shotgun fire. |

---

## 8. Browser & Mobile Limitations

| ID | Status | Severity | Location | Finding & Technical Proof |
|---|---|---|---|---|
| **B-01** | `VERIFIED` | **Resolved in V1** | `src/ui/hud/mobileHudLayoutEngine.ts`, `src/ui/hud/MobileTouchControls.tsx` | **Mobile Landscape Ergonomics & Multi-Touch Isolation:** Previously suffered from right-side button overlap and restricted camera rotation. Resolved via the deterministic `computeMobileHudLayout()` and `computeMobileVehicleHudLayout()` engines, non-overlapping right-thumb arc, bottom-center weapon bar with 1-tap `RPG`, independent Left/Right Fire buttons, and `PointerEvent.pointerId` tracking on `right-look-surface`. |
| **B-02** | `PARTIALLY VERIFIED` | **P2** | `src/ui/hooks/useFullscreenLandscape.ts`, `index.html` | **iOS Safari Fullscreen & Dynamic Browser Chrome:** iOS Safari on iPhone does not support the standard Fullscreen API (`element.requestFullscreen`) on arbitrary elements (only on `<video>` or PWA standalone mode). While `100dvh` and `env(safe-area-inset-*)` are applied, iOS Safari's URL bar can still consume vertical height unless added to Home Screen. |

---

## 9. Audio & Immersion Findings

| ID | Status | Severity | Location | Finding & Technical Proof |
|---|---|---|---|---|
| **A-01** | `VERIFIED` | **P2** | `src/audio/AudioManager.ts:1, 101–126` | **Redundant `howler` Dependency (`36.46 kB`):** `Howler` is imported only to call `Howler.mute()` and `Howler.volume()`, while all sound generation, spatialization (`PannerNode`), and mixing (`GainNode`) are implemented directly in native Web Audio API (`AudioContext`). |
| **A-02** | `VERIFIED` | **P1** | `src/audio/AudioManager.ts:314–318` | **Uniform Synthesis Envelope & Footstep Cadence:** While `playInternal` applies a small playbackRate jitter (`0.96 + Math.random() * 0.08`), `hit_marker`, `headshot`, `lock_beep`, `lock_ready`, and `ui_click` also receive random pitch shifts (which makes tactical UI/lock tones waver unnaturally), whereas weapon shots and footsteps lack per-weapon filter cutoff variation and sprint/crouch volume scaling. |

---

## 10. Developer Experience & Maintainability

- **Strengths (`VERIFIED`):**
  - Clean separation between `src/engine/`, `src/gameplay/`, `src/physics/`, `src/world/`, `src/ui/`, and `src/schemas/` (Zod validation).
  - Scoped resource lifecycle tracking (`ResourceManager`) with post-unload leak auditing (`auditTransitionDelta()`).
  - Built-in Combat & Physics Debug Inspector (`CombatDebugOverlay.tsx`) gated behind Developer Mode.
  - Procedural mesh builders (`EnemyRigBuilder.ts`, `VehicleRigBuilder.ts`, `AirRigBuilder.ts`) extracted into `src/world/rigs/` (`REP-10`).

---

## 11. Open-Source Research (`ADOPT` / `ADAPT` / `LEARN` / `REJECT`)

| Technology / Pattern | Decision | Engineering Rationale for VANGUARD: ZERO HOUR (V1) |
|---|---|---|
| **`three-mesh-bvh` (`^0.9.9`, installed)** | **ADOPT & EXPAND** | Already installed and fast for static triangle raycasting. Must fix `disposeBoundsTree()` cleanup in `PhysicsWorld.clear()` to prevent memory leaks. |
| **Custom `CollisionSystem` + `SpatialHash` (`src/physics/`)** | **ADOPT (Authoritative V1)** | Deterministic, zero-WASM-marshaling overhead, supports OBB yaw rotation, step-up climbing, and fast ray/capsule sweeps in `< 0.4ms/frame`. |
| **`@dimforge/rapier3d-compat` (`^0.19.3`, installed)** | **LEARN / DORMANT IN V1** | Currently adds a `2.17 MB` WASM bundle and steps an unused world every frame while all gameplay queries use `CollisionSystem`. Disable idle per-frame Rapier stepping and duplicate collider syncing in V1 so CPU/memory budgets are not wasted. |
| **`postprocessing` (`^6.38.3`, installed)** | **ADAPT** | Merges post-processing passes efficiently, but should only run when enabled by the active quality profile and must respect software-rasterizer / low-tier bypass rules. |
| **`howler` (`^2.2.4`, installed)** | **REJECT FOR V1 AUDIO** | 100% of V1 audio uses native `AudioContext` procedural buffers and `PannerNode`. `Howler` is dead weight (`36.46 kB`) used only for no-op `.mute()` calls. |
| **Procedural Canvas Bump/Roughness Maps (`AssetManager.ts`)** | **ADAPT** | Reusing the existing 2D canvas procedural textures as a shared `bumpMap` (`bumpScale: 0.015–0.035`) adds tangible surface micro-relief to concrete, asphalt, sand, and metal with zero external asset downloads. |

---

## 12. Verified Defects & Player Feedback Backlog Summary

| ID | Classification | Priority | Summary |
|---|---|---|---|
| **FND-01** | `VERIFIED & RESOLVED` | **P0** | Weapon view-model slide/bolt permanently drifts backward during firing (`WeaponSystem.ts`). |
| **FND-02** | `VERIFIED & RESOLVED` | **P0** | Sprint-to-fire delay (`sprintToFireSec`) overwritten with `0` every frame (`WeaponSystem.ts`). |
| **FND-03** | `VERIFIED & RESOLVED` | **P0** | `PhysicsWorld.clear()` leaks `bvhGeometries` and steps an unused Rapier WASM world every frame (`PhysicsWorld.ts`). |
| **FND-04** | `VERIFIED & RESOLVED` | **P0** | `GameEngine.onFixedStep()` builds full `EnemyDebugInspectorRow[]` tables at 60Hz even when Developer Mode is disabled (`GameEngine.ts`). |
| **FND-05** | `VERIFIED & RESOLVED` | **P1** | Per-shot `THREE.Vector3.clone()` and 60Hz spread-array allocations in `WeaponSystem.ts` and `GameEngine.ts`. |
| **FND-06** | `VERIFIED & RESOLVED` | **P1** | Procedural `MeshStandardMaterial` lacks `bumpMap` micro-relief, causing flat specular surfaces (`AssetManager.ts`). |
| **FND-07** | `VERIFIED & RESOLVED` | **P1** | `AudioManager` applies random pitch jitter to tactical UI/lock tones (`AudioManager.ts`). |
| **FND-08** | `PARTIALLY VERIFIED` | **P2** | iOS Safari non-PWA fullscreen limitations due to WebKit Fullscreen API restrictions on iPhone (`useFullscreenLandscape.ts`). |
| **FND-09–13d** | `VERIFIED & RESOLVED` | **P1–P3** | Zero-alloc `BallisticSolver`, non-mutating `ignoreColliderId`, lifecycle mute sync, honest `solverBackend` label, and checkpoint `AbortController` cleanup. |
| **FND-14** | `VERIFIED & RESOLVED` | **P0** | **Real Player Feedback (`"Left right kaj kore na, movement problem."`)**: Immediate 8-direction joystick response inside `1.45×` ring, deduplicated `TouchEvent` edge-swipe recovery, `ArrowKey` + non-QWERTY support, diagonal sprint (`W+A`/`W+D`), and lateral slide steering. |
| **FND-15** | `VERIFIED & RESOLVED` | **P0** | **Real Player Feedback (`"Car only forward jai."`)**: Unified `getVehicleControls()`, PUBG Mobile-inspired Vehicle Driving HUD (`STEER LEFT`/`RIGHT` or `WHEEL`, `GAS`, `BRAKE/REV`, `HANDBRAKE`, `EXIT`), progressive speed-sensitive steering with self-centering, brake-to-reverse hysteresis (`160ms` hold), and smooth Chase Camera heading follow. |
| **FND-16** | `VERIFIED & RESOLVED` | **P1** | **Real Player Feedback (`"Mission e kora lagbe eta aro valo kore bola lagbe."`)**: Structured `actionMeta` per objective and platform-matched `NEXT ACTION` HUD directive (`hud-action-directive`). |
| **FND-17** | `VERIFIED & RESOLVED` | **P1** | **Real Player Feedback (`"Mission start hower age kora lagbe eta add koro."`)**: Versioned `(missionKey, briefingVersion)` persistence, Pre-Deployment Mission Briefing panel (`mission-briefing-panel`), platform controls guide, and `Full Briefing Dossier` modal (`mission-briefing-modal`). |
| **FND-18** | `VERIFIED & RESOLVED` | **P1** | **Real Player Feedback (Collectible 3D Heart ❤️ Health Pickups)**: 4 map med-stations + single-evaluation enemy drops (`healthDropEvaluated`, max 3 active drops) restoring `+35 HP` up to `100` max within `2.25m`. |
| **FND-19** | `VERIFIED & RESOLVED` | **P1** | **Real Player Feedback (`"Can you add Baduka? RPG"`)**: Upgraded Slot 7 `AT-4X / RPG-7V Bazooka` 3D view-model with conical PG-7V warhead, 1-tap `RPG` quick-equip HUD button (`touch-btn-rpg` / `desktop-btn-rpg`), `45 HP` self-damage cap, and wall LOS blast occlusion. |

---

## 13. The Ten Biggest Problems Holding V1 Back (And Their Resolution)

1. **Unconditional 60Hz Debug Row Allocations in Production Gameplay (`GameEngine.ts`)** — `RESOLVED (REP-03)`
2. **Weapon Slide/Bolt Permanent Mesh Drift (`WeaponSystem.ts`)** — `RESOLVED (REP-01)`
3. **Broken Sprint-to-Fire Weapon Weight (`WeaponSystem.ts`)** — `RESOLVED (REP-02)`
4. **Idle Rapier WASM World Stepping & Duplicate Static Colliders (`PhysicsWorld.ts`)** — `RESOLVED (REP-04)`
5. **Unreleased BVH Trees on Mission Reset (`PhysicsWorld.ts`)** — `RESOLVED (REP-04)`
6. **Hot-Path Vector & Spread-Array Allocations (`WeaponSystem.ts` & `GameEngine.ts`)** — `RESOLVED (REP-05, FND-09, FND-13a)`
7. **Player Left/Right Movement & Touch Edge-Swipe Interruption (`MobileTouchControls.tsx`, `InputManager.ts`, `PlayerController.ts`)** — `RESOLVED (FND-14 / REP-11)`
8. **Vehicle Forward-Only Driving Feel & Missing Dedicated Driving HUD (`VehicleManager.ts`, `VehicleCameraRig.ts`, `MobileTouchControls.tsx`)** — `RESOLVED (FND-15 / REP-12)`
9. **Unclear Pre-Mission & In-Combat Objective Guidance (`CampaignScreen.tsx`, `MissionDirector.ts`, `GameHUD.tsx`)** — `RESOLVED (FND-16, FND-17 / REP-13, REP-14)`
10. **Mid-Combat Health Sustain & 1-Tap Heavy RPG Accessibility (`HealthPickupManager.ts`, `WeaponViewModels.ts`, `ExplosiveManager.ts`)** — `RESOLVED (FND-18, FND-19 / REP-15, REP-16)`

---

## 14. Root-Cause Analysis (With File & Line References)

### 14.1 `FND-01`–`FND-04` (Initial Audit P0 Defects)
- **`FND-01` (`WeaponSystem.ts`):** `slideRestZ` recorded at rig build time and interpolated smoothly during `updateViewModelTransform()`.
- **`FND-02` (`WeaponSystem.ts`):** `sprintToFireTimer` armed with `cfg.sprintToFireSec` when exiting sprint.
- **`FND-03` (`PhysicsWorld.ts`):** Idle Rapier WASM stepping removed and `bvhGeometries` disposed on `clear()`.
- **`FND-04` (`GameEngine.ts`):** `getDebugInspectorRows()` gated behind `devActive`.

### 14.2 `FND-14`: Player Left/Right Movement (`MobileTouchControls.tsx`, `InputManager.ts`, `PlayerController.ts`)
- **Root Cause:** Fixed joystick mode re-centered the stick origin (`cx = clientX`) whenever `dist > radius * 1.05`, so tapping the outer left/right edge of the visible ring resulted in `dx = 0` (`right = 0`) unless the player dragged a second time. In addition, mobile browsers near the left screen edge could fire premature `pointercancel` on horizontal swipes, and desktop lacked `ArrowLeft/Right` bindings.
- **Fix:** Preserved fixed stick center for all presses within `1.45×` base radius, added deduplicated `TouchEvent` edge-swipe recovery keyed by `Touch.identifier`, added `ArrowUp/Down/Left/Right` + `normalizeKeyCode(e)`, and allowed diagonal sprinting (`W+A` / `W+D`) and lateral slide steering.

### 14.3 `FND-15`: Vehicle Steering, Brake-to-Reverse & Chase Camera (`VehicleManager.ts`, `VehicleCameraRig.ts`, `MobileTouchControls.tsx`)
- **Root Cause:** Driving on mobile reused the infantry analog stick without dedicated steering or gas/brake/reverse pedals, while `VehicleManager.ts` had no progressive wheel angle (`steerAngle`) or brake-to-reverse hysteresis state machine, and `VehicleCameraRig.ts` did not follow vehicle heading in Chase mode.
- **Fix:** Implemented `InputManager.getVehicleControls()`, the PUBG Mobile-inspired Vehicle Driving HUD (`STEER LEFT`/`RIGHT` or `WHEEL`, `GAS`, `BRAKE/REV`, `HANDBRAKE`, `EXIT`), speed-sensitive progressive `steerAngle` with self-centering, a `160ms` `NEUTRAL_HOLD` hysteresis brake-to-reverse state machine, and smooth Chase Camera heading follow.

---

## 15. Current Production-Readiness Verdict

- **Pre-Repair Status:** **NOT PRODUCTION READY** (due to `FND-01`–`FND-04` and real player gameplay blockers `FND-14`–`FND-19`).
- **Current Post-Repair Status:** **PRODUCTION READY FOR V1 WEB & EMULATED MOBILE LANDSCAPE (PENDING PHYSICAL HARDWARE QA)** — `REP-01` through `REP-16`, `FND-09` through `FND-13d`, and real player feedback items `FND-14` through `FND-19` are implemented and verified by `tsc --noEmit` (0 errors), `npm run build`, `npx vitest run --pool=vmThreads` (14 files / 92 tests passed), and headless Chromium Playwright E2E (7 / 7 passed).

---

## 16. Known Limitations & Unverified Areas

1. **Physical Mobile Hardware Thermal & Touch Latency (`NOT VERIFIED` on physical iOS/Android hardware):** Headless Chromium Playwright E2E (`Browser Emulation` + `Automated Browser Verification`) verifies viewport geometry, pointer-event routing, 360° camera rotation, and non-overlapping touch hitboxes across mobile viewports (`844×390`, `844×315`, `915×412`), but physical-device GPU thermal throttling, notch/home-bar hardware cutouts, non-PWA iOS Safari URL-bar behavior, and iOS/Android glass-to-photon touch latency require physical-device QA (see `CHECKPOINT.md` Section H).
2. **Procedural Geometric Assets (`VERIFIED` architectural scope):** V1 intentionally uses procedural geometry and canvas-synthesized textures/audio rather than external multi-megabyte `.glb` character animations or `.ktx2` photogrammetry packs.
