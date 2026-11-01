# Illuminated City Skylines

`assets/citySkyline.js` keeps constructed buildings visible beyond the old 192-cell structural cutoff. It uses the existing production WebGL voxel pass, including the WebGPU renderer's shared voxel overlay. It does not add another renderer or a fixed backdrop of imaginary buildings.

## Rendering Budget

- Nearby buildings retain their detailed meshes. The far representation uses greedily merged surfaces from the same approved 16-voxel building shape, preserving setbacks, openings and roofs.
- Buildings batch into 128-cell chunks. Each chunk has a body pass and a luminous facade pass; large meshes split before unsigned-short index overflow.
- High-rise buildings now use up to 640 luminous window panels, versus 96 in the initial skyline pass. Lit windows form neighboring room banks, align with the actual storey heights, and mix warm residential panes with cooler office panes using approved fixture colors. Smaller and pre-industrial buildings use a lower, scale-aware budget of up to 256 panes.
- High-rise settings also receive up to 24 setting-colored facade/crown accents and a small roof beacon on an occupied roof surface. Pre-industrial genres do not acquire modern neon edge strips.
- Facades use emissive vertex colors, not dynamic lights. They remain visible from a distance without hundreds of extra shadow traces. Nearby street and interior fixtures still provide the actual pools of light.
- The incremental work budget generates at most two dense towers or four smaller patterns per frame. A bounded permutation samples occupied room banks without enumerating every window in a skyscraper. Offscreen chunks do not compile facade meshes.
- CPU patterns and GPU buffers are cached. The GPU cache keeps all current-frame batches plus a bounded recent working set; eviction never frees a buffer awaiting submission. Leaving a city releases its compiled CPU batches even if the room database retains the dungeon. The recent-pattern cache is bounded by both 1,024 entries and 100,000 surface panels so denser towers cannot silently multiply its retained memory.
- Near/far hysteresis uses 64/80-cell thresholds. Both representations share the same window pattern, preventing random changes when approaching a building. Streaming additions preserve unchanged patterns.

The city depth range covers its map diagonal, so distant buildings retain separate depths instead of collapsing at the old 300-cell depth limit. Glow panels use ordinary depth testing and can be hidden by nearby walls or other buildings. A dimmed minimum pixel footprint is confined to luminous panels so windows do not disappear at the engine's low rendering resolution.

Only actual `cityBlocks.buildings` with matching approved `sceneStructures` are rendered. Geometry, doors, collision, population, save slots and helper work are not modified. Unconstructed districts are not fabricated on the horizon. `window.CITY_SKYLINE_RENDERING=false` restores the prior structural path for comparison.

## Verification

`node --test tests/city-skyline.test.cjs` checks all 18 genres, deterministic patterns, streaming invalidation, 750-building batching, depth range, mesh limits and GPU cache lifetime using a mock buffer allocator. These are automated geometry/integration tests, not an FPS measurement or visual GPU proof.

`node tests/run-city-skyline-probe.cjs` launches an isolated headless Edge production-renderer test. It compares the old skyline with the illuminated one, checks retro mode, foreground occlusion and buffer reuse, and writes a report and screenshot to `.retort-data/city-skyline/`. It uses no API calls and does not contact or alter either game server. `--software` requests SwiftShader. A browser launcher failure is not a passing rendering test.

Source changes require a browser reload to take effect. This client-only feature does not require a helper engine change; do not replace helpers pinned to a different running PC release. The verification report records the exact release hash and leaves restarts to the user.
