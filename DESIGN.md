# VANGUARD: ZERO HOUR — Visual Bible & Design System (`DESIGN.md`)

> Living visual, UX, art-direction, and asset production contract for **VANGUARD: ZERO HOUR** (`Cinematic Special Operations Command`). Any UI, 3D environment, weapon, character, or motion change must conform to this contract.

---

## 1. Design Brief

- **Product**: Single-player tactical squad-command first-person shooter spanning five distinct military theaters (`OP. IRON DAWN`, `OP. RED DUST`, `OP. NIGHTFALL`, `OP. VIPER CANOPY`, `OP. BLACKOUT`).
- **Primary User**: Desktop (keyboard + mouse) and mobile landscape (multitouch) tactical FPS players seeking crisp gunplay, squad coordination or solo autonomy, deep weapon customization, and reliable 60 FPS frame pacing.
- **Stakeholder Goal**: Authentic AAA-grade military command atmosphere, zero visual clutter, effortless navigation from HQ to combat, and believable battlefield realism.
- **Top Task**: Choose Solo Operator vs. Fireteam Squad, configure mission & kit without friction, and deploy directly into responsive combat.
- **Emotional Target**: Disciplined · Tactical · Grounded.
- **Direction**: **Cinematic Special Operations Command** — grounded in modern tactical C2 instrumentation, studio-lit armory showcases, and physically plausible battlefield cinematography.
- **Visual Thesis**: Layered matte gunmetal and obsidian surfaces punctuated by surgical amber/cyan/crimson/emerald telemetry, framing full-bleed atmospheric theater photography and PBR-lit 3D geometry.
- **UX Thesis**: Progressive disclosure inside a unified Command HQ Shell (`Campaign`, `Operations`, `Armory`, `Fireteam`, `Progression`, `Settings`) so every page answers *Where am I? What is selected? What happens next? Can I undo?*
- **Interaction Thesis**: Crisp GPU-composited (`transform`/`opacity`) drawer and tab transitions (`140–220ms`), instant tactile hover/focus borders, zero jarring layout shifts, full `prefers-reduced-motion` bypass.
- **Dials**: Density `6/10` (Settings `7/10`, Combat HUD `3/10`) · Motion `4/10` · Layout Variance `4/10`.
- **Signature Moment**: Full-bleed Solo vs. Fireteam deployment staging paired with the real-geometry studio-lit 3D Armory weapon inspection stage and minimal diegetic combat HUD.
- **Themes**: Core dark tactical command palette + 4 colorblind-accessible palettes (`Off`, `Deuteranopia`, `Protanopia`, `Tritanopia`) + High-Contrast UI border mode.

---

## 2. Semantic Token Contract (`src/index.css`)

### Surface & Border Hierarchy
- `--surface-canvas`: `#080B0F` (deep obsidian viewport root)
- `--surface-base`: `#0D1218` (primary command chassis)
- `--surface-panel`: `#121821` (standard cards & drawers)
- `--surface-elevated`: `#18202C` (active items, popovers, dialogs)
- `--surface-well`: `#0A0E14` (recessed telemetry, inputs, inspection backdrops)
- `--border-hairline`: `rgba(255, 255, 255, 0.08)` (default structural divider)
- `--border-strong`: `rgba(255, 255, 255, 0.16)` (interactive hover / card framing)
- `--border-focus`: `#38BDF8` (keyboard focus ring)

### Semantic Accents (Disciplined Usage Only)
- `--accent-amber` (`#F59E0B`): Primary operational commitment (Deploy, Apply, Selected Slot) & critical cautions. Never wash across passive elements.
- `--accent-cyan` (`#38BDF8`): Friendly fireteam intelligence, radar telemetry, Solo/recon cues, and focus indicators.
- `--accent-crimson` (`#EF4444`): Hostile threats, suppression, downed alerts, conflict errors, and destructive confirmations.
- `--accent-emerald` (`#10B981`): Confirmed readiness, HQ recovered operators, valid states, and objective completion.

### Typography
- **Display**: `'Chakra Petch', sans-serif` — uppercase callsigns, screen titles, large KPI numbers (`tabular-nums`).
- **UI Body**: `'Plus Jakarta Sans', sans-serif` — briefings, settings descriptions, tactical advisories.
- **Telemetry / Technical**: `'JetBrains Mono', monospace` — ammo, coordinates, keybinds, FPS percentiles, ballistics (`tabular-nums`).

### Shape, Elevation & Z-Index Contract
- **Radius**: Crisp machined chamfers (`2px` inputs/chips, `4px` controls/cards, `6px` dialogs). Nested radii remain concentric.
- **Separation**: Hairline borders + subtle surface tonal steps (never heavy blur over active WebGL canvas).
- **Z-Index Layers**: `0` WebGL Canvas · `10` In-Game HUD · `20` Command HQ / Menus · `30` Slide-Over Drawers / Workbench · `40` Modals / Confirm Dialogs · `50` Portrait Gate / Critical Error / Toasts.

---

## 3. Activity-Adapted Density Rules

| Activity | Visual Tone & Density | Key Craft Rule |
|---|---|---|
| **Main Menu** | Cinematic full-bleed theater artwork, spacious composition | Clear primary CTA (`Command HQ` / `Quick Deploy`), subtle pointer parallax, unobtrusive soundtrack toggle |
| **Command HQ & Operations** | Structured tactical command rail + 4-step guided flow | Eliminate long vertical scrolls; progressive disclosure for intel & consequences |
| **Solo vs. Fireteam** | Distinct operational identities under one brand | Solo = Recon Cyan autonomy + Safe HQ Recovery status; Fireteam = Tactical Amber squad coordination & formations |
| **Armory** | Studio-lit real-geometry 3D weapon inspection showcase | Orbit/angle presets (`Profile`, `Optic`, `Muzzle`, `Receiver`), live attachment meshes, before/after ballistic deltas |
| **Settings** | Clean, dense 7-category professional application interface | React Hook Form + Zod, dirty banner, `Apply` / `Revert`, key-conflict swap, live hardware/telemetry strip |
| **Combat HUD** | Minimal, diegetic-inspired, high sightline clarity | Edge-anchored readouts, customizable opacity/scale/crosshair, zero center-screen clutter, `≥ 44px` mobile touch targets |

---

## 4. VANGUARD 3D Art Bible & Asset Production Standards (`TRN-50`)

### Four Asset Importance Classes
1. **Hero Assets**: First-person weapons (9 slots), operator arms/hands, main vehicles, squad/boss characters, mission landmarks, Armory inspection rigs. Highest bevel, material, texel-density (`512–1024 px/m` in viewmodel space), socket, and animation budgets.
2. **Gameplay-Critical Assets**: 7 enemy archetypes, tactical cover/barricades, enterable doors, cargo lifts, radar installations, supply stations. Exact alignment between Visual, Physics Collision, Ballistic Hitbox, and Navigation contracts.
3. **Repeated Environment Assets**: HESCO barriers, sandbags, shipping containers, street lamps, crates, fences, foliage clusters. Instanced rendering, shared Flyweight materials, screen-space LODs.
4. **Background Assets**: Distant city skyline, refinery silhouettes, mountain/jungle horizons. Low-draw-call atmospheric depth silhouettes.

### Modeling, UV & Blender-to-GLB Standards
- **Scale & Axes**: `1.0 unit = 1.0 meter`, right-handed `+Y` up, `-Z` forward for weapons/characters, ground-contact pivot at `y = 0`.
- **Construction**: Constructed assemblies with chamfered/beveled edges, recessed window mullions, rooflines, HVAC units, and foundation aprons—never repeated raw `BoxGeometry` silhouettes.
- **PBR Calibration**: 15 dedicated material profiles enforcing sRGB albedo (`SRGBColorSpace`) vs. linear normal, roughness, metalness, and AO maps (`NoColorSpace`), macro/micro detail breakup to eliminate visible tiling, and moisture-modulated roughness (never a blanket global wetness hack).
- **Four Separate Geometry Representations**: Visual LOD Mesh ≠ Physics Collision Proxy ≠ Ballistic Hitbox ≠ Navigation Walkable/Portal Surface.
- **Flyweight vs. Object Pooling**: Shared immutable geometries, textures, and material profiles are owned by Flyweight registries; mutable runtime instances (particles, decals, dynamic lights, casings, debris) are owned by bounded Object Pools with deterministic mission-reset disposal.

---

## 5. Anti-Slop & Accessibility Non-Negotiables

- Zero static pill walls, zero `//` code-comment headings, zero thick `border-l-4` accent stripes, zero pulsing decorative dots, zero `backdrop-blur` over active WebGL canvas.
- Every interactive control defines all 13 UX states (`Initial`, `Default`, `Hover`, `Focus`, `Selected`, `Disabled`, `Loading`, `Success`, `Error`, `Empty`, `Unsaved`, `Confirmation`, `Recovery`).
- Minimum `44×44px` touch targets on coarse pointers, safe-area insets on mobile notches, keyboard focus rings on all controls, and full `prefers-reduced-motion` compliance.
- **User Corrections Log**:
  - Preserve Google AI Studio built-in browser as the primary visual inspection workstation; never substitute Playwright or an in-app overlay for visual acceptance.
  - Never mark `IMPLEMENTED` items as `VERIFIED` without real observed browser evidence.
