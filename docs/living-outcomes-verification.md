# Living-World Integration Baseline

## 2026-11-10 Browser Findings

The approved isolated test runs on port 3001 under
`.retort-data/living-outcomes/test-game`. Neither production PM2 server was
restarted. Testing moved from the ChatGPT browser to the player's Chrome
Incognito window; the ChatGPT tab was closed.

The starter room rendered, its regional footprint was reserved, and the opening
quest preparation completed. The three authored communities in the Chrome run
were The Cinder Choir, The Glass Scriptorium and The Silted Measure.

Adjacent construction exposed an integration defect twice: `bindPopulation`
marked residents as materialized inside the worker's root regional record.
The host correctly rejected that unauthorized root write, discarding otherwise
valid room content. The Chrome run also recorded a separate provider connection
reset during inhabitant generation.

Population binding now returns tagged actor records without changing the shared
region. Name reservation derives its lookup on a copy. The existing host turn
derives materialization only from committed actor records; ownership checks are
not relaxed and no shared regional state is imported from helpers.

Regression tests cover the exact rejected checkpoint, concurrent host changes,
both parallel commit orders, failed construction and persistence round trips.
They fail on the previous implementation and pass after the fix.

## Corrected-Build Browser Findings

The next approved Chrome run confirmed the corrected engine hash and rendered
the starter room. Its saved checkpoint is slot 2, `Living-world corrected build:
starter`, in the isolated test directory. Three routes were reserved and the
population checkpoint committed, but geometry exposed a second authority issue:
sealing a regional goal item also changed the worker's shared resident records.
Another objective room had no usable hidden chamber on its sloping ground.

Construction now returns regional objects without publishing their global
bindings. The host derives a binding from the exact goal/item IDs, closed door,
chamber floor and placed scene object, rejecting stale or mismatched evidence.
Ordinary secret-chamber bonus loot is still additional. Only engine-reserved
hidden-objective sites permit a small enclosed foundation on a modest slope;
ordinary secret generation and cached geometry remain unchanged.

An actual worker-thread regression reproduces the old shared write and passes
with the new authority boundary. The Chrome game is paused for the next
player-controlled restart. It has not yet proved a complete community loop.

## Still Required

The actual-browser integration baseline is **not complete**. After activating
the verified release, resume the saved isolated game and prove all three
communities, a request and successor, autonomous travel and delivery, accepting
work during a pending plan, and save/load during each activity.

New quest consequences and project/objective capabilities remain deferred until
this baseline is reliable. No synthetic or in-memory test is presented as a
browser playthrough. Native Chrome input recovered on the next run by selecting
the fresh returned window and maximizing it. Save slot 2 was created and verified
through the real game UI, without overwriting the earlier checkpoint.

## Release Commands

The standard helper updater is pinned to the exact verified source:

```powershell
.\tools\update-helpers.ps1
```

It refuses stale source and a mismatched running engine. Server restarts remain
player-controlled. The isolated test's native approval launcher is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .retort-data\living-outcomes\start-browser.ps1
```

Save and close its existing Chrome window first; the launcher refuses an occupied
port. Reload the isolated save rather than replacing production saves.
