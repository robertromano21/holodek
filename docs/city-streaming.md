# Streamed Cities, Towers And Citizens

This extends the earlier city-fabric and city-life passes. It does not rewrite an already-built city or the player's saves.

## Prepared Neighborhood Geometry

New outdoor city rooms now compile their entire bounded parcel plan during room preparation, including distant ground-floor interiors, foundations, roofs, frontage details, circulation and street surfaces. The old 48-building/6-park arrival budget is not used by production preparation. Terrain, protected routes, objects and earlier reachability still decide which parcels can safely fit. A persisted `cityBlocks.construction` receipt records accepted and unplaced candidates. This is a completed placement pass, not a promise to build on cliffs, occupied cells or outside the host room.

Walking visits never construct, finalize or persist architecture, including in legacy partial cities. A client that missed a geometry revision can still recover the exact saved snapshot after run/room/walkability checks. Reloading reuses saved geometry without reconstruction. Existing saved cities are not silently rebuilt or falsely labeled complete; test full coverage in a newly constructed city room. Adjacent-room helpers use the same preparation path and saved exit graph. This is not an infinite, boundary-free world.

The low-level `cityBlocks.apply` bounded/stream options remain for isolated fixtures and compatibility tools, not the walking endpoint. Complete rooms reject further parcel growth even through those options. Higher storeys retain compact seeded plans (the first two recipes are saved); this pass does not eagerly allocate a mesh, cell grid or resident cast for every floor. Content and encounters keep their existing visit-time pipeline.

Production-geometry stress fixtures constructed **750 unique walk-in buildings** in each of fantasy and cyberpunk cities. All building doors and ward exits remained reachable. Fantasy used five connected wards, cyberpunk six. These are collision/scale tests, not evidence that the running game has generated that city or that 750 buildings were GPU-tested in one frame. Full stress reports are under `.retort-data/city-streaming/scale-*.json`.

## Complete Tower Addresses

For the two representative towers in each new city plan, every floor from ground through the authored crown gets a unique saved address and reciprocal up/down links, up to 160 storeys. The 30-60 landmark/street plan is retained separately from these floor addresses. Core and skyline uses remain LLM-authored. No actors or full dungeons are manufactured by address allocation.

Interiors and named encounter residents are authored through the normal room chain on first entry. Purpose-fitting geometry compiles actual unit-room locations and procedural furnishing. Residents retain unit identity, position, defeat, recruitment and inventory on return. Eight residents form the normal authored floor cast; additional ordinary occupants use the crowd layer. Local generation still uses one-resident work orders and jointly reserves input and output tokens. API models retain their fuller context.

Tower elevation is physical metadata, not its private database z coordinate. Representative upper floors use an eight-metre structural pitch, seven-metre clear headroom, and a separately sized podium for taller ground halls. Upper room floors and headroom are fitted to that slab; exterior landmark tower height uses the same saved elevation data. This accommodates the game's existing actor/camera scale without overlapping floors. Historical filler does not inherit the city's tallest tower height; typical filler is capped at twelve storeys, while small settlements remain capped at three.

Remaining vertical work includes express lift selection, seamless visible stacked interiors and open rooftop traversal. Most filler towers have an actual walk-in ground floor, not a completed graph of upper floors. Those are not advertised as accessible destinations.

## Visible, On-Demand Citizens

New city geometry gains persistent lightweight citizens sampled from the setting's saved native population groups and city demographics. Names and bodies are procedural; there are no model requests for bystander sprites, biographies or dialogue. Body anatomy cues come from the saved group's description, with approved genre clothing. Bystanders have real floor positions and stable identities but are not silently added to combat, services, inventory or dialogue caches.

Up to 384 lightweight citizens are retained per street room; only the nearest 24 within the view radius have active visual bodies at a time. The production WebGL actor path and rotating 2D tactical map draw them through the existing procedural sprite system. These are currently stationary bystanders, not a full autonomous crowd-navigation simulation. The CPU-only first-person fallback still needs equivalent crowd drawing; do not claim parity there.

Clicking a citizen exposes **Meet This Resident**. A nearby, visible, current-room contact invokes the existing inhabitant authoring pipeline for exactly one person, preserving their name, race and position. A successful introduction promotes that identity to the normal persistent population and removes its lightweight duplicate. Repeat contact does not re-author them. The ordinary character sheet and game mechanics then apply. Set encounters and random encounters retain their existing roles and tables, including both CotG encounter sources.

## Public World Knowledge

Locals receive public setting/region facts alongside verified geography. They may author ordinary dishes, ingredients, customs and practical local colour, and offer plausible alternatives to an unfamiliar food. This is descriptive world-building, not granting an inventory item. Existing witnessed cultural details remain continuity constraints. Public context deliberately excludes objective items, final opponents, private motives and hidden locations.

Exact venue names, present operators, stock, prices, rewards and usable directions still require saved evidence. `route.via` supplies the verified next exit; a map bearing is only orientation. Public culture is not permission to invent a functioning shop or a traversable unsaved district. Detailed setting-wide cuisine catalogs are not yet compiled automatically; spoken details remain in the existing conversation/memory system.

## Verification And Activation

`tests/city-prebuilt-architecture.test.cjs` exercises full production preparation in 512-square fantasy/cyberpunk rooms, distant buildings, reachable doors, protected cells, deterministic genre plans, saved-layout reuse and zero walking-time geometry writes. `tests/city-streaming.test.cjs` retains isolated legacy compiler/delta coverage and tests snapshot-only walking. Population tests retain floor graphs, real unit positions, local token budgets, native populations, zero-call bodies, one-person introductions and secret exclusion. Full-suite failures are compared by name against the existing baseline.

`tests/run-city-stream-probe.ps1` requests native confirmation before launching an isolated production-WebGL fixture with procedural citizens. It uses a random loopback port, no API key and no game-server restart. An unanswered prompt defaults to No. A diagram, CPU sprite sheet or geometry test must never be reported as a passed live 3D test.

New source must be verified and installed on the website helpers and PC together. No saved game, gameServer or gameServer2 is restarted by these city changes.
