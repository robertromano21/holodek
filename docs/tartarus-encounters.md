# Journeys through Tartarus

Design catalog, not a claim that these encounters are already playable.
Extend the existing room builder, inventory and Grave Master adjudication;
do not add an independent terrain or combat system.

## From description to encounter

1. Extract literal places, materials, hazards, inhabitants and objects from the
   room description. Preserve the source phrase. A "chasm of despair" is not
   enough evidence for a physical ravine.
2. Match one primary encounter and at most two small discoveries to those facts.
   Require both semantic evidence and room capacity. Keep quiet rooms too.
3. Compile the required geometry, fixtures, clue locations, approaches and safe
   routes before finalizing cells. Check connectivity and a bounded solution
   graph. If a required feature cannot be built, reject the encounter, not the
   room. Never narrate an unavailable interaction as though it exists.
4. Write final descriptions from the accepted manifest. Exploration notices
   reveal local facts when visible/in reach, not unexplained room-wide messages.
5. Store partial progress, damage, deployed gear, exhausted rewards and clues
   in browser room state. Mirror active state to the server for adjudication.

Every contract needs stable IDs, evidence, footprint/height constraints,
reachable approach tiles, visible clues, legal actions, item requirements,
explicit dice checks, state changes, escape routes and one-time reward IDs.
All actions carry run, room, actor, action and expected revision identifiers.
Graphical actions and text commands use the same validated transition.

## Encounter catalog

| Description evidence | Visible encounter | Meaningful choices and consequences |
| --- | --- | --- |
| Ravine, rotten timber, hanging bridge | Uneven voxel planks and rope posts; a few planks sag or are missing. Wind and creaks precede danger. | Inspect for weak sections, lash on spare timber, secure a safety rope, or risk crossing. A failed risky crossing can break a section; a tether catches the actor on a reachable ledge. Repair persists. No surprise collapse of the only mandatory route. |
| Cliff, fissures, upper ledge | A stepped rock face, visible anchor stone, and a ledge containing a shrine or shortcut. | Deploy the self-tying rope, use pitons, find a longer stair route, or attempt a difficult climb. Secure deployment is not a random failure; a roll is needed only for a hazardous traverse or contested action. Rope remains visible and usable by the party. |
| Furnace, foundry, slag, bellows | Voxel furnace with a firebox, lever, ore trough and cooling basin. Heat appears locally. | Vent pressure, quench a seized gear, feed a fuel item, or divert heat to melt a grate. Wrong sequencing produces a warning vent and blocks a short path temporarily, not arbitrary whole-party damage. |
| Catacombs, names, restless dead | Inscribed graves, an empty burial niche, and a displaced funerary token. | Return the token to its named grave using inscriptions, ask a spirit for context, or steal the offering and provoke its guardian. The correct deduction works without a luck gate. |
| Temple, eclipsed sun, bronze mirrors | Three thick voxel mirror stands and carved receiving stones on a raised sanctuary. | Rotate mirrors into a hinted sequence to open a chapel. Physical stands and indicators show state; beam effects are cosmetic and derived from the solved circuit. Do not promise arbitrary optical ray simulation. |
| Cistern, flooded stairs, old sluice | Stepped pools, sluice wheel and gauge marks on nearby stone. | Redirect water to reveal a stair or float a cache into reach. Maintain a dry escape route. All affected heights and passability change atomically in both maps. |
| Dead orchard, roots, whispering branches | Branching trees and a root-bound gate; bark bears a repeated rhythm. | Follow the rhythm to calm the grove, give a water offering, or cut a path and awaken defenders. Roots recede only where the authoritative cells change. |
| Ash dunes, buried road, ruined waystones | Wind-scoured markers protrude from sand; different routes have readable landmarks. | Use an ash compass to locate the next marker, expose inscriptions, or take a longer sheltered path. Visibility and directions remain consistent with actual landmarks, not random teleports. |
| Canyon, echoing bells, watchmen | A bell frame above a narrow pass, a loose clapper and a nearby patrol. | Dampen the bell, distract the patrol with a thrown object, or repair it to summon a ferryman. Sound creates an investigate goal; it does not make every monster attack remotely. |
| Chains, suspended gate, counterweights | Voxel chain posts, a grounded winch and two weight pans. | Shift stone weights, jam the winch with a spike, or coordinate a companion to hold a control. Releasing the control has a clear warning; followers do not get trapped behind a closing gate. |
| Frozen shrine, mournful flame | Ice-bound offering bowl and sheltered blue brazier. | Carry a coal in a heatproof vessel, shelter it from wind, or thaw a nearer vent. Correct equipment removes the risk; exposed transport can require a roll with a visible extinguishing consequence. |
| Ossuary, broken statues, missing hands | A statue with sockets and nearby fragments whose carvings explain placement. | Assemble a gesture, ask a learned companion to translate, or pry open an optional cache. Failed prying leaves visible damage but cannot destroy the mandatory clue. |

Vary materials, layouts, clue wording, occupant motives, reward placement and
optional approaches. Do not merely reskin the same switch sequence in every room.

## Journey gear

| Item | Use | Limits and visible state |
| --- | --- | --- |
| Widow's Knot, a self-tying rope | Seek a validated nearby anchor; lash a bridge, establish a climb, or tether a risky crossing. | Defined length and load; cannot attach to sky or pass through walls. One deployed instance is removed from carried gear and linked to two visible endpoints. Retrieval requires reach and no attached climber. No item duplication on revisit. |
| Grave-iron pitons | Create an anchor at a marked sound-rock socket or jam a winch. | Each installed piton is a real inventory transfer. Brittle stone is visibly unsuitable. Recoverable when unloaded. |
| Ember urn | Carry a furnace coal, light a sheltered brazier or warm a frozen mechanism. | One contained ember; fuel, charge and extinguished state persist. Not unlimited fire damage. |
| Ferryman's sounding chain | Probe water depth or a suspect floor from a safe edge. | Reveals a local measured fact. Does not discover the whole map or create a path. |
| Ash compass | Point toward an attuned, placed waystone. | Uses the actual target coordinates; interference is explained and visualized. No invented destination behind unbuilt terrain. |
| Mourner's chalk | Mark explored turns, copy symbols, or trace a temporary ward. | Limited charges; marks are stored at real surfaces. A ward requires a supported encounter rule, not an automatic win over any monster. |
| Warding bell | Signal companions or divert a listening guard. | Noise propagates over a bounded room graph. Reactions depend on allegiance, perception and current goals; there is no room-wide automatic combat. |

These are additions to the existing item catalog, not a second inventory.
Item definitions provide capabilities; instances own charges/deployment state.
The Grave Master may recognize an imaginative use, but must map it onto supported
capabilities and state transitions or explain what is missing.

## Dice and companions

- Roll only for meaningful uncertainty. Inspection, reading a visible clue,
  walking a sound route and solving a correct sequence normally need no check.
- Before the player's click, announce intention, relevant gear, difficulty and
  the foreseeable risk. Equipment can make an action safe instead of merely
  adding another bonus. Never spend an item because the player asked about it.
- Preserve existing combat formulas. Environmental checks have explicit rules;
  do not invent ability modifiers missing from the current character sheet.
- A failed check changes the situation: noise, lost time, a weakened plank or
  a reachable recovery position. No repeated identical checks until a plan,
  tool or physical state changes; never reroll because narration was retried.
- Companions can warn, offer to hold a rope or volunteer expertise. Require the
  companion to be present and able to reach the control. Showing their roll
  beside their portrait makes participation legible.

## Engine constraints and build order

The heightfield supports one floor/ceiling pair per XY tile. A bridge crossing
a lowered ravine can use a raised walkable strip and voxel rails/planks, but
cannot also have an independent traversable passage underneath that strip.
Vertical climbing should be a validated transition between two safe ledges,
not free flight or a cosmetic rope that bypasses collision. Moving platforms,
arbitrary rope physics and stacked walkable stories are separate engine work.

Build order: item-instance/reducer migration, furnace control encounter, named
grave puzzle, rope-and-ledge traversal, then repairable ravine bridge. Reuse
the tested door-action/dice plumbing, but add run-scoped revisions, durable
inventory transfers and reconnect recovery before shipping terrain-changing
encounters. Keep unsupported templates design-only until their compilers exist.

Acceptance tests: fresh build and cached revisit, partial progress reload,
identical text/click outcomes, duplicate/replayed requests, stale room responses,
gear retrieval during use, failed checks with retreat, companion path/reach,
2D/GPU cell agreement, and no whole-map allocation on each movement frame.
