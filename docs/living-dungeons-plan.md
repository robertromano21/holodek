# Living dungeons implementation plan

Date: 2026-10-07

## Outcome and scope

Expand the existing game: keep its accelerated renderer, narrative, combat,
scene textures, sprites, generated props, browser room storage, and quests.
Make named architecture into navigable spaces; make items and puzzles work
through both graphics and text; give inhabitants independent, visible actions;
add a limited supply of new encounters after initial construction.

Initial estimate: 1-2 hours for investigation/design, then approximately 2-5
development days for the phases below, including playtesting. This is a planning
estimate, not a promise that every puzzle/architecture family fits one session.

## Evidence from the current project

- The latest diagnostic snapshots include a 32x32 Ruined Temple Entrance and
  512x512 outdoor rooms. A local structure must not scale to hundreds of tiles
  just because the surrounding wilderness is large.
- `sceneSpec.js` and `levelSpec.js` extract architecture, materials, structures,
  and layout hints. `applyLevelSpecToScene` mostly turns structures into props.
  `buildDungeonFromBlueprint` independently creates rooms, terrain, and paths.
- The Sunscorch Expanse snapshot is classified as a temple despite its outdoor
  name and description. Figurative references to sanctums or Mortacia's throne
  are not sufficient evidence to build a literal temple or throne.
- `placeSceneObjects` writes `sceneObjects`. `checkSceneAgainstDungeon` currently
  reads `props`, falsely reporting every placed inventory object as missing.
- Both generation branches finish layout, doors, torch walls, and props before
  finalization and geometry stamping. New geometry must be finished there too.
- `assets/game.js` contains several separate take/drop paths, inventory arrays,
  console strings, and room history updates. Scene visibility also depends on
  the latest console. A second inventory implementation would duplicate items.
- Puzzle generation currently asks for an environmental paragraph, then asks
  separately for a challenge and solution. There is no validated executable
  puzzle contract or solver. Changing the prompt alone cannot ensure solvability.
- `server.js` disables its 45-second NPC autonomy timer explicitly because it
  caused items to respawn after taking/equipping them. Server directives exist,
  but the main game client has no corresponding directive handling.
- The server has a process-global shared state, while the browser owns persistent
  rooms/history. This is a single-player session assumption, not multiplayer
  isolation. Scope future events to the active run and room before enabling them.

## Invariants

1. Cells are the sole source for visible walls, floor heights, and collision.
   Architecture edits occur before finalization, never inside a renderer.
2. Keep the WebGL pixel-unpack fix and existing GPU readback regression tests.
3. Finish and validate a room before delivery. Browser cache stores the finalized
   geometry and subsequent gameplay state; diagnostic snapshots are not saves.
4. Every interactable has a stable ID, reachable approach tile, and an explicit
   state. Descriptive names alone cannot identify transfers or rewards.
5. Pickup, text commands, and NPC actions use the same state transition functions.
6. Every action includes run ID, room ID, revision, actor ID, and action ID.
   Reject stale-room actions and deduplicate retries before awarding anything.
7. Model output supplies descriptions and candidate intentions. Code validates
   actions, costs, targets, reachability, inventory changes, and completion.
8. Preserve exits and retreat routes. Failed plans leave existing cells intact
   and log a concrete rejection reason.

## Phase 1: connected architecture and trustworthy diagnostics

Implement a bounded architecture compiler for temples, ruins, and catacombs.
Use the room name first, then grounded structural descriptions and appropriate
indoor classifications. Unknown/unsupported spaces keep the existing layout.

Compile into existing floor/wall/pillar cells: temple nave and side chapels,
ruined courtyard and broken partitions, catacomb spine with burial chambers.
Keep a protected route through each structure, and publish named anchors for
altars, tombs, clues, and encounters. Place original landmarks around those
anchors. Connect to existing walkable space and validate height-aware reachability
before committing edits. Add architecture reports to room snapshots.

The current heightfield renderer supports one floor and ceiling per XY cell.
True stacked floors, bridge-over-passage geometry, and complex overhangs require
a separate renderer project. Use connected spaces and supported height/voxel
features for this expansion; never depict an opening that collision blocks.

Acceptance: existing exits/doors/objects survive; spawn and required anchors
remain accessible; reserved passages survive prop placement; outdoor changes
stay within a bounded footprint; serialized rooms keep identical geometry;
GPU tests pass; room logs report build/fallback and measured connectivity.

## Phase 2: authoritative interactions and automatic pickup

Introduce a pure room-state reducer with versioned actions, a browser persistence
adapter, and a server mirror for narration. Keep geometry and mutable gameplay
revisions separate so taking an item never rebuilds terrain.

Migrate take/drop/equip operations onto this reducer, including item properties,
quest artifacts, console projections, and the existing browser room history.
Reconcile legacy saves once. Do not parse names from prose to restore consumed
items. Keep IDs distinct for two copies of the same item.

When player movement enters an item's pickup radius with clear reachability,
dispatch the same pickup action used by text `take`. Show a small feedback
message, remove the item in both views, persist immediately, and notify the
narrative system without requesting a model response per frame. Preserve current
guarded-item restrictions unless explicitly changed. Fixed scenery and puzzle
fixtures are inspected/used, never automatically pocketed.

Acceptance: one award per item, properties preserved, no remote/through-wall
pickup, no respawn on revisit/reload or concurrent narration, drop/re-pick works,
quest notifications occur exactly once, and combat map movement works too.

## Phase 3: executable graphical puzzles

Create a finite catalog: switch networks, ordered symbol mechanisms, item
receptacles, and later pressure plates/escort or social objectives. Generate a
typed puzzle specification BEFORE prose, including component IDs, initial state,
legal actions, visible clues, completion predicate, and one-time rewards.

Compile fixtures and approach points into room anchors. Run a bounded solver
over the action state graph and the tile reachability graph. Reject plans with
missing keys, keys behind their own locks, unreachable switches, unrecoverable
wrong sequences, or impossible mandatory NPC requirements. Keep reset paths.

Generate prose from the accepted puzzle and actual room manifest. Unsupported
literary riddles remain optional narrative content, never mandatory invisible
mechanics. Text commands and graphical interactions dispatch identical actions.
Separate local puzzle completion from the existing 15-quest campaign progression
so optional puzzles cannot accidentally finish a main quest or duplicate XP.

Acceptance: solve every template in tests, persist partial progress, incorrect
actions give useful feedback, repeat completion gives no extra rewards, every
named required fixture is present in 2D/3D, and no essential exit is soft-locked.

## Phase 4: independent inhabitants and bounded population

One room simulation owns actor intentions, item transfers, puzzle events, and
spawn budgets. It must not call the entire Retort story pipeline on every tick
or merge a newly invented Objects in Room list over current inventory.

Use a fixed simulation step with capped catch-up. Pause inactive/hidden sessions
and do not simulate all 1000 rooms per frame. Actor states: idle, patrol, guard,
investigate, approach, converse, assist, pursue, flee. Give NPCs goals and
allegiances. Movement uses the same cells and collision, with bounded pathfinding
and cached routes. Hostility/line of sight trigger the existing combat resolver;
never create a second damage system. Party-follow orders take precedence.

Actors can initiate greetings, approach points of interest, react to noises,
defend a gate, or request help without a player prompt. Important actions emit
bounded event records. The model can occasionally propose intentions/dialogue;
apply only validated intentions matching the current run/room/revision. Rate
limit incidental dialogue so the game log remains readable. Do not auto-spend
player items or complete player-choice puzzles on the player's behalf.

Post-generation seeding uses explicit triggers (elapsed active time, cleared
encounter, puzzle event, exploration) with separate simultaneous and lifetime
budgets for ordinary loot and monsters. Initial proposed limits: 8 active and
12 lifetime supplemental monsters; 8 active and 12 lifetime supplemental items,
adjusted down for small rooms. Existing/generated quest entities are counted for
crowding but never silently deleted to satisfy a new budget. Cooldowns, safe
distance from player/party, walkable connected spawn points, and combat locks
prevent arrivals inside actors, behind sealed doors, or every frame. No random
quest artifacts, mandatory keys, or essential allies. Save budgets and spawn IDs.

Acceptance: activity without prompts, matching visible positions in both views,
no idle model-call storm, bounded populations across revisits, no resurrection
of collected items/dead monsters, actor collisions respected, stale responses
discarded, and existing combat remains authoritative.

## Phase 5: narrative fidelity and rollout

Have final prose describe the validated manifest. Record requested, represented,
unsupported, and rejected features separately. Expand vocabulary with new tested
templates, rather than pretending every metaphor is physically buildable.

Add a small diagnostic scene suite: temple, ruined courtyard, catacomb, outdoor
ruin, item transfer, locked reward, autonomous patrol and reinforcements. Compare
fresh generation, cached revisit, and room transitions. Log plan version, seed,
actor actions, puzzle transitions, rejected actions, spawn budgets, geometry
stamp, and GPU consistency. No full-grid logging or allocation per movement frame.

Track frame-time percentiles and construction time on the existing 512x512 maps.
Use generation-time indexes and local work budgets. Validate before optimizing;
avoid restoring the row-flip bug through a different texture upload path.

## Delivery status

Room transport now sends changed room entries after the first state sync, with a
full browser resync when the server requests it. JSON state uploads have a bounded
32 MB allowance; failed acknowledgements stop commands before Retort runs against
stale coordinates. `[StateSyncAccepted]` records destination, request bytes and
changed-room count; `[DungeonEntry]` records whether a dungeon is built or reused.

Each finalized new game starts a new dungeon run ID. Server dungeon/music mirrors
reset, and IndexedDB dungeon keys include that ID. Revisited rooms persist within
the current game; earlier games' layouts are discarded. A completed room displays
even if its cache write fails, and missing browser rooms can be recovered from the
server's current-game mirror.

The current working implementation includes the Phase 1 architecture compiler,
server-owned clicked d20 requests, party roster parsing (including recruited
monsters), spatial attack guards, and a first physical door interaction path.
Dead trees, gravestones and furnaces have dedicated voxel occupancy shapes in
the existing renderer; their sprites remain available to the map and fallback.
Environmental cue metadata is generated from actual placed features.

This is a foundation, not completion of all five phases. Automatic pickups,
general executable puzzles, autonomous inhabitants and post-generation seeding
still need their respective reducers and integration tests. Out-of-reach attacks
currently hold rather than implementing new approach AI. Generic noncombat
outcome narration remains the legacy model-driven path, not a universal physical
simulation. Enabling the old autonomous timer is not Phase 4.

See `tartarus-encounters.md` for description-grounded encounter designs, journey
gear (including a self-tying rope), recoverable failures, and the repairable
ravine bridge. These are explicitly staged behind persistent interaction and
inventory support rather than presented as already playable encounters.

## Supported Roofs And Monuments

Roof construction now precedes prop scatter in normal and dungeon-test generation.
The same committed cell grid contains grounded supports; reserved aisles, exits,
torch mount heights and floor heights remain protected. Unsupported or disconnected
bays are rejected and recorded in `sceneRoof.rejected`, rather than rendered floating.
Classical orders are chosen from prose (Doric by default, Ionic or Corinthian when
named); medieval halls use braced timber posts and trusses; Gothic halls use clustered
piers and diagonal ribs. Pediments crown paired-column entablatures, not lone pillars.
A described shrine adds a walk-through side canopy. Described rotundas use a circular
plan, column-supported drum and hollow voxel dome with an oculus.

The GPU renders roof shells, beams, ribs, pediments and domes as ordinary voxel
instances in the existing mesh pass; overhead parts are not ground obstacles.
The original world, sprite and voxel shader definitions are retained. Ceiling DDA
and material-atlas shader additions were rolled back while investigating a Windows
hardware program-link stall; their design files remain available. WebGPU presents the complete legacy GPU
scene for these structures, as it already does for roofs, until its native world pass
can represent them. Obelisks now use tapered, pyramid-tipped solid voxel geometry.
`sceneStructures` and roof profiles are included in geometry stamps and diagnostics.

Environment Lab includes temple/shrine, Gothic vault, rotunda and obelisk exhibits.
Use a new campaign or newly generated room for in-game inspection; existing saved
layouts are not replaced wholesale. Tests cover connectivity, supports, shared roof
edges, serialization, preserved torch/exit data, column routing and GPU upload data.
The browser GPU probe also compiles the production shaders. `node tests/run-gpu-probe.cjs`
uses an isolated browser profile for hardware timing; `--software` tests SwiftShader,
and `--blank` is a browser-launch control. Renderer startup stages are sent to the
existing diagnostic endpoint without a GPU readback. Automatic room-upload checks
compare CPU data only; manual `debugDungeonRendering()` retains GPU readback.

Architectural references: [Met: classical orders and entablatures](https://www.metmuseum.org/de/essays/architecture-in-ancient-greece)
and [V&A: Gothic ribs, pointed arches and supports](https://www.vam.ac.uk/articles/the-gothic-style-an-introduction).

### Architecture deployment (roof compiler v4)

Named temples, gatehouses, baths, catacombs and rotundas now imply localized,
style-appropriate roofs even when prose omits a ceiling keyword. Courtyards and
temple naves remain open unless explicitly described as covered. Explicitly
roofless descriptions still take precedence. Temple entrances request a compact
walk-through shrine with capitals, entablatures, pediments and a pitched roof,
plus a compact, column-supported rotunda where the existing layout permits it.

Outdoor ruin/altar context (including puzzle descriptions), or wasteland/desert/
ruins/volcanic biomes, requests at most three small, separated architectural clusters:
a shrine, an open portico and a hollow-domed rotunda with an oculus. Rotundas can
incorporate existing scenery without moving it; their interiors must remain reachable.
A paired threshold carries a pedimented entrance when two grounded supports fit.
If no rotunda fits, the compiler falls back to small shrine sites. Site selection is bounded
around spawn, requires connected, nearly level terrain, preserves existing props,
doors, exits and reserved paths, and never carves or flattens the landscape.
Sites adapt to smaller footprints where necessary; unsafe placement is logged,
not forced. Only the grounded supports become shared collision cells. Existing
columns can be incorporated rather than adding unrelated pillar farms.

`sceneRoof.shrines` and `sceneRoof.rotundas` record requested/placed counts and selection evidence;
`roofEvidence`, bay locations, overhead parts and rejection/support details appear
in the existing construction logs and final snapshots. Tests and replay of the
Oct 8 starting-temple/Whispering-Dunes snapshots verify terrain, torch preservation
and connectivity. Restart the server and use a new campaign to inspect new layouts;
existing campaign snapshots are not overwritten as part of deployment.

### Indoor complexes and modular architecture (v5 roofs / v4 floor plans)

Indoor classification now drives a second roof-planning pass over actual connected
floors, including unnamed halls and corridors. Named architectural bays, shrines
and rotundas retain priority. Courtyards and explicit whole-building roofless prose
stay open; a locally roofless courtyard does not disable roofs in neighboring halls.
Ruins retain a coherent opening instead of arbitrary holes across all ceilings.

Infill uses existing walls and piers where possible. Narrow corridors may span
opposing masonry walls without adding floor-blocking columns. Masonry extensions
above torch-bearing walls leave torch height, identity and mounting data unchanged.
Unsafe supports remain rejected atomically. `sceneRoof.coverage` reports connected
eligible/covered/uncovered floors, ratio, the 75% target, target achievement, open
zones and planning-limit exhaustion. Coverage is a target, not permission to block
routes or overwrite protected scenery. The bounded infill queue stops at 192 bays
and reports the limit if reached; large maps may need coarser bays in a later pass.

Added stylized, deterministic voxel geometry for pendentive/squinch dome transitions,
groin and fan vault shells, hammerbeam trusses, boarded ceilings, gold coffers,
flying buttresses and timber palisades. These use the legacy mesh renderer and the
same 64-tile voxel range as existing columns. No world or voxel shader rewrite.

Castle floor-plan variants now include a gently ramped motte/wooden keep, circular
shell keep, rectangular stone keep and concentric curtain walls with differentiated
wall heights. Roman plan families include oval amphitheaters, semicircular theaters,
chariot tracks with spina, forums, colonnaded civic basilicas, horrea/storage blocks,
atrium houses, villa courts, insula ground floors and infrastructure arcades.
These are bounded walkable prototypes, not complete cities or multi-storey physics:
insula upper floors, water transport, full bridge crossings and city district linking
remain future extensions. A classical shrine can sit within a medieval castle complex.

Missing-room description prompting now supplies the physical architecture vocabulary,
while retaining the original room name, lore, inventory and exit-generation stages.
Environment Lab exposes the new building and ceiling exhibits through the existing
dropdown. New campaigns/rooms use the expanded compiler after a server restart;
existing campaign snapshots are not overwritten for deployment.

References informing the stylized modules: [Columbia's medieval vault discussion](https://projects.mcah.columbia.edu/medieval-architecture/htm/sr/ma_sr_discuss_dc_structure.htm),
[King's College Chapel and its fan vault](https://www.kings.cam.ac.uk/kings-college-chapel-1515),
[English Heritage's castle forms](https://www.english-heritage.org.uk/castles/castles-through-time/),
and [Roman building typologies](https://www.worldhistory.org/Roman_Architecture/).

### Close-camera clipping and voxel movement

The legacy voxel vertex shader relocated individual behind-camera vertices to
a fixed screen corner. Triangles spanning the camera plane could therefore create
large phantom wedges alongside props and under ceilings. Its projection now uses
signed homogeneous coordinates and a 0.02 near plane; GL clips intersecting triangles.
World and voxel fragment shaders remain the legacy versions. The browser probe
draws a crossing triangle and compares it with a positive control reproducing the
old teleport behavior. `--software --summary` reports clipping pixel counts without
dumping every initialization event.

`assets/voxelCollision.js` uses the same 16-cubed shape grids and world scaling as
the renderer. Cached standing-body cross-sections allow movement beneath tall arches
and around their posts, between suitably spaced new columns, and around irregular
solid props. Low column plinths retain the existing step/squeeze convention; large
plinths and low arches still obstruct. Legacy pillars and unrecognized meshes keep
their existing circular fallback. Explicit nonblocking primitive intent is retained
by scene construction, while blocked/obstacle flags take precedence.

Game movement, collision diagnostics and Environment Lab share this shape-aware
path. Overhead scene parts do not become floor obstacles. This is not full rigid-body
physics or a change to NPC combat navigation; conservative tile-based server pursuit
still avoids prop cells. No room regeneration is required for existing recognized
voxel props to use the client fix after reloading.

### Elevation, gateways and exterior silhouettes (v5 plans / v6 roofs)

Column families now retain forgiving shaft clearance while a separate, cached
voxel-base sampler supplies local footing. Crossing a low plinth raises the eye
target to the actual base surface, including where a wide base reaches into an
adjacent tile. The shared cell floor does not change. Movement and diagnostics
reject a base exceeding the existing step limit; this is automatic stepping, not
an implemented climbing/rope action. `debugDungeonPosition().standingSurface`
identifies the supporting plinth, and blocker diagnostics report excessive steps.

Listed compass exits request three-cell gateways with connected exterior approaches.
Diagonals use corner vestibules and orthogonal walking routes. Up/down are not
invented cardinal gates. Existing doors, torches and interactive objects remain
protected, and an unusable gateway is recorded instead of forced. Successful
bounded building plans keep their surrounding exterior under the sky; connected
interior roof coverage is still measured separately. Paired existing masonry
supports carry gateway lintels, with classical north/south pediments where suitable.
Existing shell walls receive cornices or castle battlements, not new pillar scatter.

Wall and roof builders share a bounded height profile. Temples, basilicas and rotundas
have higher default spans; physically described lofty halls increase headroom.
Supports follow the roof spring height. Temple/basilica sanctuaries have shallow
quarter-unit stair treads and a raised podium in the same cells uploaded to the GPU.

An up/down exit also requests a three-wide stair wing: two six-tread flights with
an intermediate landing, rising or descending 4.2 units in total. The exit marker
belongs to the final landing, not the ground-floor stair mouth. Only new modular
partitions/posts may yield to the route; existing scene content is preserved.
Each stair wing commits atomically after reachability checks, independently of the
base building and opposite wing. Insufficient room or protected scenery produces
an explicit rejection in `sceneArchitecture.verticalRoutes.rejected`.

`sceneArchitecture` records entrances, exterior zones, height evidence, terraces,
requested vertical exits, stair flights and landing heights. `sceneRoof` records
gateway supports/rejections and facade part counts. Existing construction logs and
snapshots include these fields automatically. The isolated Environment Lab's
"Citadel stairs & elevated landings" exhibit exercises both directions and shows
floor height and exit markers in its inspection readout.

These are real elevated terrain surfaces, still limited to one walkable height per
horizontal tile. A stair wing is not a stack of overlapping storeys, and these exit
markers do not change the existing command-based room-travel rules. Next work for
true balconies and multi-storey towers needs layered walkable surfaces, per-layer
actor/navigation state, headroom and fall rules, and matching 2D/GPU diagnostics.
That extension must support walking underneath an occupied upper floor rather than
presenting a decorative canopy as a traversable level. No renderer rewrite was made
for this stage. Restart the server for new-room generation and the new lab exhibit;
reload the game page for the plinth movement changes.

### Outdoor geography and destination-aware approaches

Adjacent-room skeletons already carry indoor/outdoor classification. New-room
construction now reads that existing metadata through the exit's target coordinates,
without generating a neighboring dungeon or changing its stored state. Known outdoor
summits select a mountain approach; descending to an outdoor destination selects a
canyon approach; descending to an indoor destination selects a cave approach. Unknown
destinations retain a portal plan rather than inventing an indoor/outdoor classification.
Explicit floating/celestial destinations retain a celestial-stairway plan.

`retort/sceneGeography.js` constructs bounded mountain/canyon heightfields from ordinary
floor cells near spawn. Terraced banks have genuinely impassable steep faces under
the existing step limit, while three-wide graded approaches connect the summit or
lower landing. Demonstration terrain reaches +8/-7 units; smaller sites scale down.
It preserves the spawn area, existing props, torch walls, doors, fixtures, reserved
architecture and their surrounding cells. A reachability check rejects unsafe
deformations; smooth relief is attempted if terraces would strand existing terrain.
The compiler operates before prop scatter in normal and dungeon-test generation,
and never changes the renderer or creates a second collision map.

Boulders and rock faces now have actual solid voxel meshes. Prose with mountains,
canyons or escarpments, and known vertical approaches, requests a small additional
rock set without replacing existing landmarks. These props remain obstacles: they
do not automatically become climbable footing like column plinths. Climbing gear,
rock climbing and traversable suspended stairs remain future mechanics.

`sceneGeography` logs heightfield features, actual endpoint heights, requested
destination type, reachability counts, rejected sites and deferred portal/celestial
modules. The existing snapshots include the exact modified cells. The isolated
"Mountain & canyon heightfields" lab exhibit exercises both routes with real rocks.
Cave approaches currently model the descending terrain and reserve its endpoint;
cave-mouth furnishing, animated portals, reciprocal entry placement and proximity-
based travel still need their own modules. No new model calls, server-side room-save
files, or early construction of unvisited rooms are introduced by this stage.

#### Geography deployment correction (compiler v2)

The Oct 8 `1,0,0` snapshot confirmed a working -7 canyon at `(233,384)`, but no
mountain: abstract room prose and a down-only exit supplied no positive-relief request.
Its blueprint copied the shallow 1.2-amplitude schema example and flattened the
spawn road, so the descending feature did not create a visible mountain silhouette.
Outdoor world-profile uplands now provide a bounded positive-relief request when
the prose is abstract. Explicit plains/flat ground, wetland and urban profiles do
not receive this background mountain; the isolated prop galleries opt out too.
These are background terrain features, not invented up exits.

Geography preparation runs after level-spec composition, before sprite construction,
and consumes physical puzzle/level-detail text as well as the room description.
`terrainPlan` and `sceneGeography.requestPlan` record the profile, selection evidence
and whether a feature actually serves an exit. An in-memory replay of the original
512-square blueprint retains its canyon and adds +8 uplands at `(279,384)` without
changing the reachable tile count. Previously stored geography, including v1 rooms,
remains authoritative; deployment applies to newly constructed rooms.

Landmark placement also now resolves exact custom types before sprite-drawer aliases.
The same snapshot requested two `rock_face` landmarks but placed two additional
`boulder` tiles, because both use the boulder sprite drawer. Exact lookup retains
the correct voxel shape; missing canonical shapes are reported instead of silently
downgraded. Regression tests cover both tile-registration orders and the production
outdoor blueprint path, not just the idealized flat lab grid.

### Outdoor variety, physical travel and quest-directed planning

This incremental pass preserves the old GPU renderer's shaders, existing room
generation stages, combat rules, browser campaign cache and bound boss locations.
It does not implement the complete regional campaign or every interaction phase.

New outdoor construction adds seven leafless voxel families: pale hollow trees,
split snags, wind-bent trees, dead willows, skeletal pines, twisted yews and
rootbound trees. Deterministic branch seeds vary each family's silhouette; render
geometry and body collision use the same seed. Thorn bushes, bramble patches and
ash reeds supplement them. Bounded patches preserve objects, heights, roofed
areas, spawn and reserved routes; explicit treeless descriptions remain treeless.
Placement is a construction-time batch, not a per-frame procedural scan.

Console exits now have reachable shared markers, combat-map labels and an
orientation compass beside the command prompt. Approaching the actual marker
invokes the original exit popup and Go/Unlock/Cancel commands. Floor height and
line of sight prevent prompts through walls or from below a landing. New exits
update markers without replacing the dungeon. Unknown vertical destinations
still use a portal landing, not an invented mountain, cave or staircase.

Known indoor destinations can request outdoor building shells. The return to
the Ruined Temple is prioritized. Each bounded shell has actual wall cells,
canonical voxel roof/facade parts, one three-wide entrance and a reserved
two-wide walking ring around its perimeter. The travel marker moves to the
doorway. Campaign seed plus complex/site identity determines the template,
independently of the source room or viewing direction. Unsafe or occupied sites
are rejected atomically instead of moving existing scenery. Current limits are
two buildings, 21-tile footprints and an absolute top of 18 units. Selected
coarse exterior parts use a 192-tile skyline range; ordinary props keep their
existing 64-tile range. This is a local navigable exterior, not yet the enormous
multi-district Temple complex or Hades skyline envisioned for the full campaign.

Outdoor continuation supplements the existing exit generator only if no open,
unvisited, deeper outdoor neighbor already exists. It adds at most one new route,
does not replace indoor destinations or locks, excludes the room just left and
visited circuits, and protects reserved boss coordinates. A fully occupied
frontier reports that no safe addition is possible rather than altering a room.

The Grave Master has an optional bounded environment-intent prepass before
uncreated adjacent rooms receive names. It selects from physical templates and
uses the current quest's tasks and existing boss/artifact binding as context.
Known rooms and boss destinations are not renamed or reclassified. Only tasks
whose placements refer to the room become scene-construction affordances;
construction cannot complete a quest or duplicate its actors, items or rewards.
Complex identity and indoor/outdoor connection types support later regional
planning without requiring generation of every future room in advance.

Quest adjudication now retains bounded factual partial-progress checks, separately
from model narrative: exact inventory membership, room placement, live monster HP
and actual opened exits. A puzzle result is bound to the task it adjudicated, so
it cannot complete the next task. The existing three-step progression ends with
the original boss-defeat task. The immediately preceding step retrieves a unique
seal key; all known approaches to the bound boss room use that key through the
existing lock/unlock system. The key is seeded only after the preceding task,
outside the boss room on a reachable approach graph. Ordinary discovery output
cannot invent that reserved seal. Picked-up keys are not respawned, and a gate
already opened with that seal is not relocked on the next turn. Progress checks
do not invent XP awards; the existing action adjudication owns reward commits.

Quest/discovery items added to a cached room must synchronize item positions only,
without rebuilding walls, terrain or existing props. Exact room/name matching is
required. Automatic pickup and a unified inventory reducer remain Phase 2 work;
this synchronization is not a second inventory implementation.

Test the additions in Environment Lab's deadwood and outdoor temple-return
exhibits, then restart the server and start a fresh campaign for production
generation and the new prerequisite sequence. Do not delete diagnostic snapshots
or migrate an already-built room by regenerating its geometry. Logs include
`[SceneVegetation]`, `[SceneExteriors]`, `[OutdoorContinuation]`, `[WorldContext]`,
`[EnvironmentIntent]`, `[BossGate]`, `[BossKeyTask]` and `[QuestProgress]`.
The deeper-cliff/canyon/river expansion, animated flow, climbing gear, reciprocal
regional entrances and true multi-storey traversal remain next implementation
work; the current +8/-7 geography limits above have not been removed in this pass.

### Dense-pillar performance correction

The latest Whispering Ashlands diagnostic has 3,739 legacy pillars. Its blueprint
requested a `tile: pillar` volume of normalized width/height 0.12, which the old
rectangle filler interpreted as a separate column on every cell of a roughly
62-square area. A 33-square sample alone contained 1,089 pillars; this was not a
designed temple or the new vegetation system. The renderer submitted each column
through its existing depth, base and detail passes.

New pillar volumes now mean bounded, spaced colonnades. The compiler limits their
footprint to 24 tiles and defaults to at most 36 columns, with three-tile spacing.
It preserves terrain heights, spawn, protected scenery, reserved routes and local
height-aware connectivity. Ordinary wall/floor/door volumes and existing saved
rooms are not rewritten. `pillarVolumes` snapshots and `[BlueprintPillars]` logs
record requested bounds, actual bounds, caps, placements and skipped sites.

Renderer-only changes also apply after reloading an existing room. Whole-volume
frustum checks skip off-screen voxel submissions without changing visibility
distances, near clipping, voxel meshes, collision or shader programs. Large roofs
and arches crossing the camera/viewport stay visible. Column depth/base/detail
triplets retain their original order. The room floor minimum is reused from the
geometry upload rather than scanning every cell per frame, and stable texture
atlases are not redrawn each frame. Image identity/readiness/source/revision changes
still invalidate texture resources.

Pillar/torch line-of-sight results are cached by room geometry and exact target/light
positions, with a bounded target cache. New torch-window membership reuses known
visibility but checks new lights. Updated geometry invalidates occlusion. Current
flicker intensities, radius filtering, nearest-light ordering and shader surface
shadows remain active. No player-camera visibility test substitutes for visibility
between the prop and its light.

`debugDungeonPerformance()` returns the latest CPU submission timings, visible and
culled voxel counts, draw/triangle counts and torch-cache/LOS counters. Dense/slow
frames send throttled CPU-only reports through the existing rendering diagnostic
endpoint, with reason `renderer-performance`; no synchronous GPU readback or fence
is introduced. These figures diagnose submission work, not GPU execution time.

### Campaign Variation and Indoor Scale

New indoor grids have a 64-tile minimum instead of defaulting to 32. Larger
classifier requests are honored up to 192; outdoor grids keep their existing
512-tile cap. Fallback chambers scale with their parent grid rather than leaving
tiny cells scattered across a larger map.

Construction now carries a campaign-and-coordinate generation seed separate from
the semantic prose hash. Normal and dungeon-test flows both pass it to blueprint
generation, and code replaces repetitive designer seeds with this authoritative
seed. Room and fallback layout choices, landmark/object positions and vegetation
use it. Small brightness/warmth variations retain the described material palette;
cached semantic level specifications do not force identical visual tones.

New seeded indoor architecture expands beyond the old fixed 19-by-23 footprint,
with bounded proportions, varying sanctuary depth and spaced colonnades. Temple
complexes include connected side-chapel passages and, for ruined temples, an open
sky courtyard. The temple entrance's shrine uses a classical pillared pediment
even when the surrounding complex uses Gothic architecture. Existing roofs,
rotundas, stairs, doors, interactive scenery and reachability checks remain active.

These rules apply only at construction. Browser campaign caches and saved room
geometry are not resized or regenerated on revisit. `[DungeonBuild]` diagnostics
include generation identity, requested/actual grid sizes, material tones, indoor
chamber bounds and the architectural plan so repetition can be checked directly.

### Outdoor Variation and Navigation

New outdoor heightfields use campaign/coordinate-seeded broad ridges, rotated
basins and rolling ground instead of repeating the fallback sine landscape.
Flat plains, wetlands and urban settings retain their stated character. Spawn
transitions are gradual, and the existing terrain, blueprint, exit and scenery
compilers continue to share the same cells. Geographic approach searches also
vary their first orientation by campaign seed. Saved rooms are not regenerated.
`outdoorTerrain` in construction snapshots records the chosen profile and features.

Compass badges show direct bearings to the actual physical exit markers, including
building entrances and up/down landings. A dropdown selects a particular exit;
otherwise the nearest exit is highlighted, with distance in tiles. These controls
do not teleport or issue commands. The existing Go/Unlock/Cancel popup still
appears below the Game Console when the player reaches the threshold.

The Map menu item opens a north-up overhead map with local/whole-level views,
zoom, drag panning and player-follow. Nearby terrain is discovered using local
wall/closed-door occlusion checks. Known exits remain visible as waypoints without
revealing surrounding terrain, loot or actors. Exploration masks are bit-packed
(32 KiB for a 512-square room) and stored in a separate campaign-keyed browser
IndexedDB database. Hydration merges concurrent discoveries; memory holds at most
eight room masks, and writes are throttled. Mapping never alters dungeon geometry
or server game state. Previous-campaign masks are discarded when a new run starts.
Bitmap updates are incremental after initial paint. A small golden parchment
shortcut beside the command prompt opens the same map as the menu item; its
placement accounts for CSS zoom and the visible Game Log.
The map opens centered in the space above the command prompt, between the side
panels where screen width permits. Its canvas fits the available vertical space.

Top-level controls share a collapsible hamburger disclosure, with their original
IDs and action handlers retained. Combat Map opens top-left beneath the menu
button; Game Log opens bottom-right; Game Console retains its original placement.
The three panels automatically open once the first playable dungeon arrives in
each run, respecting No Combat Map mode. User-closed panels stay closed afterwards.
`node tests/run-dungeon-ui-probe.cjs` checks the real CSS and UI modules in an
isolated headless browser profile; `--narrow` exercises narrow-screen placement.

### Startup Population Gate

Normal room population retains the existing description, item/modifier, XP,
neighbor, monster and puzzle sequence. Its gate checks missing exit directions,
not the count of comma-separated adjacent-room entries: `Adjacent Rooms: None`
and unnamed placeholder destinations cannot satisfy an exit. A literal `None`
description also requires initial generation. Already populated/described rooms
repair missing neighbors separately without re-running current-room population.
Original startup boilerplate still triggers the complete existing sequence.
Defeated monsters never cause repopulation. `[RoomPopulation]`
logs the decision and completion summary, distinguishing skipped generation from
client display failures. Dungeon Test starts OFF on each page load, including
when a previous page saved ON; manually enabling it remains available.

Startup sheets retain the original `game.js` plain-text templates: 14 fields per
character, the original PC/NPC indentation, and contiguous NPC blocks. Room XP
allocation ignores blank separators from previously serialized sheets and never
calls `trim()` on a missing stat value. Adjudication accepts the original first
NPC on the `NPCs in Party:` line without reformatting sheets. Regression tests
use the seven-character party from the failed startup and compare serialization
directly with the existing in-game templates; no structured transport replaces
the console round trip.

### Graphical Inventory and Pickup

The pack shortcut above the parchment map opens an inventory grouped into
Weapons, Armor, Shields and Other. Item sprites can be dragged onto PC/NPC dock
icons, or selected and then assigned by clicking an avatar. These are shortcuts
to the original Game Console handlers and confirmation popups, not a separate
equipment system. The original text commands remain the only mutation path.

An occupied slot first opens the original Unequip confirmation for that character.
Only after its command succeeds and the console refresh confirms the empty slot
does the original Equip popup open with the character selected. Canceling either
step sends no further command. Direct text equip refuses an occupied slot rather
than stacking modifiers; explicit text unequip/equip still works normally.

Approaching an item in 3D opens the original Take confirmation when within reach,
at a compatible elevation, and unobstructed by a wall/closed door. Cancel suppresses
repeated prompts until the player moves away. A confirmed Take updates the console
and removes that item through scene-object synchronization without rebuilding
room geometry. Inventory and map panels close each other to avoid overlap.

### Designer-Owned Layouts and Modules

The indoor blueprint is authoritative. Its initial construction now preserves
authored chamber bounds, roles, elevations and corridor graphs, rather than
adding a stock spawn hall or overwriting the complex with an architectural rectangle.
Only missing corridor connections are repaired. The LLM receives the room prose,
planned scenery, architectural family and exits, with up to 6144 response tokens
indoors and 4096 outdoors instead of the old 350-token blueprint allowance.

The existing templates remain available as bounded modules within selected
chambers: temples, basilicas, castles and their variants, rotundas, baths, catacombs,
Roman civic/domestic structures and arcades. Smaller sections can be composed
independently: porticos, shrines, colonnades, vaulted bays, domed bays, raised
sanctuaries, courtyards, terraces, galleries and stair flights. Full temple modules
retain their stepped sanctuaries; full modules retain the existing safe up/down
stair-wing checks. Section placement uses room-relative x/y and tile-sized bounds.
Occupied sites or changes that would disconnect routes are rejected atomically.

Roofs follow actual floors and chosen bay styles; supports are grounded columns,
piers or walls of the required height. Existing maze partitions, reserved walking
routes, doors and interactables are preserved. The Ruined Temple Entrance requires
a pillared pediment; omitted/rejected porticos get a seeded safe-site placement
attempt before roof infill, not a replacement room. Locations vary by campaign.
The renderer still supports one walkable surface per XY cell, not overlapping
stacked floors. Old cached campaign rooms are not redesigned on revisit.

Outdoor blueprints can specify initial ridges, mountains, cliffs, basins/canyons,
paths, scenery coordinates and local building foundations. Seeded backing terrain
remains, and local geography, exteriors, landmarks and vegetation decoration
continue afterwards. Architectural templates build only at designated building
sites; they do not overwrite a broad landscape rectangle. `[IndoorLayout]` and
`[DungeonBuild]` report the layout source, repairs, modules, rejected placements,
chambers, roof supports and authored outdoor terrain for diagnosis.

### Room Colors and Materials

Voxel material patterns are back on by default (`VOXEL_MATERIAL_TEXTURES = false`
remains an opt-out). Architectural shapes use the room's generated palette,
retaining material weighting and explicit per-prop colors. Pale masonry bodies,
contrasting bases/capitals/trim and coherent marble, wood, metal and masonry
patterns restore separation without forcing every room to ivory and green.
Natural vegetation and flames keep their intrinsic identities.

The older renderer remains in use. Two height-aware world traversal corrections
allow pixels above a low foreground wall to reach taller terrain behind it, and
allow an elevated camera to see floors beyond a low wall. Ray step limits,
visibility ranges, torch lighting and the voxel near-plane clipping fix remain.
GPU regression fixtures cover both occlusion cases. Their zero-light visibility
fixtures specialize only the torch function for the software driver; production
shaders still compile unchanged and the real traversal is exercised.

Description-generated palette choices, floor patterns and wall brick sizes are
no longer replaced by generic scene material defaults. Scene surface textures
carry those choices and a campaign/room seed into their sprite-library keys:
different rooms can look different, but revisits remain stable. Floor/wall tile
textures and Canvas-based map/fallback sprites remain required and are retained.

### Crafted Outdoor Landscapes

Outdoor blueprints receive their own schema, not indoor room-count quotas or a
maze schema. Both designers have an architectural composition brief: arrival
sequences, focal spaces, supporting structure and modular bays indoors; foreground,
middle-distance discoveries, horizon silhouettes and geographically situated
ruins outdoors. A nearby point of interest and route-side clusters prevent all
content being placed far north of spawn. The LLM selects arrangements from the
room prose; the decoration pass enriches them rather than replacing the plan.

Backing terrain retains multiple broad hills and basins, with the older seeded
small-scale hill variation restored additively. Ordinary descriptions of plains
no longer suppress all relief; explicitly flat ground, wetlands, city sites and
gardens remain gentle. Additional floor-height profiles include flat-capped mesas,
narrow buttes, hoodoo spires, shelf terraces, one-sided cliffs, winding terraced
canyons, mineral-rimmed thermal basins and volcanic calderas. Forest, glacial,
volcanic, badlands and geothermal profiles choose fitting backing features.
Blueprint landforms are capped at eight additions and retain spawn-height safety.
This is terrain preparation, not a new climbing system or animated fluid renderer.
Water/lava pool props are supported; continuous rivers and waterfalls remain future
work. Caves and sewers continue through the indoor construction path.

Paths use tile-sized widths and grade between local elevations rather than carving
huge global-zero trenches. Legacy clearing rectangles preserve terrain unless
explicitly flattened; bounded building foundations remain deliberate exceptions.
The older ruin fragments and prop scatter are restored with at most 80 sites,
preserving routes, foundations, fixtures and open local bypasses. `[OutdoorDressing]`
and dungeon snapshots report the bounded scatter and authored relief. Existing
cached rooms are not automatically rebuilt.

Outdoor building modules retain castles, forts/gatehouses, keeps and ruins; a
watchtower variant adds a ten-unit supported shell and a correctly elevated roof.
Module roof styles are honored even when the surrounding outdoor biome has no
global roof style. Leafless forests use the seven existing seeded tree silhouettes,
now with tapered curved branches sampled as slender tubes rather than inflated
cube stamps. Renderer and collision keep the same 16-cube resolution. Torches and
their placement, mount data and lighting are retained throughout these additions.

The initial blueprint design contract supplements missing indoor sections and
omitted ruin/building sites in appropriate wastelands. Existing module choices,
room roles, footprints and corridor graphs win; no buildings are forced into
untouched forests or quiet gardens. Supplement choices/positions vary by campaign
seed. Golden-angle placement is used for fallback site candidates and branch/root
spacing, not as a replacement for the authored navigation graph. `[BlueprintDesign]`
records only the bounded additions. Trails grade to the edge of foundations and
retain the foundation's elevation rather than excavating through the building.

### Downhill View Assistance

While walking forward onto lower open terrain, `TerrainCamera` eases the horizon
upward to expose more floor above the command dock. It is capped at one tenth of
screen height and returns to level after stopping. It never changes player height,
movement speed, collision or room cells. Upward/backward/sideways movement, blocked
faces and flat ground do not trigger it. New rooms reset its state.
`DUNGEON_AUTO_LOOK_DOWN = false` disables the assist.

World rays, voxel vertices/frustum checks, sprites and mounted torch projections
share the same normalized view shift; the Canvas fallback and WebGPU world/torch
projection carry it too. The legacy lighting shaders remain byte-pinned except
for the explicitly tested world traversal/view-shift additions. A software GPU
fixture verifies that the shift exposes more actual floor pixels, not just a CSS
translation of the existing canvas.

### Biome Props and Module Variety

Twenty-two new voxel silhouettes cover eroded hoodoos, mushroom rocks, wind-carved
arches, layered outcrops, cairns/talus, hollow logs, rootballs, buttress roots,
fungal shelves/rings, fumaroles, mineral cones, basalt columns, lava spatter,
sulfur crust, ice spires/arches, pressure ridges, glacial erratics, driftwood and
reed tussocks. Both generation paths prepare fitting ambient sprite templates and
then commit bounded geographic clusters after geometry, objects, exits and
vegetation. Mixed biomes use neighboring seeded bands and shared-species ecotones.
Directional boundaries are not yet inferred from prose. Placement preserves
navigation, elevations, foundations, fixtures and finalized rooms, and is capped
at 80 props/10 clusters/3 variants per shape/232 total custom tiles. Explicitly
requested indoor garden/courtyard placement is restricted to roofless garden zones
and capped at 16. `[SceneBiomeProps]` reports placements and exclusions.

Full architectural modules support explicit 19-63 by 23-79 tile dimensions when
their authored chamber safely fits, with deterministic per-chamber internal plan
variation. New bounded sections include cloisters, apsidal chapels, switchback
stairs and split raised galleries. They preserve the original chamber/corridor
graph and reject occupied, disconnected or inaccessible staged layouts atomically.
Automatic building supplements sample real terrain before choosing a foundation;
steep short approaches and broad cliff flattening are rejected rather than
advertised as accessible buildings. Unsuitable sites remain logged omissions.

The Environment Lab adds Badlands, Caldera, Icy Uplands, Leafless Forest, Modular
Sanctuary and Modular Foundry exhibits with inspection viewpoints. Seed input and
New Variant compare physical geometry across runs; Reset replays the chosen seed.
The isolated endpoint retains at most twelve cached exhibits and never touches
campaign state. `node tests/run-biome-visual-probe.cjs --software --summary` renders
all six exhibits with the production geometry in a headless fixture and saves PNGs
and a contact sheet. Software rendering may specialize the zero-light accumulator
only after compiling the full production programs; hardware driver validation is
separate. Artifact screenshots are diagnostic output, not game assets.

Saved geometry is never roof/exit-upgraded as a side effect of finalizing a door
delta. Already populated rooms repair missing neighbors without re-running current
room population or altering sheets, items, puzzles, monster state, XP or searches.
Original startup boilerplate still runs the complete existing population pipeline.

Verification: `node --test tests/*.test.cjs`, desktop/narrow
`node tests/run-dungeon-ui-probe.cjs`, and `node tests/run-gpu-probe.cjs --software`.
