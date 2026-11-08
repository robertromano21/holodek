# Quest Handoff Recovery

## Failure

The opening quest and adjacent-room helpers used snapshots taken while neighboring populations were unfinished. Quest placement could create its own cast in a room assigned to a different helper. Its later three-way merge then rejected the independently completed cast with `ROOM_BUILD_CONFLICT`.

The browser synchronizes the requested destination before processing travel. If quest activation failed before room publication, the server retained the origin's physical cursor but the destination's console. Save validation correctly rejected that inconsistent checkpoint.

## Changes

- Opening-quest monster placement excludes unfinished populations assigned or reserved to other helpers. Already authored residents remain available as references; object/key additions retain their additive merge path.
- Starter and completed casts are not repopulated to fill a quest slot. When no eligible non-party resident or writable monster location exists, the author receives item/key choices before its model request.
- Reusing residents reads exact saved character sheets without normalizing the entire population back into the quest snapshot.
- A failed input task recovers an uncommitted room cursor to the still-active origin and returns that checkpoint with its original error. Inventory, completed neighbors, discoveries and quest work remain intact. Recovery does not cross runs, undo a published entry, or reinterpret host-local floors.
- The browser applies the recovery to its existing room, clears the abandoned arrival, and retains the error. It does not replay the command or spend another model call.

## Verification And Activation

`tests/quest-handoff-recovery.test.cjs` covers ownership-filtered production placement, concurrent neighbor overlays, exact resident identity, save validation after failure, the actual server input error route, and browser recovery.

The full suite and the selected-helper verification are recorded in `.retort-data/quest-handoff-recovery/verified.json`. The PowerShell updater validates source and engine fingerprints before touching helpers. It never restarts either server or edits saves.

The already-running release is not hot-patched. Relaunch Holodek to activate, then run `./tools/update-helpers.ps1`. This pass does not claim to implement a new live view through exit doors; rendered door views require a browser check after activation.
