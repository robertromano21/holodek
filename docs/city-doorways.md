# Street Buildings And Persistent Interiors

City frontages now enter the existing city-floor/dungeon chain instead of ending at a ground-floor shell. Walk through an available doorway to enter automatically, without an Enter Building confirmation. The trigger spans the door's width inside the frontage, not the passing pavement. The PC validates the run, street geometry, proximity and line of sight before preparing the persistent address. Ordinary room generation, population, music, artwork and caching then handle the interior; first-time generation may still take time.

- Building identity is keyed by source room and parcel ID. Re-entry does not create another building or replace inhabitants, loot or quest state.
- Authored venue and fortified-site destinations are reused unchanged. Existing citadel, fortress, castle, temple and wizard-tower stairs remain their own saved connections.
- Each occupied floor fits the frontage footprint. Floors have saved addresses, reciprocal stairs/lifts and existing unit/population programs. Expensive dungeon and model work occurs on entry, not for an entire skyline upfront.
- Ground-floor street exits return to the actual doorway used. Automatic re-entry is suppressed until the player walks clear of that doorway, preventing a return loop. Multiple physical doors share one interior.
- A preparation response cannot pull a player back after they walk away, change rooms, pause or open a menu. Requests are deduplicated; failures show one non-modal notice and rearm after walking clear. Existing combat, command, startup and pause guards remain in force.

## Terrain And Density

New metropolis parcels use 36-cell spacing, versus 40 previously; older saved parcel grids retain their original pitch. Fantasy blocks use 28 cells. Dense streets retain 2.5-metre pedestrian pavements. A district builds up to 48 buildings and six parks initially, then continues the existing exploration-driven streaming.

Sites try alternate placements rather than silently losing a building on the first collision. Terrain elevation is not a rejection rule: level pads, retained cut-and-fill foundations and graded approaches support uneven land. Unreachable sides are closed; occupied cells, saved objects and protected routes are never bulldozed. Placement reports distinguish actual construction from candidate addresses and disclose remaining constraints.

## Light And Population

Approved genre-native fixture voxels emit through the shared renderer lighting collector. Interior spacing scales with room dimensions; suspended fixtures have supports. Sidewalk lamps have poles and form regular pools of light. These are physical light sources, not a global brightness override.

Procedural residents use the saved setting ecology, identities and bodies. Larger buildings distribute staff, patrons and errand-runners among their actual rooms. Floor programs reserve their authored resident budget. Viewport rendering remains bounded to 24 visible ambient bodies, but people behind walls no longer consume those slots. Meeting someone authors their dialogue and history once and promotes the same identity into the persistent encounter population.

## Verification And Activation

`tests/city-doorways.test.cjs` covers persistent connections, all entrances, legacy arrivals, genre floor fitting, fortress reuse, visibility, lights, density and uneven ground. `tests/city-building-entry-ui.test.cjs` executes automatic entry with a simulated browser surface, including command-lock handoff, all doorway orientations, return hysteresis, slow/failed responses and stale/blocked state. The read-only reconstruction report is `.retort-data/city-doorways/replay.json`; neither test is a modification of the live room or a live 3D test.

Source installation does not restart servers or alter save slots. Coordinated helper release verification is required before activation; do not push an engine incompatible with the running PC release. Existing visited geometry is preserved, while newly generated districts use the denser layout.
