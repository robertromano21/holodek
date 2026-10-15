# Local Save Games

Menu > Save / Load Game offers ten named slots. Save after a command or combat
round has finished. Each checkpoint combines the server's complete adventure
state with the browser's conversation, party, inventory, camera, explored map,
memories, sprite recipes and music position. Loading leaves the game paused.
Press P outside the command input to resume.

## Closing the Game

Menu > Quit Game offers Save and Quit, Quit Without Saving, and Cancel. Quit
stops the local server and releases port 3000, then displays a closed-game page.
Browsers may not allow a normal webpage to close its own tab.

Closing the last game tab or browser window also shuts down the server after
a 10-second grace period. Refreshing or returning within that interval cancels
shutdown; other open game tabs keep the server alive. Closing the browser does
not automatically save. Use Save and Quit to preserve your progress.

For PM2, launch with `pm2 start ecosystem.config.cjs --only gameServer` so an
intentional Quit stays stopped instead of immediately restarting. Existing
PM2 entries can load these settings with
`pm2 startOrRestart ecosystem.config.cjs --only gameServer --update-env`.

## Storage

Files live in `.retort-data/saves/slot-01.json.gz` through `slot-10.json.gz`.
They are compressed, checksummed and verified after an atomic write. Overwriting
a slot keeps its previous file as `.bak`. Conflicting/stale slot selections are
rejected. Never delete `.retort-data/saves` when cleaning disposable caches.
Copy that folder elsewhere if you want a backup.

Both `.retort-data/` and `sid/` are Git-ignored runtime directories. Ignoring a
directory does not delete it or prevent accidental manual deletion.

## Reconstruction

Only the current room's graphics and music are rebuilt at load. Other visited
rooms rebuild on entry. Reconstruction uses saved layouts, visual styles,
scene/custom-tile recipes, character traits/seeds and complete music scores.
It does not ask the LLM for new content, respawn loot, reroll characters, reset
puzzles or award quest rewards. The two-slot room WAV cache remains disposable;
WAVs are not copied into saves. The 8580/10582 versions can be rendered again
from the same score. Ambience and effects use the installed procedural engine.

Character images already embedded as data URLs also survive cache cleanup.
Optional remote room illustrations lack a procedural recipe, so their image
bytes are embedded in the checkpoint rather than saving an expiring URL. If an
illustration cannot be read, saving reports an error rather than promising an
incomplete checkpoint. Older pre-seed legacy texture noise can look slightly
different after reconstruction; new sprite rendering is seeded and repeatable.

## Existing Live Sessions

`tools/install-live-save.cjs` is an explicit operator-only bridge for a server
that started before save support was installed. It briefly attaches to the
verified local Node process, reads its exact private state bindings and adds
save-only routes without restarting gameplay. Its inspector is closed afterward.
The browser can load `/assets/saveGameUi.js` without refreshing the adventure.
Loading requires the updated server build and a refreshed game page.

`node tools/verify-save.cjs 1` verifies Slot 1 and reconstructs its current room
and full song in an isolated temporary directory. It never loads the checkpoint
into the active game or writes over its generated assets.
