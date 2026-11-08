# Popup Viewport And Handoff Fixes

Dialogs now constrain their rendered size to the viewport after accounting for
the existing UI scale. They expose scrollbars without moving or resizing the
world, combat map, console or log panels. Recruitment details scroll separately
from the accept/decline controls. Save slots use shrinking inputs and full-width
metadata rows, retaining all ten slots and the existing save/load behavior.

Shared sizing never sets a popup's position or transform. Exit confirmations
retain their original right-side anchor between the console and log, and other
owner-positioned action menus retain their own anchors. Centered recruitment and
service dialogs keep the explicit centering provided by their own UI code.

Each deliberate repeat of a saved recruitment refusal gets an engine-owned
utterance ID. The same response cannot play twice through duplicate transport,
but a later player request can replay the refusal without a new model call,
decision roll or recruitment offer. Ambient speech deduplication is unchanged.

Private opening-quest preparation can retain an incidental starter contact who
has since joined, died or departed. At handoff, absent incidental scene contacts
use the existing authored fallback writing. Genuine task recipients and all
required items, objectives and evidence remain bound and validated. This does
not respawn residents, rewrite authored text, regenerate the quest or rebuild
the adjacent room.

## Verification

- `node --test tests/popup-viewport.test.cjs tests/commerce-ui.test.cjs tests/window-ui.test.cjs tests/save-games.test.cjs tests/subtitle-diagnostics.test.cjs tests/group-recruitment.test.cjs tests/opening-quest-preparation.test.cjs`
- `node tests/run-popup-viewport-probe.cjs --report` runs an isolated headless fixture.
- `node tests/run-popup-viewport-probe.cjs --serve` serves the same fixture for a controlled browser when local headless processes are unavailable. It never connects to a running game, writes a save, or calls a model. Close it after testing.

The fixture exercises long real recruitment requests, all ten real save slots
and an oversized generic action menu at UI scales 1, 1.3125, 1.75 and 2.25.
It also verifies exit and combat-target menu anchors independently of modal sizing.
Browser evidence covers 1680x950, 1024x700, 540x900 and 640x480 viewports.

The release verifier compares the full suite to the previous known-failure
baseline and rejects new failures or concurrent edits. The PowerShell updater
checks that exact release, coordinates all three selected helpers, and never
restarts either PC server. New browser asset versions apply after reopening;
the backend handoff and refusal changes require a normal server relaunch.

```powershell
.\tools\update-helpers.ps1
```
