# Journal and First Regional Adventure

The shortcut stack is Inventory, Adventurers' Journal, Map, from top to bottom.
The journal is read-only and usable while paused or resolving combat. It shows
exact objective metadata, planned destinations, verified readings and encounters,
separately labelled rumors, faction standings, accepted local contracts and the
completed-obligation archive. It never projects room loot lists. Confirmed facts
remain after the active quest moves on.

## First Adventure

The first main quest keeps the existing three-step campaign structure:

1. A connected regional obligation, authored by the LLM and compiled by the engine.
2. The existing bound boss-key retrieval task.
3. The existing bound boss fight and artifact recovery.

One bounded LLM request supplies the title, personal stakes, six mortal character
histories, short dialogue, misleading rumor, written evidence and four site
flavors. It cannot supply effects, completion rules, keys or artifacts. The
compiler validates names, lengths, the stage graph and the entire task binding.
It uses an existing open surface route into an unvisited outdoor destination,
preserving its published name, then reserves a graveyard, a dangerous road and an
indoor hostile temple. Existing described rooms, the entrance and the bound boss
room cannot be repurposed. Reserved route edges cannot be randomly locked by the
ordinary room generator. Other room generation, objects, puzzles and inhabitants
continue normally; the reserved characters receive real balanced Fighter sheets
when their rooms are populated, never phantom dialogue-only identities.

The stages are acceptance, an actual burial-record reading, two verified road
defenders, two verified temple jailers, explicit prisoner recruitment, and living
escort arrival at the named oasis. A neutral prisoner need not be friendly before
the rescue conversation permits recruitment. The player settles the obligation
with an explicit faction-stewardship choice. Every transition has an engine-owned
receipt bound to the immutable task; narration cannot satisfy a stage.

If recruitment is impossible, or the prisoner dies or leaves before arrival,
there is a real prison-testimony reading and return route. The journal records
that outcome as recovered evidence, not a successful rescue. Dead conversation
witnesses leave placed covenant/charter writings as fallback interactions.
Current geometry, line of sight, range, run identity and scene revision are
validated for interactions. Ordinary recruitment cannot bypass staged defenders
or the prisoner bargain.

## Faction Memory

The Cistern Compact and Ashroad Fellowship remember the final decision through
an exactly-once engine ledger. Standings and the actual choice are available in
the journal, subsequent room-generation context and character-dialogue prompts.
These remembered facts influence characterization, not free rewards, allegiance
changes or automatic quest completion. Client snapshots cannot overwrite the
ledger, scene proofs, reserved actor state or the relevant writings.

## Fallback and Activation

The older task generator remains the path for subsequent main quests. Invalid
LLM output, an unsuitable existing route or an inaccessible current-room writing
falls through to that generator without publishing partial reserved rooms. There
is at most one regional-generation attempt per campaign. An already active task
is not replaced.

To disable the new first-adventure generator, set `REGIONAL_ADVENTURES=off` before
starting the server. This does not remove the journal or disable verification of
an already saved regional story. `QUEST_STORIES=off` also selects the older path.
No live campaign is rewritten and no running server is restarted by this change.
Restart the server, refresh the browser and start a new campaign to test the new
first-adventure generation.

Focused tests: `node --test tests/regional-adventure.test.cjs tests/adventure-journal-ui.test.cjs tests/quest-integration.test.cjs`.
Isolated browser checks: `node tests/run-dungeon-ui-probe.cjs --journal-only`
and the same command with `--narrow`; both test 100%, 175% and 200% UI zoom.
These use mocked data, no paid model calls and no live session mutations.
