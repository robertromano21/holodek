# Recruitment Roster Continuity

A room-local recruitment helper can already be in the party when their own
condition completes, while another member of the same invitation is still
waiting for a different condition. Both accepted and completed helper requests
protect that existing membership during browser state synchronization.

When the last group condition completes, existing helpers become permanent
before the remaining members are admitted. This updates the completed request's
recruitment receipt and removes the temporary departure lease synchronously,
without waiting for another turn, menu click, or model call. Stale browser
snapshots cannot restore an obsolete lease.

This does not waive unfinished group conditions, revive dead characters, create
new character sheets, reroll appearances, or prevent explicit dismissal of an
unfinished room-local helper. Run, room, floor, recipient, completion receipt,
and linked group identity must match before a helper is finalized.

The reported run's logs show Veyra Siltwing joining provisionally, completing the
existing puzzle, then Orren Vale fulfilling a conversation condition and joining.
The original helper's completed-but-not-finalized status fell outside the old
roster preservation rule. The running population still retained both original
character records when inspected; no live state or saved game was rewritten.

Regression coverage: `tests/recruitment-roster-continuity.test.cjs`.
After closing and relaunching Holodek with the verified release, run:

```powershell
.\tools\update-helpers.ps1
```
