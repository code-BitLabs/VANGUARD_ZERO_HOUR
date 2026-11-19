# VANGUARD: ZERO HOUR — STAGE 5C ENGINEERING REPORT
## Deep Physics & AI Locomotion Stabilization, Screenshot Defect Elimination (`SC-01`–`SC-10`), God-File Modularization & Release Hardening (`TRN-23`–`TRN-29`)

**Date:** 2026-11-19  
**Scope:** Full-system remediation of all 10 screenshot-confirmed defects (`SC-01`–`SC-10`) and execution of authorized Stage 5C workstreams `TRN-23` through `TRN-29` across `/app/applet`.

---

## 1. Executive Audit Summary

Stage 5C audited VANGUARD: ZERO HOUR end-to-end across physics, AI locomotion, animation kinematics, VFX pooling, world landmarks, gameplay state transitions, diagnostics, resource disposal, software-WebGL compatibility, and codebase modularity.

Every screenshot-confirmed defect (`SC-01` through `SC-10`) has been root-caused and eliminated without weakening invariants or hiding real diagnostics:
- **Zero Mission Resource Leaks:** Menu diorama (`mission:0`), `HealthPickupManager`, and all 5 campaign missions (`mission:1`–`mission:5`) unload to **`0` remaining mission resources** (down from `321` leaked resources in `SC-01`).
- **Zero Live HUD Warnings:** Live headless Chromium inspection of Mission 1 reports **`[F4] 60 FPS | DIAG` (`0 WARN`)**, zero `RESOURCE_LEAK_SUSPECTED`, and zero console/page errors (down from `18 WARN` in `SC-06`).
- **Hardened 3D Locomotion & Physics:** Stationary and moving AI now fall at continuous real gravity (`21.5 m/s²`), cannot cantilever-hover on roof edges, cannot tunnel laterally through railed staircases, and pass **`10/10`** deterministic scenarios in `AiStressArena.ts`.
- **Modularized Core Subsystems:** The 4 largest god-files (`EnemyManager.ts`, `MapBuilder.ts`, `GameHUD.tsx`, `VehicleManager.ts`) were decomposed into focused, typed modules with clean ownership boundaries.
- **Verification Gate:** **`0`** TypeScript errors (`npx tsc --noEmit`), **`25/25`** Vitest files (**`181/181`** tests passed), clean Vite 8.3.8 production build (`1.70s`), **`8/8`** Playwright E2E tests passed, and visually verified live Desktop (`1280×720`) + Mobile Landscape (`844×390`) Mission 1 renders.

---

## 2. Authoritative Defect Ledger (`SC-01`–`SC-10`)

| ID | Severity | Observed Symptom | Root Cause | Status |
|---|---|---|---|---|
| **SC-01** | **P0** | `321`-resource mission leak & ghost geometry after menu diorama → Mission 1 transition | `setupMenuDiorama()` used inconsistent scope vs `clearWorldState()`, and `HealthPickupManager` registered shared heart resources under orphaned `'mission:world'` | **RESOLVED & VERIFIED** |
| **SC-02** | **P0** | Enemies hovering/floating mid-air or drifting slowly off rooftops | Stationary units bypassed vertical gravity; elevated slab landing & `getSupportHeightAt` used full shoulder radius (`0.35–0.44m`) allowing roof-edge cantilevering | **RESOLVED & VERIFIED** |
| **SC-03** | **P0** | AI slipping laterally off exterior staircases / hovering beside flights | Slanted staircase flights lacked lateral side-rail containment (`hasSideRails`) and pre-step anti-tunneling clamping | **RESOLVED & VERIFIED** |
| **SC-04** | **P0** | Giant translucent red spheres and `64.8m` viewport-spanning diagonal yellow beam | `VFXPool` recycled `2.2×` smoke-scale particles into blood impacts without resetting `mesh.scale`; tracers stretched across full `origin→hit` segment | **RESOLVED & VERIFIED** |
| **SC-05** | **P0** | Floating bare green rectangular object mid-air over Mission 1 boulevard (`z=12`) | Unanchored green highway sign slab lacked structural piers, trusses, and industrial signage detailing | **RESOLVED & VERIFIED** |
| **SC-06** | **P0** | `18 WARN` badge accumulation in live HUD | `DiagnosticRulesEngine` appended duplicate warnings without `(ruleId, entityId)` deduplication or TTL expiry, and HUD counted non-actionable `INFO` entries | **RESOLVED & VERIFIED** |
| **SC-07** | **P1** | `-9.3cm` crouch boot sink, walk cycle spinning while blocked, and sniper laser piercing walls | Hardcoded crouch pelvis drop pushed soles below `y=0`; walk phase read desired velocity instead of measured displacement; sniper laser drew straight to player without raycast occlusion | **RESOLVED & VERIFIED** |
| **SC-08** | **P1** | Software-WebGL (SwiftShader/llvmpipe) IPC starvation during automated browser runs | Uncapped DPR/shadowMap/HalfFloat bloom and tight back-to-back rAF starved headless software GL compositor IPC | **RESOLVED & VERIFIED** |
| **SC-09** | **P1** | Monolithic god-files (`EnemyManager` `2,465`, `MapBuilder` `2,179`, `GameHUD` `1,463`, `VehicleManager` `1,443`) | Unseparated animation/locomotion/telemetry, landmark builders, HUD overlays, and vehicle suspension kinematics | **RESOLVED & VERIFIED** |
| **SC-10** | **P1** | Abrupt stair step-up camera snaps & `backdrop-blur-[2px]` over active WebGL canvas | Instant `pos.y` camera snap on step-up; `DownedActionOverlay` retained `backdrop-blur-[2px]` over live canvas | **RESOLVED & VERIFIED** |

---

## 3. Screenshot-Driven Defect Fixes (Exact Root Causes & Code Changes)

1. **`SC-01` (Resource Leak & Ghost Geometry):**
   - `src/gameplay/HealthPickupManager.ts`: `spawnPickup()` and `ensureSharedResources()` now bind heart geometries/materials to the active mission `scope` (`mission:<id>`) instead of orphaned `'mission:world'`.
   - `src/engine/GameEngine.ts`: `setupMenuDiorama()` uses `scope = 'mission:0'`; `clearWorldState()` deterministically unloads `'mission:lights'`, `'mission:audio'`, `'mission:0'`, `'mission:diorama'`, `'mission:world'`, and `this.activeScope`.
2. **`SC-02` & `SC-03` (AI Floating, Cantilever Hover & Stair Side-Rails):**
   - `src/engine/physics/CollisionResponseSystem.ts`: Tightened platform-top landing overlap to foot-base support radius `max(0.14, radius * 0.48)` (`minFootPen = max(0.04, radius - footSupportRadius)`) and added pre-step + post-step slanted lateral side-rail containment for `hasSideRails` slopes.
   - `src/engine/physics/PhysicsWorld.ts`: Aligned `getSupportHeightAt()` box overlap radius to `0.18m` (from `0.35m`).
   - `src/world/VerticalStructuresBuilder.ts`: Enabled `hasSideRails: true` on all switchback staircase flights and exterior ramps.
   - `src/gameplay/ai/EnemyLocomotionSolver.ts`: Applied continuous `21.5 m/s²` gravity (terminal `-24 m/s`) to **both** moving and stationary units, plus airborne dying units in `EnemyManager.ts` (`!u.grounded` always ticks at `0.016s`).
3. **`SC-04` (VFX Red Spheres & 64.8m Yellow Tracer Beam):**
   - `src/effects/VFXPool.ts`: Resets `mesh.scale.setScalar(0.01)` on both `acquire` (`reset()`) and `release`; sets `depthWrite: false` and compact scales (`blood: 0.14 → 0.02`, capped explosion scale `<= 2.2`); replaces full-segment yellow boxes with slim `1.8cm` traveling streaks (`0.95m–3.8m`) spawned `<= 2.4m` ahead of muzzle.
4. **`SC-05` (Floating Green Rectangle on M1):**
   - `src/world/builders/WorldPropsAndLandmarks.ts`: Replaced bare green slab at `z=12` with a grounded steel box-truss highway portal resting on twin concrete piers (`x = ±10.8`), upper/lower steel chords, vertical stanchions, riveted brackets, and muted industrial slate signage (`m1_gantry_slate`).
5. **`SC-06` (`18 WARN` Accumulation):**
   - `src/gameplay/diagnostics/DiagnosticRulesEngine.ts`: Deduplicates warnings by `(ruleId, entityId)` with `(xN)` occurrence counts and expires resolved entries (`12s` INFO, `18s` WARNING, `30s` CRITICAL).
   - `src/ui/hud/GameHUD.tsx` & `src/ui/debug/CombatDebugOverlay.tsx`: `warnCount` counts only actionable `WARNING` and `CRITICAL` severities.
6. **`SC-07` (Crouch Boot Sink, Walk Sync & Occluded Sniper Laser):**
   - `src/gameplay/ai/EnemyAnimationSync.ts`: Added `computeGroundedHipY()` and deep symmetrical tactical crouch knee/hip flexion (`lHip=-0.78, lKnee=1.48`, `rHip=-0.64, rKnee=1.38`) yielding `hipY ≈ 0.64m` (`< hipRestY - 0.15m`) with `0.000m` boot sink; drove walk phase exclusively from real measured `actualHorizSpeed`; added raycast-occluded `updateOccludedSniperLaser()`.
7. **`SC-08` (Software WebGL Compatibility):**
   - `src/engine/Renderer.ts` & `src/engine/GameLoop.ts`: Detects SwiftShader/llvmpipe/Microsoft Basic Render Driver (`isSoftwareGl`), caps DPR to `1.0` and shadow maps to `512` (`BasicShadowMap`), skips HalfFloat mipmap bloom on software GL, and inserts a `4ms` after-draw yield in `GameLoop.ts` (hardware GPUs remain on full native rAF + `EffectComposer` bloom).

---

## 4. Physics & Collision Architecture Changes (`TRN-23`)

- **Oriented Slope Footprint & Side-Rails (`src/physics/OrientedSlope.ts`):** Added `hasSideRails?: boolean` and tightened lateral footprint margin to `vLimit = halfWidth + min(0.04, radius * 0.1)`.
- **Anti-Tunneling Rail Containment (`src/engine/physics/CollisionResponseSystem.ts`):** Checks both post-step and pre-step `(startX, startZ)` slope residency so high-speed lateral impulses cannot tunnel past staircase rails while leaving entry/exit landing zones (`|u| >= halfLength - 0.16`) open for seamless floor transitions.
- **Unified Foot-Base Support Contract:** Synchronized elevated slab foot-support radii across `CollisionResponseSystem.ts` (`max(0.14, radius * 0.48)`) and `PhysicsWorld.getSupportHeightAt()` (`0.18m`), preventing characters whose center of mass is over empty air from snapping back onto roof decks.
- **Slope Descent Grounding:** Improved slope-descent snapping so units walking downhill stay glued cleanly to treads without micro-bouncing.

---

## 5. AI Locomotion, Animation Sync & Stress Arena (`TRN-24`)

- **Dedicated Locomotion Solver (`src/gameplay/ai/EnemyLocomotionSolver.ts`, `319` LOC):**
  - Continuous `21.5 m/s²` gravity for moving, stationary, and grace-period units.
  - 3-ray chest-height whisker obstacle avoidance (`-28°`, `0°`, `+28°`).
  - 3D elevation-gated separation (`|dy| <= 1.65m`) preventing upstairs/downstairs units from pushing each other across floors.
  - Real displacement speed smoothing (`actualHorizSpeed`, `actualVertSpeed`) and deterministic anti-oscillation stuck recovery with stale waypoint invalidation.
- **Dedicated Animation Synchronizer (`src/gameplay/ai/EnemyAnimationSync.ts`, `420` LOC):**
  - Foot-grounded hip kinematics (`computeGroundedHipY`), stair-climbing knee lift, death-collapse grounding, and solid-wall raycast occlusion for sniper lasers.
- **Honest Physics Telemetry (`src/gameplay/ai/EnemyTelemetryMapper.ts`, `250` LOC):**
  - Reports actual `u.grounded ? 'GROUNDED' : 'AIRBORNE'` rather than hardcoded `'GROUNDED'`.
- **Deterministic 10-Scenario Stress Arena (`src/gameplay/ai/AiStressArena.ts`, `629` LOC):**
  1. Flat sprint & multi-agent separation
  2. Multi-orientation slopes (`+Z`, `-Z`, `+X`, `-X`, `45°` diagonal)
  3. Switchback 2-flight staircase climb & side-rail containment (`railEscapeCount === 0`, reached `6.00m` top deck)
  4. Narrow bridge ledge drop under real gravity
  5. Rooftop edge-cantilever drop (`0` cantilever hovering)
  6. Low-ceiling `1.5m` overhang clearance & grounded crouch kinematics (`crouchFootSinkM <= 0.005m`)
  7. Tight doorway chokepoint throughput (`>= 3` units pass cleanly without deadlock)
  8. Multi-floor separation isolation (`crossFloorPushCount === 0`)
  9. 3-stop `CargoLiftManager` AI carry (`liftCarryDeltaM <= 0.12m`)
  10. Dynamic mid-path obstacle injection & deterministic stuck recovery (`stuckRecoveredCount >= 1`)

---

## 6. Whole-Game Gameplay & State Integrity Audit (`TRN-25`)

- **Weapons & Reload Interruption (`src/gameplay/WeaponSystem.ts`):** Verified deterministic reload cancellation on vehicle boarding, player death/downed transition, and weapon switching, invoking `audio.cancelReloadFoley()` and resetting view-model bolt/slide kinematics cleanly (`slideRestZ === -0.14` preserved).
- **Vehicle Elevated Surface & Exit Grounding (`src/gameplay/vehicle/VehicleKinematics.ts`, `src/gameplay/VehicleManager.ts`):** Wheel suspension samples elevated walkable decks via `getSupportHeightAt`, and vehicle exit verifies safe elevated/ground support placement.
- **Lifts & Checkpoints (`src/gameplay/CargoLiftManager.ts`, `src/gameplay/MissionCheckpoint.ts`):** Multi-stop lift boarding, fixed-step carry, and multi-floor checkpoint restoration verified across `stage5VerticalPhysicsAndLifts.test.ts`, `missionCheckpoints.test.ts`, and `AiStressArena.ts`.

---

## 7. God-File Elimination & LLD Modularization (`TRN-26` / `SC-09`)

| Monolith (Before Stage 5C) | Before LOC | After LOC | Delta | Extracted Focused Modules |
|---|---:|---:|---:|---|
| `src/gameplay/EnemyManager.ts` | 2,465 | **1,961** | **-504 (-20.4%)** | `EnemyAnimationSync.ts` (`420`), `EnemyLocomotionSolver.ts` (`319`), `EnemyTelemetryMapper.ts` (`250`), `AiStressArena.ts` (`629`) |
| `src/world/MapBuilder.ts` | 2,179 | **1,227** | **-952 (-43.7%)** | `src/world/builders/WorldPropsAndLandmarks.ts` (`918`) |
| `src/ui/hud/GameHUD.tsx` | 1,463 | **1,229** | **-234 (-16.0%)** | `src/ui/hud/TacticalMiniMap.tsx` (`101`), `src/ui/hud/TacticalOverlays.tsx` (`229`) |
| `src/gameplay/VehicleManager.ts` | 1,443 | **1,259** | **-184 (-12.8%)** | `src/gameplay/vehicle/VehicleKinematics.ts` (`217`) |
| **Total Core Monolith Surface** | **7,550** | **5,676** | **-1,874 (-24.8%)** | **7 cohesive, independently testable modules** |

All public facades, test hooks, and HUD `data-testid` contracts were preserved with zero regressions.

---

## 8. Visual, Rendering & VFX Integrity (`TRN-27`)

- **Particle Pool Hygiene:** Every pooled particle mesh resets scale to `0.01` immediately on `acquire` and `release`, eliminating stale cross-effect scale bleed (`SC-04`).
- **Ballistic Tracer Realism:** Long-range shots render as traveling `1.8cm × 1.8cm × 0.95–3.8m` luminous streaks instead of static full-distance yellow beams (`SC-04`).
- **Grounded Architectural Landmarks:** Mission 1 boulevard portal upgraded to a full structural steel box-truss gantry with twin concrete piers and industrial slate signage (`SC-05`), preserving Stage 5A/5B collision parity including `+9.0m` watchtowers.

---

## 9. HUD, Camera, Audio & Input Audit (`TRN-28` / `SC-10`)

- **Stair Step-Up Camera Damping (`src/gameplay/PlayerController.ts`):** Added `eyeStepOffset` with exponential smoothing (`18/s` decay, reset cleanly on `spawn()`), eliminating vertical camera snap jolt when ascending steps and curbs.
- **Zero `backdrop-filter` Over Active WebGL Canvas:** Removed `backdrop-blur-[2px]` from `DownedActionOverlay` in `src/ui/hud/TacticalOverlays.tsx`; live DOM inspection verified `hasBackdropOverCanvas: false`.
- **Preserved Contracts:** Non-pausing `[TAB]` Tactical Overview Drawer, `[N] TRIDENT-X` tactical ordnance readout, `[7] RPG` quick-equip, and zero top-bar/control overlap across desktop (`1920×1080`, `1280×720`) and mobile landscape (`844×390`, `844×315`) verified end-to-end.

---

## 10. Performance, Memory, Software-GL & Resource Leak Benchmarks (`TRN-29`)

| Metric / Budget | Before Stage 5C | After Stage 5C (Observed) | Verification Method |
|---|---:|---:|---|
| **Post-Unload Mission Resources (`mission:0`–`mission:5`)** | `321` leaked resources (`SC-01`) | **`0` leaked resources** across all 6 scopes | `stage5cPhysicsAiAndIntegrity.test.ts` (`ResourceManager.auditTransitionDelta`) |
| **Live Mission 1 HUD Warning Badge** | `18 WARN` (`SC-06`) | **`0 WARN` (Green `DIAG`)** | Live Chromium CDP audit + screenshot inspection |
| **TRN-01 Open `160×160` A\* Latency** | `0.1692 ms/query` | **`0.0689 ms/query`** | `tacticalNavigation.test.ts` (full parallel Vitest run) |
| **TRN-01 Jungle River Detour (`919` nodes)** | `0.9274 ms/query` | **`0.3786 ms/query`** | `tacticalNavigation.test.ts` |
| **TRN-01 15-Enemy `EnemyManager.update()`** | `1.3071 ms/tick` | **`0.9370 ms/tick`** | `tacticalNavigation.test.ts` |
| **Production Build (`Vite 8.3.8`)** | Clean | **`1.70s`** (`2,014` modules transformed) | `npm run build` |
| **Software-WebGL Pacing (`SwiftShader`)** | Uncapped rAF + bloom IPC stalls (`SC-08`) | `DPR <= 1.0`, `512` `BasicShadowMap`, bloom skipped on software GL, `4ms` yield | `Renderer.ts` + `GameLoop.ts` + `8/8` Playwright E2E pass |

---

## 11. Adversarial & Property-Based Verification Results

| Verification Suite | Command | Exact Observed Result |
|---|---|---|
| **TypeScript Static Check** | `npx tsc --noEmit` | **`0` errors** |
| **Vitest Unit, Integration & Stress Suite** | `npx vitest run` | **`25 / 25` test files passed, `181 / 181` tests passed (`0` failed, `43.44s`)** |
| **Stage 5C Adversarial Suite** | `src/tests/stage5cPhysicsAiAndIntegrity.test.ts` | **`6 / 6` tests passed** (6-scope zero-leak audit, stationary/moving ledge gravity & railed stairs, VFX pool scale-reset & tracer cap, diagnostic dedup/TTL, grounded hip & occluded laser, `10/10` `AiStressArena` invariants) |
| **Playwright Multi-Viewport E2E** | `CI=true npx playwright test e2e/responsive-and-gameplay.spec.ts` | **`8 / 8` passed (`0` console/page errors)** across `1920×1080`, `1366×768`, `1024×768`, `844×390`, `915×412`, `390×844` portrait gate, multitouch 360° + 3rd-finger fire, and non-pausing `[TAB]` overview |
| **Production Build & Lint** | `compile_applet` + `lint_applet` | **Clean production bundle & `0` lint/syntax errors** |

---

## 12. Visually Verified Live Screenshots Summary

Two live headless Chromium (`chrome-headless-shell` + SwiftShader WebGL) CDP screenshots were captured against active Mission 1 (`OP. IRON DAWN: URBAN ASSAULT`) and visually inspected directly:

1. **Desktop (`1280×720`):**
   - Top-right HUD shows green **`[F4] 60 FPS | DIAG`** with **`0 WARN`**, zero `RESOURCE_LEAK_SUSPECTED`, and zero console errors.
   - Central boulevard displays the new grounded **steel box-truss highway gantry** on twin concrete piers with muted slate signage (`SC-05` eliminated).
   - Zero giant translucent red spheres and zero viewport-spanning yellow beams (`SC-04` eliminated).
   - Armored tactical truck, heart med-station, orange-railed switchback staircases, downrange enemies, M416-V rifle, and articulated operator sleeve/hand are cleanly grounded and aligned.
   - Zero HUD overlap (`topLeftCenterOverlap: false`, `topCenterRightOverlap: false`, `hasBackdropOverCanvas: false`).
2. **Mobile Landscape (`844×390`, Touch Enabled):**
   - Clean zero-overlap layout (`topBarOverlap: false`, `0 WARN`, `errors: []`).
   - Left floating joystick, right `FIRE`/`ADS`/`JUMP`/`CROUCH`/`RELOAD` cluster, bottom ordnance bar (`FRAG`, `RPG 1/7`, `M416-V`, drawer), compact top-left radar/ARM/HP, centered compass, and bottom radio subtitle have clean spacing without overlapping the center reticle.

---

## 13. Remaining P2/P3 Issues & Unverified Hardware Limitations

### Honest Remaining P2/P3 Technical Debt
1. **Large JS Chunk Splitting (P2):** Vite production build flags `dist/assets/index-*.js` (`858.88 kB` raw / `228.00 kB` gzip) and `dist/assets/vendor-react-ui-*.js` (`1,141.66 kB` raw / `317.65 kB` gzip) as `> 500 kB` raw. Dynamic lazy-loading of mission data/builders and non-initial UI modals can further reduce initial parse time.
2. **React `act(...)` Test Harness Warnings (P3):** Existing jsdom UI tests (`mobileTouchAndInput.test.tsx`, `devModeAndLeaks.test.tsx`) emit non-failing React `act(...)` stderr advisories during simulated store updates.
3. **Further `EnemyManager.ts` Slimming (P3):** `EnemyManager.ts` dropped from `2,465` to `1,961` LOC; extracting squad perception/weapon-burst state machines into dedicated sub-modules can push it below `1,200` LOC in a future pass.

### Explicit Hardware & Environment Disclosure
- **Headless SwiftShader Only:** All live browser E2E runs and visual screenshot inspections in this container ran on **headless Chromium (`chrome-headless-shell`) with SwiftShader software WebGL** — NOT discrete desktop GPUs (NVIDIA/AMD/Apple Silicon) and NOT physical iOS/Android mobile handsets.
- **Unverified Physical Hardware Matrix:** Real glass-to-photon touch latency, 10-minute mobile GPU thermal throttling, physical iOS Safari dynamic URL-bar/notch insets, hardware WebGPU adapter paths, and OS phone-call/background audio-focus interruptions remain **unverified on physical hardware** (tracked in `CHECKPOINT.md` Section F).

---

## 14. Next Engineering Priorities

1. **Physical Device QA Pass (`CHECKPOINT.md` Section F):** Execute the 8-item matrix on physical iOS Safari (iPhone 13–16), Android Chrome (Pixel/Galaxy), and discrete desktop GPUs to validate real WebGL2/WebGPU frame pacing and touch ergonomics.
2. **Lazy Mission Chunk Splitting (P2):** Code-split heavy mission world builders and settings/armory bundles to bring initial JS bundle below `500 kB` raw.
3. **Authored GLB Asset Rollout (`TRN-22` Pipeline):** Progressively drop compressed KTX2/Meshopt `.glb` hero weapon and faction meshes into the existing 5-layer `AssetPipeline.ts` manifest with automated `AssetQualityGate` checks.
