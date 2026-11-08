# Verified Request Handoff

Report Findings and typed reports used to return only the mechanical completion
receipt. That shortcut correctly verified the puzzle and fulfilled the standing
invitation, but bypassed the dialogue response pipeline.

Both report routes now request one LLM-authored acknowledgment after the engine
has committed completion and any recruitment. Only the existing resident speaks;
the author receives their current profile, the actual request, and the committed
party outcome. It cannot re-adjudicate the puzzle, impose another condition, or
change the mechanical result. Conversation-based completion still uses its
existing adjudication-before-response path, without this additional call.

The acknowledgment is stored against the completion receipt. Concurrent requests
share the same authoring operation; receipt replays reuse the saved exchange.
Dialogue is delivered to the Game Log and the normal subtitle/voice system, with
stage directions separate from speech. SSE and HTTP copies of the same economy
event are displayed once. Incomplete reports make no acknowledgment call.

State is re-read after authoring to preserve concurrent adjacent construction.
A changed run, room, host-local floor, receipt, or departed/dead resident prevents
stale speech from being published. Authoring failure leaves verified completion
and party membership intact and returns an explicit delivery notice. No saved
world is rewritten by installation, and no completed task is replayed on load.

## Activation

Save and close the game, then run:

```powershell
pm2 restart gameServer
.\tools\update-helpers.ps1
```

Reopen the saved game and complete/report another pending request. No new game is
needed. The updater checks the exact verified release and all three selected
local or website helpers; gameServer2 is untouched. Automated tests use fake
transport, not paid model calls. Live browser verification remains necessary.
