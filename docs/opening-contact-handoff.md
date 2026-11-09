# Prepared Quest Contact Handoffs

The reported travel attempts reused a completed adjacent room, then failed when
binding the private opening quest. Preparing the quest before starter recruitment
can leave a required scene contact recorded as a resident after they join the
party. The generic scene validator rejected that stale resident reference.

The handoff now recognizes a living companion only when the party sheet, combat
roster and original recruited population record agree. Its presentation uses the
existing authored readable introduction and conclusion. Actual objective names,
items, delivery recipients, coordinates and completion requirements remain intact.
Item delivery to that companion at the bound location uses the normal verified
transfer receipt. Arbitrary gifts to shared-inventory party members remain blocked.

Dead, departed or unconfirmed required contacts still fail validation. Rejections
now include the exact stage, room and reason in `OpeningQuestPreparation` logs.
The current private artifact is held in the running process, so the precise stage
of an older rejection cannot be recovered from its original generic error alone.

Regression coverage includes delivery and research handoffs after recruitment,
missing/dead/unconfirmed contacts, unchanged objectives, idempotent activation,
and legitimate versus invalid companion deliveries. No new model request, quest
regeneration, live-session migration or saved-game rewrite is introduced.

After verification, close and relaunch Holodek, then run
`.\tools\update-helpers.ps1` before testing. It verifies the pinned release and all
three local helper slots, or updates the three selected authenticated website
helpers. Neither server is restarted by the updater; gameServer2 stays untouched.
