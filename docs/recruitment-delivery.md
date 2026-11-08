# Recruitment Delivery And Conversation Evidence

Ordinary approach is not an invitation. Residents greet the player, work, or
converse. The designated Children of the Grave starter contact proposes a
grounded joining request only after the player actually invites them.

The invitation response is delivered in speech before the request popup. The
popup provides Accept Request, Decline Request, and Not Now, without a job-list
detour. Unrelated canned chatter and reply-attention holds do not postpone it.
Compact current-room request descriptors accompany encounter responses, even
before the next full room-database update. Saved pending requests remain
accessible from the character sheet. No saved quests or identities are rewritten.

Conversational tasks use a conversation condition, not survey. The existing
live-speech model call judges the current player reply and returns a structured
fulfill-conversation proposal with exact player-text excerpts and condition IDs.
The engine validates scope, the actual request, recipient and excerpts, records
the evidence, verifies all conditions, then commits completion and any standing
conditional recruitment before returning the final narrative and state. No
separate model call or observe/report command is required for a purely spoken
favor. Voluntarily performing an offered conversational request is acceptance;
merely asking about it, promising, declining or approaching is not fulfillment.

Physical tasks retain their existing evidence requirements. Dialogue cannot
substitute for an item transfer, puzzle state, observation or combat receipt.
Finishing a request without a player invitation does not recruit the resident.
Old incorrectly authored survey requests are not silently reclassified; their
stored mechanics remain intact. Ilyra's existing request was already completed
and recruited her before activation of this release.

RecruitmentUi diagnostics identify received, queued, waiting, shown and
unavailable requests. Reports are scope-checked, deduplicated and bounded; they
do not mutate gameplay or call the model. Completed room arrivals no longer
leave the popup gate permanently pending. Labelled live speech remains
authoritative so quoted engine commands are not spoken as resident dialogue.

After closing/saving the game, activate the exact verified release:

```powershell
pm2 restart gameServer
.\tools\update-helpers.ps1
```

The updater verifies the source and all three selected local or website helpers.
It never restarts gameServer2. Tests use fake model responses; no paid calls or
live saved-world edits are performed. Browser playback still needs a live test.
