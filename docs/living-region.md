# Living region and living world (v6, on by default)

A small authored region layered onto a new campaign: three communities, each with a real problem and a damaged landmark, named
residents with requests the engine can actually complete, and an append-only ledger of what happened. It is **on by
default**. Main quests are unchanged; regional work never completes a main-quest step, and regional
standing never overrides a recruitment refusal.

It follows the normal world-flag convention (`retort/worldFlags.js`): `LIVING_REGION` defaults to on. To disable it,
set `HOLODEK_LIVING_REGION=0` (or `off`) in the server environment and restart the server. A region is authored only
for a **new** game; saves from before it was on are left alone.

## Authoring: the gameplay plan comes first

Every new game authors its region from scratch with the game model; there is no template, sample content or cache.
Loading a save restores that save's region.

1. **Engine plan (no model call).** Each resident slot gets a supported player action and world consequence before any
   text exists: `r1` = hidden chamber + rebuild the landmark (`restore-fixture`); `r2` = existing physical mechanism +
   trust (`earn-trust`, nothing physical). The model never chooses an obstacle or an effect.
2. **Communities.** Name, indoor/outdoor, landmark name, its **purpose** (what it does when it works), its **damage**,
   its **visual form** (a neutral buildable shape — `upright`, `frame`, `slab` or `column` — drawn with the active
   genre's own kit piece when the genre has one), the community **problem** caused by that damage, and the observable
   **improvement** once it is rebuilt; plus why a closed way on and danger on the way matter. Purpose and form are
   separate, so the shape menu does not steer the fiction.
3. **Residents, against the fixed slots.** Name, the goal object, the resident action (what they do with the delivered
   object; it must produce exactly the slot's consequence), how the object came to be where its obstacle keeps it,
   personal meaning (hopes and fears may be larger, as hopes only), history, traveler. The goal text is composed:
   "Bring <object> to <resident> so they can <resident action>."
4. **Review (second line).** One review pass reads every player-facing field, by path, against the same authoritative
   **PERMITTED EFFECTS** block that every stage (authoring, repair, review, social, successor) receives. It runs in focused
   parts: one call per community, covering its landmark chain and every resident's action, backstory, meaning, and
   history together. Only the flagged text fields are rewritten, once per part; gameplay fields (people, objects, obstacles,
   consequences) are never offered for rewriting. A failed review part is recorded in the trace (`failedParts`) and
   leaves that text unchanged; it does not block the game.

Engine checks are structural only (names, duplicates, IDs, choices, coordinates, a goal object that is not a person).
There is no verb or outcome blacklist and no name matching of the consequence. A stage with structural problems gets
one targeted repair that may change only the listed fields; a stage still invalid is recorded in server diagnostics,
and an explicit retry resumes at that stage. Authored prose is stored in full without arbitrary name, response, or
prose character limits; only prompt excerpts are shortened.

**Deferred social detail.** Relationships, history facts with beliefs, and companion stakes are authored after the
region is playable, as a background job started by `ensure` and merged by `turn`. One retry; failures remain in server
diagnostics. They are context only; nothing playable waits for them.

## What is real (engine state)

- **Footprint reservation (before any helper builds).** When the region is authored, `ensure` reserves and saves a
  connected footprint for each community in the same write: route cells from a reachable, unbuilt frontier cell, the
  community room (a skeleton record named after the community), one objective room per resident on the route, one side
  room per resident for its successor request (the opposite obstacle), and the closed passage. Each has real coordinates
  and explicit links (`route.footprint`). Cells owned by an in-flight helper build, built rooms, city, boss, regional and
  aimed cells are never reserved. If no straight route fits, a connected extension is searched from the frontier
  (built rooms are not altered) and recorded as `route.extension`.
  The attempt is `generated` only when every community is reserved; otherwise it is `footprint-blocked` and retried
  each turn without a setup notice in the player log.
- **Obligations in helper assignments.** `registry.describe` includes `livingRegion` for a footprint destination:
  required exits (both directions), role, community identity, resident slots, objectives, fixture and route context.
  The worker's work order quotes them; the PC and worker prepare passes add the footprint links whatever the build order,
  and unrelated rooms' random exits never link into the footprint. The foreground room path applies the same pass.
- **Commit validation.** `Build.commit` checks a returned footprint room (`LR.checkArtifact`): a missing route exit is
  restored when the neighbour is unbuilt or points back; a wrong community name or tag, a missing resident, a missing
  mechanism, an unverified installed mechanism, no closed hidden chamber, or a missing landmark rejects the room
  (`LIVING_REGION_OBLIGATION`, not retried); nothing is written. Objectives bind to their reserved room first, then fall
  back to the previous opportunistic placement.
- **Reachability.** The route becomes traversable only once open exits lead there. Players discover the community by
  following those exits and meeting its residents, not from a route-planning announcement.
- **Residents.** The community room is marked `encounterDanger: 'safe'` before its population is planned; regional
  residents take reserved slots in the normal inhabitant pipeline (full sheets, stats, equipment); reservation is all
  or nothing and an incompatible site is rejected and re-planned without revealing it to the player.
- **Obstacle 1: hidden chamber.** The item is sealed in a secret-door chamber of a route room (or the next reachable
  non-community room with one) by the hook in `secretRoomLoot.prepare`, stored like the engine's own chamber loot.
  The player searches (d20 vs DC 5, retryable), opens the panel, takes the item.
- **Obstacle 2: existing physical mechanism.** The goal binds to a room's saved `puzzleMechanism` only when it is valid
  and unsolved **and** its geometry is installed (`dungeon.physicalPuzzle` with the same ID, `verify` valid). Never the
  start room, a community room, a room the main quest's current tasks point at, or a room another request uses (each
  resident's object is in a different room). When the committed puzzle state becomes `complete` (the normal puzzle
  action path), the finalize hook places the object on free floor beside the mechanism's receiver as a room object and
  a fixed scene object; the turn lists it on the ground. The favor's conditions are the favor system's own `puzzle`
  (that mechanism) and `retrieve` (that object, to that resident).
- **Advertising.** A request is offered only after its object is sealed or its mechanism is bound; until then the
  resident's wait is told once.
- **Favors.** The first request is the resident's favor in the favor system's own record format, verified by its own
  `retrieve`/`puzzle` checks and completion receipt. Unrelated or forged favors resolve nothing. The stranded-goal guard
  reports any conflict with an unrelated favor.
- **One authoritative record per task.** A regional quest stores the mission ID (or, for a successor, the goal ID) and,
  once consumed, the receipt. Quest status is derived from the mission record (`questStatus`: active, verifying,
  completed only with a consumed receipt, unbound when the mission failed or was withdrawn); goal status is derived
  from that (`goalStatus`). Neither is stored.
- **Landmark consequence.** The landmark is a structure in the room's saved geometry: damaged until the goal is
  resolved, then rebuilt; placed only on safe open floor that cuts no route; written with `setRoomDungeon` and kept
  through save/load. With no safe site nothing is claimed; it stays "not yet visible" and is retried.
- **Access consequence (`reopen-passage`).** A route's side passage is a real blocked exit; completing a request with
  this consequence opens it in both directions. It is only planned when that exit exists and is still blocked.
- **Successor request.** A verified completion of a first request queues one next request for that resident, caused by
  the committed change (`causedBy`: mission ID, receipt, consequence). The engine fixes it before any text: the other
  obstacle, and `reopen-passage` if the community's real exit is still blocked, else `earn-trust`. The model authors
  only the new object and why it matters now (background job, same PERMITTED EFFECTS, one review). It is not a second
  favor mission (the favor system keeps one per resident and that mission carries the recruitment bargain); it is
  verified by the engine's give-item receipt for that tagged object to that resident. One successor per first request.
- **Rest.** Only a committed lodging receipt in a community room is a rest moment. **Combat.** A resident who dies
  ends their goal, recorded from engine state.

## Living world: who takes part, and how

**Taking part in the world's history is universal; actively pursuing a plan is selective.** `retort/livingWorld.js` is an
index and a history over the game's existing authoritative records. Each person still has exactly one record for
identity, location, inventory and tasks (their inhabitant record in their room, the mission records, the party sheets).
The world layer stores history only (`region.world.people`). It never copies HP, location or items, and it never
creates a second "simulation character".

### Participation tiers

| Tier | Who | What is kept or done |
|---|---|---|
| **Persistent history** | Every named character who has been part of a verified event: party members, anyone the party traded with, fought, helped or took work from, or spoke with on 3 or more turns | Events, witnessed facts, promises (missions offered, accepted, completed, abandoned), recruitment (party joins and leaves), injuries (survived at 0 HP, defeated), relationships, and importance |
| **Regional involvement** | Authored and adopted residents, plus persistent (non-party) people who live in a community room or have heard of a community's events | Also what they know (beliefs), which feeds their dialogue; their community's reputation; their circumstances change only through engine events |
| **Active goals** | At most **4** people within **3** rooms of the player: residents with an open request, then important persistent people | Recomputed every turn. Leaving the area demotes them back to history, which is kept. Only these people take initiative |
| **Background life** | Crowds and incidental figures | Not registered at all. They become persistent the first time a verified event involves them |

**Emergent importance.** Anyone can become important through play. Once someone in the active cast has importance 3 or
more (verified interactions, trades, help), is not a party member, has no accepted work, is not named in the main quest and
is alive, the world queues an **adoption**. One background authoring call (the same successor call residents use, plus its
review) authors one request for them. The engine fixes the obstacle (an existing built mechanism) and the consequence
(trust). Their **existing** record is tagged; they keep their name, room, HP, history and inventory, and gain a regional
role. Adoptions are capped at 3 per game, run one at a time, and get one retry, then a visible failure.

### What each story system contributes (verified events only)

Every source is an engine-committed record. Each event is ingested once (by its record id) as a `world-event` ledger fact,
with its source, category and witnesses.

| System | Source | Category |
|---|---|---|
| Main quest | journal entries (`engine-journal-v1`), campaign memory `verified-quest-gate` | main-quest |
| Jobs and favors | `room.minorMissions` (`engine-local-contract-v1`, `engine-resident-favor-v1`): took on, completed, abandoned | job, favor |
| Combat | `combatLife.defeats` (`engine-combat-defeat-v1`) | combat |
| Injuries | `combatLife` survival saves at 0 HP | injury |
| Exchanges | give-item receipts (`transfer:` memory, `engine-give-item-v1`) | exchange |
| Exploration | first visit to a room with people or a community room; puzzle solutions from dice outcomes | exploration |
| Interaction | adjudicated dice outcomes whose target is a named person | interaction |
| Companions | party roster joins and leaves; a companion acting on a stake in its community | party, companion |

**Narration and dialogue never become facts.** Narrated turn text (`room-turn-narrative`) and speech (`statement`) are
skipped. Repeated dialogue only counts toward making a speaker persistent.

### Knowledge boundaries

- Facts are truth. What a person knows is either something they were part of (an actor or a witness of that event) or a
  **belief** record, which carries the holder, the channel, who it was heard from and whether it matches the truth.
- **No instant omniscience.** A community's other members hear an event 2 turns later at the earliest (`hearsayDelay`).
  They hear it only when the player is near that community again, at most 12 deliveries per activation. A living,
  knowledgeable speaker must actually be there, within hearing range and unobstructed hearing of an already persistent
  listener. A public-news receipt records the transmission. Background crowd figures are not promoted or informed.
- **Plausible channels only.** Word goes onward to a *connected* community (a chained route, an open gate, or a resident's
  travels), with twice the delay. Connectivity schedules an opportunity, not instant knowledge: without a knowledgeable
  person physically present, word remains pending. Companions also tell news, but only when the party rests in a community,
  with the same hearing check and a limit of 6 deliveries.
- Beliefs mirror into campaign memory with **only the holder** as witness, so dialogue recall (which filters by witness
  and speaker) gives each person only what they know. The room prompt lists, per person present, only what that person knows,
  together with the rule not to make anyone know more.

### Reputation

Reputation is computed from what **that community's own people know**, not from the full record:

| Known fact | Change |
|---|---|
| Quest completed for a member | +2 |
| The landmark restored or a passage reopened there | +1 |
| A member defeated by the party | −3 |
| A job completed for a member | +1 |
| A job abandoned | −1 |

Each underlying accomplishment is counted once: the completion, its fixture/access consequence, its mission receipt
and its trust award use the largest applicable credit, not their sum. One request supplies at most +2. Other standing
(including companion events) is added. At **−2 or below** the community is *closed*: no new regional
requests are offered there, with a visible notice, and accepted work is never withdrawn. At **3 or above** it is
*trusted*: its people tell the party the way to another community, with exact directions where a path exists.

### Initiative and companion agency (active cast only)

| Who | Initiative | When |
|---|---|---|
| A resident with a placed request that is offered but not taken | Seeks the party out | On a later meaningful visit to their room |
| A resident with accepted work | Asks after it once; the request stands, no penalty | After 8 or more turns, at a meaningful moment |
| A trusted community | Points the party to another community | When the party is there at a meaningful moment |
| A companion with a stake in a community | Acts on it on arrival; the community's standing rises by 1 for a relative, promise or debt; the companion learns the community's history | Arrival with the party |

There are at most 2 initiatives per turn, and each fires only once. A meaningful moment is travel between communities, a
lodging rest, a completed regional quest, arriving in a community, or a newly verified event.

### Cost and consequence guards

- **Cost.** Ordinary turns make zero model calls. Ingestion is a bounded scan: 16 events per turn, idempotent by record
  id. World facts are capped at 1000, and the ledger at 1500 facts and 3000 beliefs. Verifying the hash chain is cached.
  Model work runs in bounded background jobs at meaningful moments, not every simulation step. `region.world.cost` records `modelCalls.authoring`
  (setup calls), `modelJobs` (social, successor, adoption and resident-plan jobs), and counts of events ingested and skipped,
  activations and steps.
- **Lazy distant state.** Only the player's community and the active cast's communities are brought up to date. Distant
  pending word waits, unchanged, until the player comes near.
- **Guards** are recorded in `region.world.guards` and logged. The world layer never writes tasks or missions, and never
  completes or invalidates a main-quest step or accepted work. Main-quest people are never adopted. Nobody with accepted
  work is given a second request. A contact with accepted work who falls produces a visible notice; their mission record
  itself is left to its owner. A distant development never moves anyone in the active cast. If one name has two
  authoritative records, an identity conflict is logged and nothing is merged.

### Three communities

Three communities with two residents each are authored by default (`LR.CONFIG.scope`). Each community's footprint is
reserved before any helper runs. When the start room has too few open frontier exits, a later community **chains**
onward from an earlier footprint's unbuilt host room. That route records a connector link and waits on the host room
(status `planned`) instead of being marked broken.

## What is narrative only

- **Need pressure** is a ledger fact and a notice with no mechanical effect. **Standing** feeds reputation (see Reputation above),
  whose only mechanical effect is that a community that is closed to the party offers no *new* regional requests.
- **Traveler movement** only changes where an unmaterialized resident will appear: which community's room will generate
  a willing resident who has **not been met yet**. The resident's request and record are kept; a visible notice and a
  development fact record the change. It never relocates anyone already encountered (materialized), and it does **not**:
  - move anyone in the active cast near the player;
  - change a goal, an offered or accepted request, inventory, or any task;
  - kill anyone, end a goal or complete the adventure.
- Relationships, beliefs, history facts and companion stakes are memory and prompt context only.
- Personal meaning (hopes, fears, beliefs) is never what completion does.

## Autonomous Local Actions

Existing residents can now pursue a small, supported action without waiting for the player to accept work.
The model authors intent and speech; the engine supplies selectable actions from real prerequisites, then owns execution.
No example names, scenarios or story templates seed this authoring request.

- **Travel:** walk one traversable tile per game turn to an actual open-exit marker, then cross to the reciprocal marker
  of an already built, peaceful adjacent room. The same actor record moves; identity, health, sheet, inventory and full
  equipment metadata remain intact. Source snapshots are updated so the person does not reappear behind them.
- **Delivery:** walk to a living, non-hostile recipient in the same room and transfer an item the actor actually owns.
  The exact stack and metadata move; no item is invented. Equipped items and bound quest/request items are excluded.
- **Player intervention:** the normal character sheet offers Current Activity, Ask Them To Wait and Let Them Continue.
  The authored person can refuse to wait. These controls do not create or accept a player quest.
- **Revalidation:** closed/occupied routes, missing supplies, changed allegiance, incapacity, combat or newly accepted
  work block progress without granting an effect. Main-quest people, service providers, the starter room and host-local
  city floors are excluded. Existing offered/accepted work is not withdrawn or silently completed.
- **Persistence and cost:** the plan and receipts live on the existing actor, survive JSON save/load, and execute once.
  At most 4 people act within 3 open-exit steps. One authoring job runs at a time, at most 2 plan attempts per person,
  with one retry for a failed authoring job. Ordinary walking/transfer steps make no model call. Simulation advances
  on player turns, not in wall-clock time while the game is closed, paused or awaiting a response.

The first vocabulary is deliberately travel and owned-item delivery. Independent fixture repairs, agreements,
community projects, institutions, regional construction and generational change are not implemented by this layer.
Only committed movement/transfers enter history; authored intentions are never treated as accomplished facts.
The ordinary fixture-restoration and successor-request loop remains separate and player-driven.

### Verification For This Pass

`tests/living-world-integrity.test.cjs` covers hearing-limited news, delayed delivery caps, reputation deduplication and
lossless bounded ingestion. `tests/resident-plans.test.cjs` covers real paths, changing prerequisites, conservation,
equipment/identity continuity, save/load and background-job integration. The three missing-StoryPrompts failures were
VM test contexts missing the production import, not an absent production import; those contexts are corrected.

The release report is `.retort-data/living-world-audit/verified.json`. Real-model harness trials use synthetic room
grids and in-memory state: they are not browser playtests. After restarting, verify all three communities' reachability,
resident/request placement, visible fixture/passage updates, successor work, autonomous activities and save/load in
the actual game. No live server restart or saved-game mutation is performed by this verification pass.

## Known limits

- The released mechanism object is written to the server geometry; the browser draws it on its next room sync.
- **Development and verification target.** The living region is built and checked on the game's default cloud model
  (gpt-6-luna) plus offline mocked tests. The local holodek-1 model is not a target for this feature.
- **Latency on the cloud model (real game path, gpt-6-luna).** Authoring the playable region (plan, communities,
  residents, review in parts) took 11–15 s over 6 calls. Each route room's chamber loot took 2–3 s, and the existing
  puzzle designer took 7–38 s. The community room's normal inhabitant pipeline took 53–143 s when it completed, mostly
  because of that pipeline's own validation retries. A full western run, from world bible to delivered successor, took about 200 s.
- **Population pipeline fixes found by the cloud runs.** These also apply with the living region off.
  - Peaceful slots in a safe or settled room were still being suggested as "Hostile". The model followed that
    suggestion and the validator then rejected it. Peaceful slots are now suggested as Neutral.
  - Monster-equipment batches shared one attempt budget, so a room that needed more than 32 items failed on the fifth
    batch. Each batch now has its own budget, and the whole operation is bounded (`generationPolicy.batches`).
- Cloud call deadline: the game's own 120 s per call (`modelTransport.callTimeout`).
- Guarded items, negotiation, finding people, defending places and investigating disappearances are deferred until
  the engine can guarantee them.

## Files

`retort/livingRegion.js` (engine loop and hooks), `livingRegionAuthoring.js`, `livingRegionTopology.js`,
`livingRegionFixture.js`, `livingRegionLedger.js`, `livingWorld.js` (participation, knowledge, reputation, initiative), `residentPlans.js` (bounded autonomous actions); hooks in `inhabitantGeneration.js`, `roomBuildTopology.js`,
`secretRoomLoot.js`, `retortWithUserInput.js`, `worldContext.js`; tests in `tests/living-region.test.cjs`, `tests/living-region-footprint.test.cjs` and `tests/living-world.test.cjs`.
