# Holodek playtest

Plays the real game in a browser the way a player does and records everything, so agents can run it and a developer can watch.

## Run
```powershell
powershell -ExecutionPolicy Bypass -File tools\playtest\run.ps1                 # visible, fast, port 3001, leaves the server running
powershell -ExecutionPolicy Bypass -File tools\playtest\run.ps1 -Speed slow -Port 3002 -Label mytest -StopAfter
powershell -ExecutionPolicy Bypass -File tools\playtest\run.ps1 -Headless -Scenario tools\playtest\scenarios\full-pass.json
npm run playtest
```
Options: `-Folder` (game folder, default this repo), `-Port` (default 3001; 3000 is refused), `-Label` (pm2 name `gameServer-<label>-test`),
`-Scenario`, `-Speed fast|normal|slow` (12/40/90 ms per typed character, 0.6/1.5/2.5 s after each response renders), `-Headless`, `-StopAfter`, `-StartOption` (start-menu choice, default 2).

## What it does
1. Starts or restarts `gameServer-<label>-test` under pm2 (autorestart on, since the game quits when its last window closes), from `-Folder`, on `PORT=<port>`. It never touches `gameServer`.
2. Polls `http://localhost:<port>/assets/index.html` until it gets a 200, or fails with a clear error after `-ReadyTimeoutSec` (default 120).
3. Launches its own Chrome: incognito, a separate `--user-data-dir` (`playtest-run/chrome-playtest-profile`), and a random debugging port. The driver checks that the port is owned by the PID it launched, then attaches only to the page whose URL starts with `http://localhost:<port>`. All input goes through DevTools-protocol calls scoped to that page; there are no OS keystrokes and no other windows are touched.
4. Runs the scenario through the in-page start flow (types `Start`, picks the menu option, clicks the setup screen's **Save and Continue** and any other start buttons), then types each command into `#chatuserinput` and presses Command, which is the normal `/processInput7` pass. It waits for the real model responses.
5. Stops and reports if the server stops answering mid-run. The window stays open at the end unless the run is headless or `PLAYTEST_CLOSE=1` is set.

## Scenario steps (`scenarios/*.json`)
`{"start": 2, "click": ["review-save-button", "Save and Continue"]}`, `{"command": "north"}`, `{"walk": "north"}`, `{"walkNext": {"avoid": ["south"]}}`,
`{"book": true}` (reads a shelf/inventory book and its chapter 1), `{"screenshot": "name.png"}`, `{"wait": 1500}`, `{"state": "label"}`.

## Output: `<Folder>/playtest-run/`
`turns.log` (console inputs, clicks, walks), `requests/` + `requests.log` (full client request bodies), `states.jsonl` (game state after each step),
`model-calls.jsonl` (each model request and raw response, written by `capture.cjs` in the server), `browser-console.log`, `server.*.log`, screenshots.
Each run moves the previous files into `playtest-run/previous-<timestamp>/`.

## Key
`$env:OPENAI_API_KEY`, else `<Folder>\playtest.key` (gitignored). It is never printed; it is removed from the launching shell once pm2 has it, and key-shaped text plus the exact key value are redacted in the logs.
No installs: Node 22+ built-in `WebSocket`/`fetch`, plus the installed Chrome.

## Live room-editing sandbox (test servers only)
Enabled only when `HOLODEK_DEV_SANDBOX=1` AND the port is not 3000 (`run.ps1 -DevSandbox`, and `start-pm2.ps1` on the 3001 test copy). It is never on by default or in live.
- In the page (DevTools): `__holodekDev.apply({op, ...})`. `__holodekDev.ops` lists the ops.
- HTTP: `POST /dev/room` with one op or an array of ops. It accepts localhost connections only and returns each op's result once the open page applies it (10 s wait).
- Ops:
  - `place {shape, x, y, z?, size?, palette?, id?}`: any registered voxel shape. City-kit names get `__v0` added automatically (fountains, aqueduct_arch, city_gate, harbour_crane, ...).
  - `move {id, x, y, z?}`, `rotate {id, deg}` (quarter turns swap the footprint), `scale {id, factor | x,y,z}`, `remove {id | art}`.
  - `style {biome?, theme?, palette?, lighting?}`. Palettes and lighting come from DesignCatalog.
  - `cell {x, y, tile, floorHeight?, ceilHeight?}` (re-wall or open floor), `resize {width, height}`, `exit {direction}`.
  - `spawn {kind: npc|monster, name}` and `encounter {surprise?}` go through the normal console path.
  - `snapshot {name}` / `restore {name}`, `list`, `shapes`, `focus {x, y}`.
- Every edit restamps the room geometry, so the renderer rebuilds instantly. Edits live only in that page's room (the test save).
- Scenario step: `{"dev": {op...}}`. Positions accept `"@px"`, `"@py-4"` (relative to the player). See `scenarios/city-kit-showcase.json`, which shows one building at a time with screenshots.

## Model modes
`mock` (default, zero API calls) | `hybrid` (`-Hybrid` / `HOLODEK_LIVE_CALLS`) | `live` (`-Live`) | `agent` (`HOLODEK_MODEL_MODE=agent`: narrative calls are queued for an agent to answer; see ANSWERER.md).

## Permission rule
No test session starts without the user's explicit permission. `run.ps1` and `run-visible.ps1` show a native, topmost Windows dialog titled **Holodek Test Session** that lists the mode, port, folder and whether the API key will be used. The session starts only on **Yes**; No is the default button. The dialog appears in the user's session, including when the scripts run through the interactive scheduled task. Agents must not launch sessions on their own. `HOLODEK_TEST_APPROVED=1` skips the dialog and may only be set by the user.

## Live control channel (steer a running pass)
While a pass runs, append JSON lines to `<Folder>/playtest-run/control/inbox.jsonl`; results go to `control/outbox.jsonl`.
`{"id":"1","cmd":"pause"}`, `resume`, `{"cmd":"speed","speed":"slow"}`, `{"cmd":"type","text":"look around"}`, `{"cmd":"click","text":"Save"}`,
`{"cmd":"goto","x":0,"y":1,"z":0}`, `{"cmd":"scenario","file":"scenarios/x.json"}`, `{"cmd":"sandbox","op":{...}}`, `{"cmd":"builder","tab":"Setting"}`,
`{"cmd":"screenshot","name":"x.png"}`, `status`, `stop` (closes only this run's own window).

## Option-4 new-world scenario
`run-visible.ps1 -World weird-west-world` (or `WORLD_SPEC=<file>` for the driver) runs Start → 4 → genre picker → game prompt → master prompt →
additional instructions → Start this world → option 3 character creation (the world's generated classes and races) → first room, with screenshots
`nw-01..nw-09`. Scenario files: `scenarios/weird-west-world.json`.

## Headless checks
`node headless-check.mjs <steps.json> <screens-dir>`: each step is `{goto}`, `{name, eval, shot?, wait?}`. A step that throws returns
`THROWN STEP <name>: <reason>`, so a broken link in the option-4 path fails loudly with its step name. Set `HOLODEK_STARTUP_GRACE_MS` high on a
headless server, or it shuts down when the last game window closes.
