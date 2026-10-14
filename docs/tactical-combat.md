# Tactical Combat and Party Spellbook

This pass expands the existing Phaser combat map, not a separate battlefield or
replacement renderer. Combat opens it as a centered rectangle with a 340 ms
outward zoom. Reduced-motion preferences skip the zoom. Ending combat restores
the previous corner window, visibility and manual scroll position. During combat
the map's initial rotation stays fixed even as the 3D camera faces an attack.

## Positioning

- The PC can click highlighted, unoccupied tiles during their initiative turn.
- Six cardinal tile steps are available per turn, shared across all clicks.
  The server verifies room/run/turn IDs, movement revision, occupancy, doors,
  obstacles and elevation. The client never supplies a path or grants movement.
- Moving does not finish the turn. Attack, cast one spell, or choose End Turn.
  Only enemies in weapon range with clear sight can be attacked. The PC no
  longer automatically crosses the battlefield after selecting an enemy.
- NPC and monster automatic pursuit is capped at six steps per turn. Ordinary
  exploration speed and collision/camera rules are unchanged.
- A hostile melee combatant can take one free attack when the PC leaves its
  striking distance, at most once per PC turn. Ranged weapons do not threaten
  retreat attacks. Whole-party retreat retains its existing one-free-strike-per-
  reachable-hostile rule. Regular allied AI movement is not yet player-directed.

SSI's original [Pool of Radiance manual, Combat section](https://www.bestoldgames.net/download/games/pool-of-radiance/pool-of-radiance-mac-manual.pdf)
informed the separation of movement, targeting, casting and ending a turn, plus
disengagement consequences. This is an adaptation, not an AD&D/THAC0 conversion.

## Supported Shop Equipment

New equipment shops sell mundane melee weapons, sling, shortbow, longbow, light
crossbow, light armor and wooden shields, alongside existing supplies. Weapon
damage uses the equipped weapon's dice plus the character's existing Damage
modifier once. Gear without a recognized weapon profile keeps the legacy class
damage die. Negative modifiers cannot turn damage into healing.

Ranged reach is one range increment: sling 10, shortbow 12, longbow 20 and light
crossbow 16 tiles, using five feet per tile. Walls and closed doors block shots.
An adjacent enemy imposes -4 Attack when shooting. Ammo, reloading, proficiency,
criticals, handedness and extended range increments are deliberately abstracted;
there is one attack per turn. These adaptations are disclosed on each item.
Damage and basic range values come from the [3.5 SRD weapon table](https://www.d20srd.org/srd/equipment/weapons.htm).

Armor uses the existing Armor/Shield slots and adds to AC, not damage reduction.
Padded, leather, studded leather and chain shirt grant +1, +2, +3 and +4;
light/heavy wooden shields grant +1/+2. One item per slot prevents same-slot
stacking. Existing sheet AC already includes equipped armor, so combat does not
add it again. These bonuses follow the [3.5 SRD armor table](https://www.d20srd.org/srd/equipment/armor.htm).
Silver prices are local campaign prices, not SRD gold-to-silver conversions.
Existing shop stock is not rewritten, and purchased mundane items retain their
metadata across browser inventory synchronization.

## Spellbook

The Spellbook icon sits to the left of the backpack, above the command prompt's
upper-right corner; the Journal and Map continue down the right-hand side.
Both references are also available in the game menu. Every party member has a portrait/name
tab, including warriors, Mortacia and recruited creatures. It can be read while
paused or in combat without visiting a room, changing state, or advancing turns.

Spells are grouped by this engine's unlock levels. Each row shows `Name (N)`,
memorization cost and casting cost. N is the affordable number of casts from
that prepared spell's class pool or that equipped item's own pool, not an
independent supply per spell. Casting reduces other counts sharing that pool.
Dead casters, absent books, locked/unprepared spells and turning cooldowns show
zero. A target and a legal initiative action are still required for combat casts.

Class Magic, preparation slots and equipped item charges are distinct. Preparing
or forgetting a class spell costs zero Magic and one turn. Clicking a learned,
unlocked spell fills a free slot; clicking a filled slot empties it. Capacity,
learning, book possession and level are verified by the existing preparation
endpoint. Preparation cannot change during combat or pause. Wizards, Witches
and Necromancers start with basic formulas in their spellbooks; additional
formulas require real scribed scrolls. Sorcerers and Warlocks store
their chosen, unlocked weave spells without scrolls, then cast them directly.
Item spells use no class preparation slots and spend only their own charges.
Normal exhausted items ash; artifacts retain their existing recharge behavior.

No campaign data is migrated by deployment. Restart the server and refresh the
browser to load the new endpoints and client modules. No live game or renderer
lighting settings are changed by this pass.

## Injuries and Divine Rescue

Hostile spells roll visible automatic saving throws. Reaching zero HP rolls an
automatic survival save (DC 12): success is unconscious, failure is dying.
A dying character has two subsequent rounds to receive adjacent bandaging or
healing. Each aid action uses one turn. Bandaging stabilizes at zero; healing
wakes a living ally. Stable unconscious characters recover one HP after two
turns. Only actual death releases a monster's recorded belongings.

Mortacia resurrects an ordinary PC after actual death twice. When Mortacia is
the PC, Dyanetzia revives her upon reaching zero HP twice. Each divine rescue
restores half maximum HP, not Magic; the third defeat ends that adventure.
The rescue count is server-owned and survives late browser snapshots.
