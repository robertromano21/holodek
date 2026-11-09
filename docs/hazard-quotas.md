# Required Authored Hazards

New rooms have a construction quota rather than relying on incidental words in a description:

- The starter room at `0,0,0` has no hazards and requires no hazard-authoring call, whether indoors or outdoors.
- Subsequent indoor rooms receive at least one hazard. Up to two already-described physical hazards can be retained.
- Outdoor biomes, including cities, receive a stable seeded count of 2-5 hazards. Existing physical danger descriptions are preferred within that limit.
- Private building floors at a starter city's host coordinate are not the starter street and receive the indoor quota.

The geometry compiler first chooses supported mechanics that fit actual unoccupied cells, with a bypass that remains usable after collapse. It prefers distinct kinds, respects genre restrictions and local climate, and protects puzzle controls, exits, arrival, service interactions and loot. Narrow rooms may use a smaller patch of the same danger. A genuinely unplaceable map fails explicitly instead of silently delivering an empty quota.

One scoped authoring step supplies every selected hazard's original name and complete description. Local models use batches of at most three, without another model call to choose the already-fixed count. No stock room prose or campaign names are inserted, and no extra entities, rewards or unsupported effects are permitted. Descriptions are not character-capped. Failed or incomplete authorship cannot commit a partial hazard layout. Both normal/helper construction and fresh procedural city floors await this work before delivery. Counts, names, kinds and local tile coordinates are logged under `[RoomHazards]`, with run and room identifiers.

The authored description appears during nearby inspection/hover. Nearby visible hazards enter the existing narration context; distant or wall-obscured hazards are not globally revealed. Exact authored names distinguish multiple hazards of the same mechanical kind. The mechanics remain exploration-only, with the existing automatic entry rolls and optional pause-on-roll preference. No combat status effects or additional polling loop are introduced.

Saved geometry is authoritative. Returning to an existing room, walking, reopening a game, or revisiting a cleared hazard never rerolls or adds hazards. In particular, the current saved Yellow Mile retains its original zero-hazard decision. Test a newly constructed destination or a new game after installation. New game starter rooms remain exempt.

## Verification And Activation

`tests/hazard-quotas.test.cjs` covers count distribution, stable placement, starter and city-floor exceptions, genre/climate selection, bypasses, protected fixtures, atomic failure, exact-name targeting, no text length caps and saved-state preservation. Existing hazard dice, damage, collapse, save assets and combat-exclusion tests remain unchanged.

Close and relaunch Holodek, then run the exact verified helper updater:

```powershell
.\tools\update-helpers.ps1
```

The updater verifies all three local or website helpers. Neither server is restarted by verification; `gameServer2` remains untouched. Offline tests use mock authors and do not call a model or modify live saves.
