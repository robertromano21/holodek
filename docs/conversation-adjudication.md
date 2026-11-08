# Conversation Adjudication Before Response

The failed Ilyra Venn turn had an accepted conversation condition explicitly
allowing a sincere question about the unnamed child. The player asked for the
child's name and burial after the fever. The scene planner returned speakers:[],
so the previous speech-driven fulfillment code was never called.

The main live-turn pipeline now uses the existing story-scene planning call to
adjudicate every eligible conversational condition before writing a response:

1. Retort requests a fixed set of condition judgments with verdict enums, exact
   current-player excerpts and reasons. Speaker selection cannot skip a check.
2. The engine preflights all judgments against the original request, current run,
   room, floor, recipient and player input before committing any of them.
3. Valid evidence is recorded, all conditions are checked, and a standing
   conditional invitation is fulfilled only if the whole task is complete.
4. The response call receives committed task status and actual party membership.
   It authors the final scene and speech afterward. Provisional planning prose is
   not used as the final scene for an adjudicated exchange.

This preserves the usual planning, response and cache calls; it adds no separate
model request. A response failure after commitment returns the authoritative
receipt and a delivery notice, rather than hiding a completed task behind an
error. No world prose is procedurally substituted.

The authored instruction and success criterion are authoritative. A relevant
question counts when the task allows questions, even if its broad exchange label
is share_memory. Asking how to finish a task is distinct from actually performing
its requested exchange. The LLM still judges meaning; the engine does not award
success by a keyword or by a player assertion about physical work. Item, puzzle,
reading and combat receipts retain their separate requirements.

ConversationAdjudication log records expose the verdict, explanation, evidence,
task status and actual recruitment result. Existing tasks are compatible; no
quest reroll, character regeneration or saved-world rewrite is performed.

## Character Clicks

Clicking a resident with a known request opens the ordinary character sheet and
actions. Recruitment Invitation remains a separate explicit request/progress
action. An automatic offer is shown at most once for the same request in the run;
Accept, Decline, Not Now, invitation-flag changes and stale offered packets do not
force it back over the sheet. Genuine service offers outside this request flow
retain their existing behavior.

## Activation

Save and close the game, then run:

```powershell
pm2 restart gameServer
.\tools\update-helpers.ps1
```

Reopen the saved game and retry the previously unevaluated question. A new game
is not needed. The updater checks the exact verified release and all three
selected local or website helpers; gameServer2 is untouched. Tests use fake model
transport, not paid requests. Live browser verification remains necessary.
