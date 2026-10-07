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
