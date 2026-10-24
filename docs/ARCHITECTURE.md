# ARCHITECTURE.md

## 1. Purpose

This document maps the **current** implementation (`index.html`, `style.css`,
`script.js`) to the **target** modular parametric building editor described
in the project brief, and defines the migration path. It is written before
any structural rewrite begins, per the project's own "First Task" rule.

---

## 2. Current System Inventory

Single file: `script.js` (~1490 lines), plain ES modules importing Three.js
from a CDN via importmap. No bundler, no build step. `index.html` renders a
canvas plus three floating, draggable/resizable panels (Tools, Outliner,
BOQ). All UI is hand-built DOM, no framework.

### 2.1 What exists, section by section

| Existing section (script.js) | Responsibility | Keep / Rework |
|---|---|---|
| Security (§1) | Blocks right-click / devtools shortcuts | Keep as-is, move to `app/` bootstrap |
| Material Library (§2) `MATERIALS` | 5 structural materials, `components(m)` formulas producing BOQ rows from `{volume, area}` | **Keep the formulas verbatim.** Move into `materials/` + `calculation/calculators/`, decouple from mesh objects (already takes plain `{volume,area}`, so this is easy) |
| GUI Utils (§3) | Window show/hide/drag/z-order | Keep; move to `ui/layout/` |
| Three.js Setup (§4) | Scene, renderer, lights, grid, `OrbitControls`, `TransformControls` | Rework into `scene/SceneManager`, `camera/BuildCamera` — behavior preserved, structure replaced |
| Dimension Labels (§5) | CSS2D live W/H/D inputs on selected mesh, edits trigger `resizeObject` via scale | Rework: becomes `ui/overlays/DimensionLabels`, but must stop driving geometry via `scale` — target system resizes by regenerating geometry from wall parameters |
| Material Assignment (§6) | `makeBoxMesh`, `applyMaterialTo`, material tab UI | Split: mesh creation → `geometry/GeometryFactory`; material tabs → `ui/catalog/MaterialCatalogPanel`; assignment → `materials/MaterialManager` |
| Object Management (§7) | add/select/outline/top-level lookup | → `interaction/SelectionManager`, `objects/ObjectManager` |
| Layer Panel Helpers (§8) | lock/hide/reorder/group/drag-drop tree, SVG icon set, outliner rendering | → `ui/hierarchy/Outliner` + `objects/ObjectManager`. This subsystem is generic and mesh-agnostic; it ports forward almost unchanged, it just needs to also list building entities (walls/rooms), not only free objects |
| Calculation Logic / BOQ (§9) | `meshMetrics`, `collectMetrics`, `summarizeMaterials`, `buildBOQReport` (HTML string) | **This is the core logic to preserve.** `meshMetrics`/`collectMetrics` currently derive volume/area from the *mesh* (world-scale bounding box) — this is exactly the "mesh as source of truth" anti-pattern the target architecture forbids. Target: same math, but computed from `WallData` (length×height×thickness), not from `Box3`. Report building (BOQEngine + BOQReport) separated from the material math (QuantityEngine) |
| Input Handlers (§10) | Position X/Y/Z fields | → `ui/properties/TransformPanel` |
| Undo/Redo/Copy/Paste (§11) | Full-scene JSON snapshot per action | Rework to command pattern (`history/CommandManager`) — snapshot approach kept temporarily as a fallback command (`SnapshotCommand`) during migration so nothing regresses, individual commands added per entity type over time |
| Save/Load (§12) | Flat mesh-array JSON, `version: 1` | Rework to serialize `BuildingModel` (nodes/walls/rooms/...), versioned migrations added (`persistence/`) |
| Event Listeners (§13) | Raycasting select, marquee multi-select, keyboard shortcuts | → `input/InputManager`, `interaction/SelectionManager`, `interaction/MultiSelection` |
| Animation Loop (§14) | `requestAnimationFrame` | → `scene/Renderer` |
| Viewport Toolbar / Quickstart (§15) | Move/rotate/scale tool buttons | → `ui/build/BuildToolbar`, tool objects implementing the `BuildTool` interface |
| Resizable Windows (§16) | Panel edge/corner drag-resize | → `ui/layout/` |

### 2.2 Key architectural gaps vs. target spec

1. **No parametric building model.** Walls are anonymous boxes; there is no
   `Node`, no `Wall.startNodeId/endNodeId`, no `Room`, no `Floor`, no
   `Opening`. This is the biggest gap and the reason "change wall length →
   room/quantities/BOQ update" doesn't exist yet.
2. **Mesh is the source of truth.** `meshMetrics()` reads geometry
   parameters and world scale directly off the `THREE.Mesh`. The target
   architecture requires the reverse: building data → generated mesh.
3. **No room detection** — rooms are not inferred from wall topology because
   there is no topology.
4. **No doors/windows as wall-attached entities** — openings don't exist at
   all; nothing subtracts opening area from wall area.
5. **No multi-floor support.**
6. **No dedicated Build Camera modes, no snapping system.**
7. **No texture/UV system** — materials are flat colors only, no maps, no
   real-world tiling.
8. **Undo/redo is snapshot-based**, not command-based; acceptable short-term,
   targeted for replacement in Phase 12.
9. **Everything lives in one file** — violates the modularity rule outright.

### 2.3 What must NOT be lost during migration

- The five material definitions and their exact BOQ formulas (concrete,
  brick, AAC, concrete block, interlock block) — these encode real มยผ.
  1101-64-referenced construction ratios. Formulas move file, not meaning.
- `summarizeMaterials` cross-category aggregation (e.g. cement appearing in
  both concrete and brick sections gets summed for a single purchasing
  total) — this maps directly to §34 Material Aggregation in the spec and
  should be preserved and generalized.
- The layer/outliner UX (grouping, lock, hide, drag-drop, reordering) — this
  is genuinely good generic scene-graph tooling and should keep working for
  furniture/objects even after walls become parametric entities.
- The panel windowing system (draggable/resizable/z-order) — reused as the
  shell for the new docked `ui/layout/MainLayout`, or kept as an interim
  layer if the docked layout is a later phase.
- Save/load compatibility — old project JSON must still open (via
  `persistence/ProjectMigration`, version 1 → current).

---

## 3. Migration Mapping (old → new)

```
script.js §2  MATERIALS                  → materials/MaterialLibrary.js
                                            calculation/calculators/*Calculator.js

script.js §4  scene/camera/lights/grid    → scene/SceneManager.js, scene/Lighting.js,
                                             scene/GridRenderer.js, camera/BuildCamera.js

script.js §5  dimension labels            → ui/overlays/DimensionLabels.js

script.js §6  makeBoxMesh/applyMaterialTo → geometry/GeometryFactory.js (wall geometry gen)
                                             materials/MaterialManager.js

script.js §7  object mgmt                 → objects/ObjectManager.js
                                             interaction/SelectionManager.js

script.js §8  layer panel                 → ui/hierarchy/Outliner.js (kept close to original)

script.js §9  calculation/BOQ             → calculation/QuantityEngine.js
                                             calculation/calculators/WallCalculator.js
                                             calculation/aggregation/MaterialAggregator.js
                                             boq/BOQEngine.js, boq/BOQReport.js
                                             ui/boq/BOQPanel.js (renders BOQReport, no math)

script.js §11 undo/redo                   → history/CommandManager.js (+ interim SnapshotCommand)

script.js §12 save/load                   → persistence/ProjectSerializer.js
                                             persistence/ProjectLoader.js
                                             persistence/ProjectMigration.js (v1 → v3)

script.js §13 input/events                → input/InputManager.js, input/PointerRaycaster.js

script.js §15 toolbar                     → ui/build/BuildToolbar.js + BuildTool implementations
```

New systems with no old-code equivalent (built from scratch per spec):
`core/`, `building/node`, `building/wall` (parametric), `building/room`,
`building/opening`, `building/floor`, `building/roof`, `building/stairs`,
`materials/texture`, `interaction/SnappingSystem`, `validation/`.

---

## 4. Phased Delivery Plan

Per the brief's own instruction, this is built in phases, each shippable
and tested before the next starts. Status column will be updated as we go.

| Phase | Scope | Status |
|---|---|---|
| 1 | Directory scaffold, `core/`, `EventBus`, `BuildingModel` skeleton, wired into existing app without removing current behavior | **done** |
| 2 | Node graph + parametric `Wall` entity (start/end node, height, thickness); wall tool creates real `WallData`, geometry generated from it | **done** |
| 3 | Build Camera modes + grid/node/wall snapping | partial — SnappingSystem (node/wall-midpoint/grid) done, camera modes not started |
| 4 | Room detection from wall graph | **done** |
| 5 | Doors/Windows attached to walls, opening-area deduction | **done** — OpeningManager, OpeningRenderer, click-to-place OpeningTool, BOQ net-area deduction |
| 6 | Floors (multi-level), ceilings, roofs | partial — FloorManager + multi-floor walls/openings/rooms done, ceilings/roofs not started |
| 7 | Material assemblies / surface layers | pending |
| 8 | Texture/UV + real-world tiling | pending |
| 9 | `QuantityEngine` fully decoupled from Three.js, fed by `BuildingModel` | **done** (walls + rooms; floors/roof/stairs not yet modeled) |
| 10 | `BOQEngine` consuming `QuantityResult`, BOQ UI reads report only | **done**, merged into existing BOQ panel |
| 11 | Furniture/object catalog | pending |
| 12 | Command-based undo/redo replacing snapshot approach | pending |
| 13 | Versioned save/load + migration from v1 project files | **done** — v1 bare-array/legacy saves normalize into `{version,building,legacy}` |
| 14 | UI layout refinement (docked layout vs. current floating panels — to confirm with user) | pending |
| 15 | Performance pass | pending |
| 16 | Test coverage + bug fixing | pending |

Each phase ends with: app still runs, existing BOQ numbers for
already-supported cases unchanged, console clean, doc file for that system
updated.

---

## 5. Open Questions For The User

1. **UI shell**: keep the current floating/draggable window system, or move
   to the spec's docked `MainLayout` (toolbar + left tools + viewport +
   right properties + bottom status)? This is a visible UX change — want
   sign-off before Phase 14 rather than assuming.
2. **Scope check-in cadence**: confirm after each phase before continuing,
   or batch several phases per review?
3. Any existing saved `.json` project files that must remain loadable, so
   Phase 13's migration path can be tested against real data?

Phase 1 will proceed now (scaffold + non-breaking `BuildingModel` skeleton).
Phases 2+ will each be delivered and checked in with you individually,
since each one is itself a substantial feature.
