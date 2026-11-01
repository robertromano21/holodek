# City Walking And Crowd Visibility

Walking visits no longer compile city parcels at all. New city-room preparation builds the whole bounded usable footprint once and persists it, including ground-floor plans, shells, details, stairs/lifts and streets. Previously accepted two-parcel growth passes still caused full room finalization and graphics refreshes while walking, even after no-op streaming had been optimized. Visits now only reconcile a genuinely stale geometry snapshot; they do not read city authoring state, compile navigation for construction, finalize or save geometry. Existing partial saved cities remain intact rather than being upgraded behind the player.

The October 30 offline 512-square flat-terrain benchmark built 265 fantasy buildings/23 parks in 7.1 seconds and 153 cyberpunk buildings/15 parks in 5.0 seconds, all before delivery. Saved geometry was about 44 MB JSON (1.6 MB gzip) per fixture. These are CPU construction/storage measurements, not live FPS or entry-latency guarantees; actual terrain and authored landmarks affect fit and cost. Adjacent helpers can do this one-time work ahead of arrival. Higher floors remain compact plans, not hundreds of eager meshes or resident batches. The benchmark is `.retort-data/city-prebuilt-architecture/benchmark.cjs`.

The October 25 diagnostic city had 651 saved ambient citizens, including 131 street pedestrians. The 3D renderer rejected their canonical room IDs against the display-form coordinate string. Its room comparison now normalizes both representations, retaining wrong-room filtering. Procedural bodies are compiled at most two per frame-time slice, up to the existing 24 visible nearby residents, with no model calls until a citizen is introduced.

Building finishes use eight seeded variants per genre. Ground walls use a small flat surface texture matching the tower voxel's base palette; collision geometry remains unchanged. Window banks have building-specific dominant colors and genre-native accents. Finished buildings retain their saved style. Existing buildings get varied window colors without overwriting their saved wall geometry. No additional dynamic lights are allocated.

The earlier synthetic 512-square fully protected city benchmark (`.retort-data/city-walk-fix/benchmark.cjs`) improved from approximately 5.2 seconds and four writes for four short walking visits to approximately 10 ms and zero writes. It only covered blocked construction. The new preparation policy also removes accepted walking-time construction; it does not eliminate legitimate room-entry, door or floor-change graphics uploads.

## Usable Building Circulation

New frontages have seeded axial, lateral, atrium/gallery and cross-hall layouts, with different concourse widths. Existing lobby walls are not recarved. Visible stair approach flights, handrails, lift frames and call panels use each setting's structural assets. Stair cells have matching collision elevations and headroom. Lifts are restricted to appropriate technological settings. Stairs travel to adjacent floors; the lift directory selects an existing saved floor. The server validates the saved control, run, geometry, reach, line of sight and floor bounds before handing off travel.

At a complete-room delivery boundary, old city frontages can receive circulation in unoccupied walkable areas without replacing their props or residents. Ordinary procedural lobby entry then remains within the street room, instead of dispatching the old separate-lobby generation request. First-time upper-floor visits still use the existing content chain and compatibility room aliases. A full host-local floor runtime is not implemented by relabeling those addresses. Return travel uses the building's actual street landing; old private lobbies retain a street-return control. Saved aliases, quests, residents, inventory and completed-floor caches remain intact.

## Shared Envelopes And Encounters

New buildings save a shared versioned outline: chamfered, cross-wing, opposed setbacks or a corner setback. Street walls, foundation/roof slabs, near tower voxels, distant facades and saved indoor floor envelopes derive from it. Interior repairs stay inside the envelope and preserve connections through its central circulation spine. Furnishings, lighting, circulation controls and residents must remain within the actual fitted parcel, not its rectangular bounding box. Old saved buildings retain their original outlines.

Supplemental encounters draw a stable size of 2-6, reserve enough connected unoccupied cells before authoring, and keep the existing room cap and model batching. New population requests prefer coherent hostile groups of 2-6 and support six-member cohorts. Intentionally solo/named encounters and saved populations are not multiplied or changed. This is not a guarantee that every model-authored hostile will obey the preference.

Combat team borders normalize canonical/display room IDs and are gated on combat state, including first-round initiative. They are not displayed during exploration; existing white hover feedback remains available.

No save slot or live process is changed by the verification scripts. Unit and offline-snapshot tests are not a visual live playtest.

## Native Frame And Search Caches

The October 28 browser walking captures used the same 512-square city and geometry stamp. The earlier optimized capture rendered about 16.0 frames/s while moving/turning; the search-cache capture rendered 23.4 frames/s. Median navigation CPU time fell from 16.7 ms to 0.3 ms and p95 rAF gaps fell from 100 ms to 66.9 ms. These were different walks, not an identical-route controlled benchmark. Inclusive CPU timings overlap and do not measure GPU execution time.

`assets/dungeonPerformance.js` integrates the tested mechanisms without runtime source rewriting or diagnostic imports:

- A stamped, chunked renderable-cell index preserves the existing 64-tile square radius, x-major ordering, all light ties, scenery and materials. Unstamped rooms retain the original cell scan.
- Quest placement caches only the unchanged candidate-floor pool. Seeds, landmarks, mission status, authored labels and reveals remain live. Geometry stamps, cell-grid replacement, dimensions, arrival, exits and host-floor scope invalidate the pool.
- Nearby party-tile searches retain the original BFS and return fresh tile objects. Every cache hit validates the original search's cell dependencies, including doors, blockers and elevation, even without a new geometry stamp. Actor occupancy, following, AI cadence, roster projection and collision decisions are not cached.
- Free-exploration city render requests coalesce into one world draw followed by one current tactical-map draw per scheduled frame. Combat, death, hidden tabs, non-city scenes and software rendering remain immediate. Room/run/floor/renderer changes discard stale pending requests.
- Terrain and grid layers are separate from live items, actors, targeting and exit markers. The map cache verifies asymmetric alpha-blit pixels once for each target; unsupported compositing falls back to direct drawing. Live door/secret changes, image arrival, palette, view, size and geometry invalidate the layers. Scene shutdown releases cached textures.

Caches are browser-local and do not enter saved dungeon data. `DungeonPerformance.diagnostics()` exposes bounded cache counters without model calls, polling or an additional animation loop. Hard-refresh after installation to remove old opt-in trial wrappers; diagnostic trial modules are not loaded by the game.

## Native Crowd Cache Worker

Crowd-only persistence uses `assets/cityCrowdCache.js` and a same-origin worker. The worker atomically reads the existing version-2 IndexedDB room, checks the run, host coordinates, geometry stamp, crowd revision and previous crowd contents, and changes only `cityCrowd`. Full-room serialization still occurs off-thread; this is not a split on-disk cache format or a server-save migration. The unchanged loader reads the same room and population stores.

Native full-room saves and crowd patches share a per-key queue. Keys and room pointers are captured before asynchronous work, so changing floors or worlds cannot redirect an accepted save. A newer scheduled full save supersedes an older queued crowd write. Non-crowd mutable changes use the full native path; large geometry remains stamp-owned, while independent LOD and population persistence keep their existing owners. Full-save fallback is allowed only for the still-current room/floor. A worker compare-and-swap conflict retains the cached record until an explicit native save establishes a new baseline; it never falls back to overwriting newer geometry. Worker failure uses the same atomic crowd patch on the main thread. Missing records are seeded only if they are still missing and the original room is still active. Unsupported browsers retain native saves. Cache queues are bounded, and diagnostic counters are available through `cityCrowdCache.diagnostics()` without polling.

Population-store saves also capture their floor key before opening IndexedDB. A floor change during that wait cannot redirect an old population into the newly active floor.

The October 29 opt-in walking capture reached 29.96 FPS with no long tasks, no frame gaps over 100 ms, six worker patches and no main-thread full-city puts. Its 26.95 FPS baseline also encountered a geometry-refresh stall absent from the optimized walk, so the FPS difference is not a controlled improvement claim. A later complete floor/room route saved 44 worker patches with zero save failures; all four original-reader cache audits subsequently passed with unchanged static hashes. No live queued-save boundary was observed on that route; deterministic tests cover that case. These observations validate the prototype, not a live playtest of the subsequently integrated release. The separate geometry-rebuild hitch remains outside this change.

### Next Controlled Tests

First repeat a 20-second native walking route after reloading, including turning, pickup and an opened door; then verify a city-to-building-to-upper-floor return, first-round combat overlays and death/revival. Test Modern and Retro in both windowed/fullscreen views and WebGL/WebGPU where available.

For the next performance experiments, isolate one change at a time: tactical-map redraw cadence while leaving world/AI updates live; party projection/roster serialization with identical following decisions; and crowd preparation versus billboard collection without reducing population. Compare equal-duration A/B/A runs on the same route, resolution, renderer and party. Record actual rendered frames, p95 gaps, long tasks and live cache counters. Measure GPU time separately before claiming a GPU bottleneck. Do not promote another optimization until behavior and visuals agree with the baseline.

## Isolated Geometry Refresh Test

The following trial measured the earlier walking-time growth path. With full preparation installed, ordinary city walking should not produce a construction delta, so waiting for one will time out rather than produce a meaningful new benchmark. Verify stable geometry stamps/zero `CityStream` growth and compare native walking routes instead. Room/floor entry resource work remains a separate performance target.

`assets/debug/city-geometry-refresh-v2.mjs` is opt-in and is not loaded by the game. It leaves native crowd persistence, actor preparation and party serialization unchanged. Start visibly arms while paused and automatically begins after unpausing. The test waits up to 90 seconds for one actual accepted outdoor geometry delta, rejects room/run/floor/settings changes, and never forces construction or calls a model. No delta means no claimed benchmark.

The live report separates delta application, navigation, exterior decoration, renderer resource rebuilding and renderable-cell collection. It also records bounded browser long-animation-frame attribution, the worst observed frame gap, native crowd-cache counters and explicit capture-transfer overhead. Inclusive CPU timings overlap. Capturing the geometry adds copying overhead, so the observed hitch is not an uninstrumented FPS benchmark.

After three settling frames the instrumentation is removed. A background worker replays the identical seeded room and accepted delta in baseline/optimized/optimized/baseline order. The candidate uses dense navigation cell references with the original BFS/scoring/tie rules and lazy visible 16-cell chunks with the unchanged 64-tile radius. Output hashes compare exit markers, reserved paths, decorated structures/tiles and collected cell order. Resource rebuilding, GPU uploads and world rendering are not optimized by this replay. Mismatched outputs cannot be called verified, and this pass does not integrate the candidate into production.

Reports use `city-geometry-refresh-live` and `city-geometry-refresh-replay`; results remain in `CityGeometryRefreshTrial.results`. `Close / Undo` removes owned instrumentation and terminates the worker, including during cancellation or failure. The PowerShell checker is `.\.retort-data\city-refresh-native\install.ps1`; helpers/server require no restart for this diagnostic.

The tactical map ownership fix is independent: outdoor-discovery and roster updates may not re-enable Phaser actor overlays when the maze texture owns those tokens. Otherwise a second actor copy can appear between deferred redraws. The PC fallback remains visible if its token could not actually be composited. Hard-refresh to load this browser fix; residents and their saved identities are not removed or regenerated.
