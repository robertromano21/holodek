# Combat Interaction

The player may deliberately attack friendly or neutral residents and companions.
The targeted character becomes hostile, not their entire friendly encounter
group. Hostility is committed to the console, canonical roster and persistent
population before initiative, and broadcast immediately. Remote, undiscovered,
ambiguous and occluded names cannot be used to provoke a character elsewhere.

Companion attacks require an "Attack Party Member?" browser confirmation before
the command starts, including typed commands and character-sheet actions.
Canceling performs no movement or allegiance changes. A confirmed target leaves
the party and becomes a hostile resident at their current location, retaining
their stats, equipment, artwork, voice, biography and memory. Everyone else
remains with the player. The engine does not invent spies, faction splits or
autonomous party infighting.

During a player turn, clicking legal empty ground supports manual movement before
target selection; unavailable squares explain the movement restriction, with no
green floor shading. Hovering an enemy shows its name, a hand cursor and its
entire physical footprint. During combat, clicking a character opens only its
action popup beneath the Game Console, not its character sheet or an immediate
attack. Its Attack or "Move + Attack" button requests the action. Normal
exploration inspection still opens the character sheet.

Console character names and lower-left party portraits
open that same combat popup, including care actions for an obscured
dying ally and valid ranged spells when a weapon cannot reach. It uses the
original black/white `.popup-container` styling and standard buttons directly
below the Game Console. The console targeting
route remains available while the ordinary command pipeline is locked by the
fight, but does not permit ordinary commands, invalid targets or out-of-turn
actions. Paused and stale actions remain disabled or rejected.

The lower-left Attack dropdown instead submits Attack or Move + Attack directly,
without a redundant confirmation popup. If only a ranged spell can reach the
selected target, its Choose Spell button still opens the actual spell choices.

Arrow keys move the active tactical character relative to the map view, using
the same server-validated destinations, movement budget and opportunity attacks
as mouse movement. Bumping an occupied character opens its popup, never an
automatic attack. Typing, menus, dialogs, pause and an in-flight movement cannot
cause another step. The map has no permanent legend; its square/name/cost hover
readout is retained.
Published approach choices include
their movement cost; the server recomputes the route and validates turn, room,
pause, occupancy and movement revision before moving. Only a valid attack
position within the remaining six-tile budget is offered. Melee stops at weapon
reach; ranged weapons do not charge targets already in range. Ordinary attack
rolls, opportunity attacks, terrain restrictions and initiative still apply.

A named initial attack command also selects this approach on the PC's first
turn if movement is needed and a complete in-budget route exists. Subsequent
turns remain interactive. If no route fits, no teleport or forced partial move
occurs: the player can move manually, cast, hold or retreat.

The expanded map uses the free center of the screen, reserving the complete
party dock on its left and the Game Console/Log on its right. Lower shortcuts
only reduce its width when they actually overlap its vertical space.

During combat, map cells are 25% larger while character art sizes and the chosen
camera zoom are unchanged. Actors are centered over their complete occupied
footprints; fractional companion/monster movement still interpolates normally.
The PC display aligns to its current cell without changing its 3D position.
Normal exploration spacing and zoom return when combat ends.

The read-only Combat Ledger sits to the map's right. It shows the sorted
initiative order and recent resolved hits, damage, remaining HP and misses,
without dice arithmetic or a repeated turn/movement-instructions footer. Its
bounded 60-entry structured feed is published in
the combat dice state for reconnects and uses actual post-ward, post-survival
results, never guessed HP from raw damage rolls. The original Game Log retains
the full combat history. Older running servers can supply outcome lines from
their existing round log until restarted.

Dice arithmetic and recent enemy rolls remain in the lower-left party controls,
alongside one compact row of Attack, Hold Position and Retreat Party. The active
character and Attack control are highlighted, with a "Your turn" target prompt
instead of "Resolving actions" while awaiting a choice. Retreat retains
opportunity attacks.
Unconscious, dying and dead characters receive no initiative or action turns.
Their dock shows their condition instead of normal dice, while legitimate
Survival Saves remain visible. A mid-round knockout removes the character from
the current initiative display without erasing earlier results in the Game Log.
Normal recovery must restore consciousness and positive HP before future rolls.
Character popups expose published attacks, spells and care choices only
for the current turn and target, with paused/stale/out-of-range actions blocked.

Focused tests: `combat-provocation.test.cjs`, `combat-tactics.test.cjs`,
`combat-turn-flow.test.cjs` and `tactical-layout.test.cjs`. The UI probe checks
both control docks, clickable move-and-attack buttons, layout restoration and
spellbook access across desktop/narrow viewports and UI scales.
