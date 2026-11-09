# Object And Encounter Visibility Cost

The November 8 current-room diagnostics reported CPU frame times around 65-109 ms, almost entirely in scene collection rather than resource rebuilding or voxel submission. These are CPU submission timings, not measured GPU execution times or a complete FPS profile.

`WorldInteractionUi.visibleBillboards` tested every opaque item pixel by calling the public interaction picker. Each failed pixel rebuilt all nearby fixture candidates, including a redundant scene-object reconciliation even though the renderer already supplied the current item billboards. An item hidden by a new encounter character could exhaust hundreds of pixels before concluding that it was obscured.

Visibility batches now prepare fixture candidates lazily, at most once per check. Actor blockers are tested before the item's own long geometry ray. Rays retain the same sample positions, but reuse cell lookup and solidity information while samples remain within one cell. The normal click picker still obtains fresh candidates. Writing checks reuse their own current candidate list. No visibility result is retained across frames, and object synchronization remains owned by the renderer's existing item pass.

Every opaque item pixel is still eligible, including thin keys and partially exposed loot. Alpha holes, billboard depth ties, mosaics, walls, doors, floors, roofs and moving actors retain the original nearest-hit behavior. Discovery, pickup authorization, dialogue, encounters, population, visual detail and saved geometry are not relaxed or reduced. No model calls or new polling loop are introduced.

## Verification

`tests/interaction-visibility-performance.test.cjs` checks bounded candidate work and compares batched discovery with the exhaustive public-picker pixel walk, including alpha holes, clipping, motion and one-pixel items. Existing loot authorization and world-interaction suites remain part of verification.

The isolated CPU benchmark `.retort-data/interaction-visibility/benchmark.cjs` alternates baseline/optimized order on identical pixels and geometry. Its first completed run measured a hidden cudgel behind an actor at about 76 ms versus 23 ms, and behind artwork at 77 ms versus 21 ms. Fixture-candidate construction fell from 716 times per check to zero or one, with no redundant scene-object reconciliation. The wall-only case improved less, from 23 ms to 21 ms. These Node VM measurements demonstrate a targeted CPU improvement, not a live browser FPS guarantee or elimination of every encounter/mesh-preparation hitch.

After installation, repeat the same walking route toward loot and an encounter, including a wall-obscured item and a character moving across it. Compare renderer CPU collection times before and after reloading; verify that discovery and taking work only when the object becomes visible. The running game and save files are not modified by verification.

The helper updater is pinned to the verified release:

```powershell
.\tools\update-helpers.ps1
```

Close and relaunch Holodek before updating if the PC server still runs the old release. Leave `gameServer2` untouched.
