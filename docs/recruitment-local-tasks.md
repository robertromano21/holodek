# Room-Local Recruitment

New requests use real targets, selected before the model writes the offer. When both retrieval and puzzle targets exist, selection is 45% retrieval, 45% puzzle, 10% conversation. One available physical kind receives 90%, conversation 10%. Without those targets, actual unread chapters, known hostiles and conversation remain available. Selection is stable for the resident, run, room and floor. The author still creates the title, instructions, motives and dialogue.

Retrievals favor actual secret-chamber loot when available, but never expose hidden routes. Protected quest objects are excluded. A book retrieval may also bind one real stored chapter from that same book. The engine verifies the reading receipt and actual item transfer; invented objects, spoken claims, inspecting a cover and changed chapter text cannot substitute.

If the book requires research, an early handoff keeps the book in inventory and explains which chapter is still needed. It cannot strand the task by taking the book before the player reads it.

The former timed-watching task is no longer authored or advanced. Old unfinished requests of that type are explicitly withdrawn without rewards; invite the resident again for a new request. Physical requests from existing saves retain their original targets and evidence. Task sheets omit obsolete mechanical instructions, including negative instructions about retired commands.

## Joining Time

The response schema offers two choices for physical requests:

- `after-task`: the resident waits until agreed work is complete.
- `help-here`: after the player invites them and accepts the request, the resident joins provisionally to help in that room. The offer explains the limitation and includes an authored future farewell.

A provisional companion carries a saved `recruitmentLease` bound to the run, origin room/floor and mission. Finishing the accepted conditions promotes them permanently; group members still require all agreed group conditions. Leaving early removes only that provisional companion, restores the original resident at home with their current health and belongings, and delivers their authored farewell. Streets, interiors and native stair travel share this logic. Permanent companions are untouched. A stale origin fails explicitly rather than discarding a character.

Explicit dismissal also leaves the provisional companion in the room. Stale browser snapshots cannot add them back after either kind of departure.

Actual physical completion is committed before the next narrated response and goes through the existing authored acknowledgment pipeline, without another completion click. Conversation requests retain the existing same-turn adjudication. No new paid planning call is introduced.

## Rescues

The regional quest system already supports guarding encounters, freeing a prisoner and a live escort. Its opening contact can now explicitly join forces for the rescue outside the starter room. The existing evidence gates remain: joining does not defeat guards, free the prisoner or complete the escort; recovering testimony is not a successful rescue.

## Activation

Close/save the game, restart only `gameServer`, then run `tools/update-helpers.ps1` and refresh the browser. The updater checks the exact tested release and uses the selected local or authenticated website helpers. It never restarts either server. `gameServer2` is unchanged. No live saves are edited during verification.
