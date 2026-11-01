# Seeded Building Plans And Level Map

## Ownership And Cost

`room.cityArchitecture.buildings[buildingId]` owns a versioned architectural recipe, footprint, floor uses, entrance sides, circulation core, and stable seed. Constructed frontages bind their actual graded placement and ground-floor room dimensions into that record. The first two floor plans are materialized; other storeys derive from the saved recipe. No inhabitants, textures, meshes, or full cell grids are generated merely to plan a building.

A metropolis district prepares up to 750 procedural recipes. Named city venues also get host-street-owned records at city installation. A local benchmark produced 750 recipes in approximately 6 ms and 611 KB of JSON; this is not a rendering or whole-city generation benchmark.

Approved establishment types and the existing floor-program classifier determine physical uses. The model's saved use text remains intact. Architecture seeds are versioned and independent of visit order. Site-specific names and stories remain model-authored.

## Construction And Persistence

Unbuilt procedural floors with a saved architecture reference bypass the LLM blueprint-authoring requests and the full website-construction assignment. `cityVenueLayout` carves their saved plan locally, then existing furnishing and lighting systems populate it. Named buildings retain their helper/model authoring path inside their approved envelope. Encounters, people, quests, music and art still use their normal on-visit paths; this change does not eliminate every entry-time model request.

Generated floor geometry is additionally retained under `hostDungeon.cityInteriorLayers.buildings[buildingId].floors[floor]`. These layers coexist in the host's saved room data and can restore a missing legacy geometry cache without rerunning construction. Normal room/population records remain authoritative for actors, quests and inventory. Streamed updates preserve later floor aliases and cached layers. Worker artifacts publish plans through the destination's existing commit; background construction must not edit another room's population or console.

Runtime floor travel now remains at the host coordinate, with separate saved floor populations, inventory, geometry and quest scopes. Existing private-coordinate rooms remain compatibility aliases. A procedural ground-floor lobby is already part of the street grid: entering it must never import a checkpoint, reposition the party, or reset the crowd. Only a genuine floor transition changes the active local layer.

## Variety And Authorship

New layout-version-2 recipes vary actual topology: apsidal halls, peristyle rings, offset suites, rotundas with wings, staggered galleries, and cloister/chamber compositions. Dimensions, partitions, connecting loops, native column modules and physical uses vary by saved seed and floor. Walk-in ground floors use the same room grammar. Native CotG architectural modules decorate suitable fantasy interiors without erasing corridors or exceeding the storey's saved headroom. Already-built floors retain their saved geometry.

The LLM authors production campaigns from the player's brief, not an offline sample bible. It authors the opening room's name; descriptive prose is left to the normal room-construction pass. Unvisited procedural floors use that same naming/description authoring path for prose while preserving their already-planned geometry. No room description is assembled by concatenating campaign fields. Offline fixtures remain available to tests only when explicitly called without a production runner.

## Resident Identity And Shops

Meeting an ambient resident authors personality and dialogue, not another body. The original procedural appearance is saved on the population record and restored on roster attachment, floor return and reload. Legacy promoted residents can recover the deterministic original body from their retained crowd record without changing HP, dialogue or position. Unit-crowd identities include their building and floor to avoid cross-building collisions.

Nearby visible operators welcome visitors to shops, temples, inns and other service venues and open the existing service menu without a second Meet prompt. Stock and service desks belong to each venue and persist; customers do not acquire shops. Paused/combat/busy states, walls, range and stale-floor guards still apply. Ordinary ambient residents remain mainly click-to-author, with occasional automatic introductions: a 15-second initial grace period, at least eight tiles of movement, a 90-second per-game cooldown, a sparse seeded eligibility sample, and no interruption of queued speech. No dialogue is generated for the full city population upfront.

## Map Addition

The Exploration Map gains an optional **Level** button. Default room view, panning, zoom, Follow, Whole Level, fog, discovered icons, quest markers and close behavior remain. Level view crops the actual active floor and follows changes of building/floor automatically. A built walk-in street lobby can also supply the Level view. Blueprints never reveal unseen terrain, items or residents. Local floor layers sharing a world key use independent discovery masks; existing legacy room masks keep their original keys.

## Facade Lighting

Windows use each genre's existing approved fixture colors. High-rise budgets increase from 640 to 896 window panes, retaining bounded chunk meshes, incremental cold builds, caching, and zero additional dynamic point lights. A soft additive halo is calculated in the existing facade pass, after opaque geometry, with depth testing and no depth writes. It does not illuminate the entire street like a point light. Nearby street/interior fixtures continue to supply that lighting.

## References

Lobby design guidance draws on monumental materials and ceiling treatments at the [Empire State Building](https://www.esbnyc.com/about/architecture-design), separated public circulation at [One World Trade Center](https://www.som.com/projects/one-world-trade-center/), and vertical community/sky-garden organization at [Shanghai Tower](https://www.gensler.com/projects/shanghai-tower). These are design references, not copied plans or genre lore.

Verification: `.retort-data/host-local-floors/verify.cjs`; helper update: `node .retort-data/host-local-floors/install.cjs --helpers`. The PowerShell wrapper `tools/update-helpers.ps1` follows the exact verified manifest. Restarts remain the user's responsibility. Unit tests do not imply a live browser pass.
