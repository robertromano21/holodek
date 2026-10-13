# Encounters and Verified Quest Actions

## Quest Authority

Quest completion is decided by the engine, not a generated status or dialogue.
All current requirements must pass, and the intended action must have matching
evidence: inventory ownership for retrieval, room-bound target HP for defeat,
canonical exit state for unlocking, a solved physical mechanism for puzzles, or
an engine item-transfer receipt for delivery. Empty, location-only, unsupported,
or unbound objectives cannot complete. Model prose may explain these facts but
cannot bypass them. New generation advertises only objectives supported by an
engine compiler: retrieval, hostile defeat, delivery, existing physical puzzles,
and real keyed-exit actions. Negotiate/protect/investigate and unspecified hybrid
objectives are not generated until they have their own mechanical bindings.

The compiler reads exact item names from objects already in the room database,
requires real named source/destination rooms, and replaces generated prose and
metrics with instructions built from those bindings. Missing or duplicate items,
dead or unavailable actors, non-hostile combat targets, solved/missing mechanisms,
and invented exits cannot publish an objective. Proposed model requirements are
not executable gates. Only compiled hard/action checks become authoritative.
When no supported objective exists, the quest waits rather than publishing an
unfinishable task. These restrictions concern new tasks, not migration of old
campaign tasks.
Mixed selections first fall back to a supported subset. A selected non-hostile
contact can be paired with a real already-placed item for a delivery; otherwise
an existing eligible item or unsolved mechanism supplies the objective. Fallbacks
do not invent loot, move actors or use the reserved boss room/seal.

The Game Console supplements the narrative with `Quest Requirements`, rendered
from the active task's actual hard/action gates. It lists full item names and
their bound source rooms, exact handoff recipients and destinations, and any
required exit, combat or physical-puzzle actions. Puzzle solutions are not
revealed. Missing action bindings are disclosed instead of inventing conditions.
The display is read-only, does not change receipt identities, survives local
inventory and streamed combat updates, and is replaced when the step changes.
The normal quest-manager path now writes this field as well as direct handoffs
and combat commits, including clearing stale requirements while waiting for a
new step.

Giving an item verifies ownership, a living non-party recipient in the current
room, clear line of sight and handoff distance. It transfers one inventory item
with its metadata, without equipping it automatically or changing anyone's HP.
Equipped items must first be unequipped. Dropping an item or mentioning a
delivery is not a handoff. A receipt is bound to the exact task, item, recipient
and room, so another task cannot reuse it.

Future delivery steps are compiled from the structured item and recipient
bindings, rather than inferred solely from prose. Every required item gets its
own handoff check. The engine saves partial delivery progress after each gift;
the step advances only after every bound receipt is present. Receipts are scoped
to a unique generated task identity, not reused by a later quest asking for the
same items. Already-delivered items do not also have to remain in the player's
inventory. Source rooms are
pickup locations, not contradictory requirements to return there after giving.
Generated descriptions name the exact items, source rooms, destination and
recipient. Missing items, ambiguous or unavailable recipients, and unsupported
hybrid handoffs are rejected before a new task is published.

Explicit retrieval-and-presentation steps are normalized as deliveries, not
silently given an unrelated physical-puzzle requirement. Actual puzzle/hybrid
steps retain their mechanical requirements. Verified completion advances the
task index and updates quest progress; it does not invent XP or other rewards.

## Delivery Successors

If an outstanding delivery recipient dies, the engine creates a separate neutral
assistant in that same bound room. The assistant has a real character sheet,
population record and empty personal inventory. When room geometry is available,
placement uses reachable unoccupied cells, not walls, exits or item sites. The
original character remains dead, retains their items, and is not renamed or
revived. Stale database sheets cannot reset other residents' injuries.

The successor is authorized by a persisted `deliverySuccessors` record tied to
the immutable task, original recipient and destination. Actual assistant handoffs
record both the original obligation and the accepting assistant. Earlier valid
receipts still count, so a partially delivered quest does not restart or consume
items twice. Another task, room, recipient or unsupported delegation cannot use
these receipts. If a successor later dies, another can take over the same pending
obligation. Completed tasks do not summon assistants.

Game Console requirements and verified NPC directions name the current assistant
and explain whom they replace. Recovery runs at combat quest commits, ordinary
quest turns and handoff attempts. Absence, hidden discovery state, recruitment
or a missing room record alone is not evidence of death and does not create an
assistant. Recruitment remains subject to the separate limitations below.

## Boss-Key Sequence

The existing flow is unchanged: complete the preceding objective, retrieve the
uniquely bound key through the pre-boss quest stage, unlock its boss-room gate,
then confront the existing boss. Ordinary objective generation cannot select or
manufacture reserved boss seals. The key still cannot be seeded outside its
quest-loop stage, and a different key, model completion status or pickup in the
wrong quest cannot bypass the binding. Existing boss/key/room identities are not
rerolled by the objective compiler or delivery-successor logic.

## Gift Ownership and Recruitment Plan

Implemented handoffs store full item metadata in the recipient's persistent
`inhabitants.actors[name].inventory`, separate from the party inventory. Transfer
receipts are history, not a second copy of the item. Ordinary gifts do not equip
the recipient or change its stats.

Planned recruitment must transfer that character's loose items into the shared
party inventory exactly once, clearing the transferred entries from its personal
inventory. Already-equipped items stay in their existing equipment slots with
their modifiers and character stats unchanged; they must not also be added to
the shared inventory. The legacy client recruitment path strips equipment and
re-equips it, so it must be replaced rather than extended with another loot copy.
The transfer should be an engine-verified, persisted recruitment transaction,
bound to the recipient's identity and current room. Reloads or repeated recruit
requests must not duplicate items. Quest handoff receipts remain valid history
and must not grant quest credit or rewards again. This recruitment inventory
handoff is not implemented yet; these are the rules for that separate change.

## Combat and Pursuit

Initiative rolls automatically and visibly each round. Combat retains one
action lock until victory, PC defeat or party retreat. Each turn selection has
a unique ID; stale selections cannot apply to another round or actor. The PC's
centered turn popup offers attacks and whole-party retreat. NPC target choices
retain the existing attack/hold controls.

Each resolved hit commits PC, companion and resident HP to the live sheets and
roster before another turn awaits input, including zero and negative HP. Resident
injuries also update the saved room population/database. A scoped, revisioned
`combat_health` event refreshes the Game Console, party dock and sheet caches
without releasing the action lock, respawning characters or rebuilding room
geometry. Reconnecting during combat receives the current health snapshot;
duplicate, older, wrong-room and previous-action updates are ignored. Browser
state replacement is rejected while an automatic combat action is active.
This restores the console feedback that previously accompanied each returned
round, without reverting continuous rounds to the old gaps between encounters.

The WebGL world pass establishes its own framebuffer, depth test/function,
write masks and blend state before clearing. It no longer depends on whether a
preceding actor-shadow or diagnostic pass changed depth testing. No lighting,
material, shader or carving values are changed by this guard. An isolated GPU
regression draws a visible actor, removes it after death, moves the retreat
camera and returns to the original view with deliberately disturbed GL state;
the final background must match exactly and every frame must be error-free.
The live-session error code 1282 was observed but its exact originating graphics
call was not captured; confirmation of that session's muddy appearance requires
retesting with the updated browser code.

Every living hostile within actual weapon reach of a living party member gets
one free attack during retreat, with a randomly selected reachable target.
Walls, doors and reach remain authoritative; no enemy moves into range for this
free attack. Targets are rechecked after each strike. A successful escape uses
walkable paths for the PC and surviving companions; a blocked route or PC death
does not teleport the party to safety. Retreat has a short re-engagement grace
period, not permanent immunity.

Ordinary monsters stay owned by their room. A deterministic minority of
hostiles can pursue after spotting the player. Pursuit requires recent sight,
a nearby real open exit and a traversable route; it is limited to two pursuers
per transition and two room crossings. Quest-bound actors are protected.
Transfers preserve identity, injuries and equipment and update both room
populations. Intentional NPC deception and authored ambush quests are not yet
implemented.

## Session Safety

These changes do not repair or rewrite an already-running campaign. Regression
and browser probes use isolated fixtures, not the live session. New backend
behavior takes effect only when the updated server code is loaded.

Verification: 315 focused quest/combat regressions and 53 rendering-preservation
tests passed, as did the software GPU probe (including the new actor/retreat
transition). The full suite has 1,384 passing tests and the same 14 existing
transport/subtitle failures observed before the combat fix. The hardware GPU
browser timed out, so hardware validation is not claimed.
