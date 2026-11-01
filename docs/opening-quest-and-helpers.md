# Opening Quest And Room Helpers

Room helpers default to this PC. Menu > Helpers / Website AI selects local or authenticated website execution. Local jobs share a three-worker ceiling, run the selected model directly through the existing PC provider configuration, and are terminated through the normal game shutdown path. Cloud API models still incur their normal costs; running helpers locally does not make inference local.

After the first room is displayed and its action finishes, adjacent topology is reserved and the opening quest is authored privately using the existing quest authoring and task compiler. Background work never advances a turn, changes the active quest, grants a reward or rewrites the live party. A second acknowledgement cannot dispatch another opening quest. Changing run, restored save, model or helper settings invalidates the result.

Before displaying the selected second room, entry joins the existing preparation, binds its introduction to that room, installs required local objects and writings, and checks that they are reachable. A failed placement blocks publication instead of adding content after the player arrives. Existing discoveries, pickups and completed scenery are preserved. Quest activation reuses the pending construction context so other adjacent builds are not cancelled just because the quest became visible. Later rooms reuse the same active quest.

Preparation can overlap exploration; it cannot guarantee zero wait if the player leaves before model calls finish. The renderer must also finish its own resource preparation. Check `OpeningQuestPreparation`, `AdjacentRoomBuild`, `RoomPrefetch` and `PreparedRoomEntry` log events separately.

`node tools/review-prompts.cjs` exports static authoring templates and example/name leads to `.retort-data/prompt-review/index.md`, without reading credentials, saves or player dialogue. Recent-world names are retained as history but no longer injected into authoring prompts or used to reject an otherwise valid answer. Exact identity checks inside the active world remain in force.

After source verification, `tools/update-helpers.ps1` verifies the selected helper mode. Local helpers use the current verified source automatically, without SSH or a website deployment. Website mode keeps the existing pinned SSH identity and three-helper deployment checks. The updater never restarts either PC server.
