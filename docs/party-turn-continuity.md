# Party and Turn Continuity

Typing a normal action builds a local console draft before the request reaches
the model. That draft formerly redrew the party from older local character
arrays, often briefly replacing recruited companions with `None`. It now keeps
the confirmed party cards and PC/NPC sheet strings unchanged. Start-menu
previews and explicit party changes still work; authoritative empty parties and
dismissals replace membership normally, rather than unioning old members back.

Turn responses, realtime results, and final combat events reconcile existing
actors instead of discarding their appearance and interpolation state. Same-room
positions accept both raw and formatted coordinate keys. A noncombat response
that merely echoes the exact submitted position cannot rewind newer client
movement while the model was responding. Real server position changes and combat
steps remain authoritative and animate from the current rendered point.

The turn snapshot is bounded by actor count and scoped to the game, room, and
floor. Room/floor changes and respawns do not inherit previous-scene movement.
Missing actors are not restored from a union, and temporary recruitment leases
are never copied from an obsolete client actor into a server-confirmed member.
No model call, extra polling, or per-frame serialization was added.

The bounded log review showed routine state synchronization and no generation
of the already-populated starter room during these actions. The code and
regression tests reproduced the temporary dock disappearance and room-key
anchor reset; the live browser remains on its previous release until relaunched.
No live session or save was modified.

Tests: `tests/party-turn-continuity.test.cjs`, existing party dock, following,
movement, realtime combat, save/load, and recruitment continuity suites.

Close and relaunch Holodek, then run the exact-release helper check:

```powershell
.\tools\update-helpers.ps1
```
