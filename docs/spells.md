# Spells and Magic

These are homebrew combat adaptations, not a full D&D 3.5 implementation.
Engine-owned tables in `assets/spellRules.js` determine every cost and effect.
The LLM may supply names and lore, never effects, costs or completion conditions.

## Sources

- Equipped magical items spend their own remaining Magic. At zero, ordinary items turn to ash and all their equipment bonuses are removed.
- A spell scroll's Magic is exactly the cost of casting it. Any class can equip and cast it once. Turn Undead additionally requires casting level 7, including scroll casts. Reading does not cast or teach a spell.
- Wizards, Witches and Necromancers learn only their own tradition by consuming real carried scrolls into a physical spellbook. Generated scrolls carry flat `spell_class` and `spell_min_level` fields. The canonical spell ID, not the item's editable label, determines compatibility. Scribing preserves the scroll's exact casting cost; the effect grows with the caster's level. A matching advanced formula may be learned early but cannot be prepared until its unlock level.
- Scribing requires a safe short rest: 3 turns at levels 1-4, 2 at 5-9, and 1 at 10+. Nearby hostiles within 3.5 tiles and clear sight prevent it. Time passes immediately in game turns, not a real-time countdown. The book must remain carried or equipped to prepare or cast book spells.
- Sorcerers and Warlocks choose spells from distinct, level-gated weave catalogs without books or scrolls. Both available and future choices show effects, costs, current strength, ranges and unlock requirements. Book and scroll selections explain the same information before committing.
- Class Magic is separate from equipment Magic: Wizard/Witch/Necromancer capacity is 2 per level; Sorcerer/Warlock capacity is 3 per level. Empty class pools do not destroy books or characters.
- Without the Sepulchra, Mortacia retains divine level 50 but starts with only 5 class Magic. Capacity is `5 + 2 * max(0, divineLevel - 50)`; the 5 is a starting bonus, not a per-level rate. Recovered casting level is `max(1, divineLevel - 49)`, used for spell strength, preparation limits, spell unlocks, scribing time and recharge. These rules are identical for Mortacia as PC or companion and also limit item/scroll spell scaling. Merely equipping an item or narrating recovered power does not remove this limitation.
- Mortacia uses the Necromancer tradition. Existing inflated Mortacia pools are corrected on synchronization: expenditure is deducted from the corrected capacity, learned spells are retained, invalid preparation is removed, and recharge restarts at the recovered-level interval. Catalog migrations also preserve spent Magic, learned entries and scribing receipts; legacy cross-tradition entries are retained but cannot be prepared. Reopening a menu never refills a corrected or spent pool.
- Campaign artifacts never turn to ash: an exhausted artifact fully recharges after 5 game turns. Other quest items are not protected.
- One spell consumes one initiative action. Monsters use the same rules on their turns. Fireball can hit allies. Healing cannot resurrect.

## Progression

Damage and healing tables apply to class, item and scroll casts using the caster's level.
For diminished Mortacia, this means recovered casting level, not nominal divine level.
Costs remain fixed, including the cost learned from a scroll. Spell range and blast radius do not increase with level.

| Mortacia Divine Level | Recovered Casting Level | Class Magic Capacity | Prepared Slots |
| --- | --- | --- | --- |
| 50 | 1 | 5 | 2 |
| 51 | 2 | 7 | 2 |
| 52 | 3 | 9 | 3 |
| 55 | 6 | 15 | 4 |
| 58 | 9 | 21 | 5 |

At divine level 50, class Magic regains 1 point every 6 turns, not 11 every 2.
Her existing XP reset and divine level remain unchanged. Level gains beyond 50 are supported and persisted once by the class ledger.

| Spell | Base Cost | Progression |
| --- | --- | --- |
| Magic Missile | 1 | Levels 1/3/5/7/9: 1/2/3/4/5 darts, each 1d4+1. Automatic hit, one enemy, 8-tile range. |
| Fireball | 3 | Levels 1-3: 3d6; levels 4-10: level d6, capped at 10d6. 8-tile range, 2-tile radius, DC 14 save for half. |
| Grave Mending | 1 | Levels 1/5/9/13: 1/2/3/4d6; bonus +1/+2/+3/+4/+5 at levels 1/4/7/10/13. Cap at target MaxHP, 3-tile range. |
| Sepulchral Ward | 1 | Absorbs 4/6/8/10/12/14/16 at levels 1/4/7/10/13/16/19. Lasts 2/3/4 rounds at levels 1/7/13. 3-tile range; no stacking. |
| Oathbreaker Hex | 2 | Attack penalty -2/-3/-4 at levels 1/6/11; duration 2/3/4 rounds at levels 1/7/13. 6-tile range; no stacking. |

A scroll may have a different Magic value than the base cost; that exact value becomes its one-shot and learned cost.
Witches unlock Oathbreaker Hex at casting level 2; Wizards unlock Fireball at casting level 3.
Prepared capacity is 2/3/4/5/6/7 spells at levels 1/3/6/9/12/18. Learned book entries are retained when unprepared. A tradition's catalog remains the limit even if more slots are available.
Every `max(2, 6 - floor(level / 4))` turns, regain `1 + floor(level / 5)` class Magic, capped at capacity. Recharge is turn-based, not wall-clock based.
Equipment charge pools remain finite; a recharge of class Magic does not restore equipment.

## Distinct Traditions

These are mechanically different choices, not five names for the same spell list. Wizards have long-range force and broad blasts but no class healing. Witches have economical ritual healing and strong lasting hexes. Sorcerers spend larger weave pools on ranged restoration and protection. Warlocks have larger dark-weave pools, destructive close-range attacks and bindings, but no healing. Necromancers favor ancestral bone wards, death magic and limited control of weaker undead. Equipment and one-shot scrolls remain usable across classes; that does not teach their formulas.

All five player catalogs have distinct spell IDs. These are the additional spells beyond the five detailed above. The scaling column names the exact table profile in `assets/spellRules.js`; each profile provides explicit level breakpoints, never an LLM-generated formula.

| Tradition | Spell | Unlock | Magic | Base Effect And Range | Scaling Profile |
| --- | --- | --- | --- | --- | --- |
| Wizard | Runic Shell | 1 | 1 | Absorb 5, 2 rounds; range 3 | rune |
| Wizard | Binding Sigil | 2 | 2 | Attack -2, 2 rounds; range 8 | curse |
| Wizard | Force Lance | 6 | 4 | 3d8+2, single enemy; range 10 | lance |
| Wizard | Citadel Barrier | 9 | 5 | Absorb 20, 3 rounds; range 5 | fortress |
| Witch | Thorn Needle | 1 | 1 | 1d6, single enemy; range 5 | needle |
| Witch | Coven Mending | 1 | 1 | Heal 1d4+2; range 4 | coven |
| Witch | Hearth Circle | 3 | 3 | Absorb 10, 2 rounds; range 4 | hearth |
| Witch | Briar Cauldron | 6 | 4 | 4d4 blast, radius 1, save 13; range 6 | briar |
| Witch | Fate Unraveling | 9 | 5 | Attack -4, 4 rounds; range 8 | fate |
| Necromancer | Bone Shard | 1 | 1 | 1d4+1, single enemy; range 7 | bone |
| Necromancer | Soul Burst | 3 | 3 | 3d4 blast, radius 2, save 13; range 6 | fireball |
| Necromancer | Ossuary Armor | 6 | 4 | Absorb 16, 3 rounds; range 2 | ossuary |
| Necromancer | Turn Undead | 7 | 5 | Limited withdrawal; range 6, radius 2 | turning |
| Necromancer | Death Sentence | 9 | 5 | 4d6+4, single enemy; range 7 | sentence |
| Sorcerer | Weave Spark | 1 | 1 | 1d6, single enemy; range 6 | needle |
| Sorcerer | Dawn Mending | 1 | 2 | Heal 1d6+1; range 6 | mend |
| Sorcerer | Aurora Guard | 2 | 2 | Absorb 6, 2 rounds; range 5 | aurora |
| Sorcerer | Sunburst | 3 | 3 | 2d8 blast, radius 1, save 14; range 7 | sunburst |
| Sorcerer | Radiant Lance | 6 | 4 | 3d6+2, single enemy; range 9 | lance |
| Sorcerer | Renewal | 9 | 5 | Heal 3d8+5; range 6 | renewal |
| Warlock | Cinder Bolt | 1 | 1 | 1d8, single enemy; range 5 | cinder |
| Warlock | Pact Veil | 1 | 1 | Absorb 3, 3 rounds; range 1 | pact |
| Warlock | Dread Binding | 2 | 2 | Attack -2, 2 rounds; range 7 | curse |
| Warlock | Abyssal Pyre | 3 | 3 | 3d6 blast, radius 1, save 13; range 6 | fireball |
| Warlock | Black Oath | 6 | 4 | Attack -3, 3 rounds; range 8 | oath |
| Warlock | Ruin Brand | 9 | 6 | 5d8, single enemy; range 6 | ruin |

## Turn Undead

The engine limits ordinary encounter groups to four inhabitants. Turning can never remove an entire such group, and deals no damage or automatic kills:

| Casting Level | Maximum Targets | Actions Lost Per Failed Save | Save DC |
| --- | --- | --- | --- |
| 7-10 | 1 | 1 | 13 |
| 11-14 | 2 | 2 | 14 |
| 15+ | 3 | 2 | 15 |

Only actual undead races qualify, not every human or elf living in the underworld. Targets must be at least two levels below the caster's effective casting level. Bosses, canonical deities, neutral bystanders and same-team allies are excluded. Nearby secondary targets require clear sight from the primary target, and the engine selects only as many as the table permits. Each rolls a real d20 save with the existing level-based save modifier; resistance still spends Magic.

A failed target moves up to two valid maze tiles away from the caster instead of acting. Walls, occupied spaces, closed doors and elevation restrictions are respected; a trapped target cowers instead. While turned it cannot attack, cast or make a retreat opportunity attack. Taking damage ends the effect. A four-round cooldown belongs to the caster, not the source item, so switching scrolls cannot evade it. The same logic runs in all three combat modes. Diminished Mortacia unlocks the spell at divine level 56, recovered casting level 7.

## Native Custom Classes

The LLM first chooses `combatRole` per individual: Warrior or Spellcaster. Warriors use Fighter rules and empty spell preferences. Only spellcasters choose an archetype and preferred canonical spells; the engine validates both against level and tradition. Custom titles remain visible as, for example, `Vow Reader [rules: Cleric]`. Stored population metadata and the spell ledger protect the chosen profile across recruitment, room changes and stale browser snapshots. Legacy unknown titles have conservative inference, with Fighter as the safe fallback; equipment Magic alone never makes a caster.

| Native Rules | HP Die | Class Magic Per Level | Learning |
| --- | --- | --- | --- |
| Fighter | d10 | 0 | No innate spells |
| Wizard / Witch / Necromancer | d6 | 2 | Own spellbook, recorded consumed birth-scrolls |
| Sorcerer / Warlock | d4 | 3 | Own weave choices |
| Cleric | d8 | 2 | Priestly petitions; no spellbook |

Warriors start with `floor(level / 2)` Attack and `floor(level / 3)` Damage. Casters start with `floor(level / 4)` Attack and zero extra Damage. Actual equipment bonuses are added afterward. Native HP is rolled using the rule profile, and birth XP uses that profile's advancement threshold. Recruitment preserves the existing charge pool, preparation, learned costs and book; it does not refill Magic or award a second birth grant. Native warrior advancement never creates innate Magic. Scribing requirements and source consumption still apply to recruited book casters.

Cleric is a supported native archetype, not a newly selectable player-start class. Its distinct petitions are:

| Spell | Unlock | Magic | Base Effect And Range | Scaling Profile |
| --- | --- | --- | --- | --- |
| Prayer Mending | 1 | 1 | Heal 1d6+2; range 2 | coven |
| Sanctuary Ward | 1 | 1 | Absorb 5, 2 rounds; range 2 | rune |
| Judgment | 2 | 2 | 1d6+1, single enemy; range 5 | bone |
| Purifying Flare | 3 | 3 | 2d6, single enemy; range 5 | sunburst |
| Restoring Prayer | 6 | 4 | Heal 3d6+5; range 2 | renewal |
| Hallowed Rebuke | 7 | 5 | Same limited turning mechanics; range 6, radius 2 | turning |

## Verification

The database keeps charge pools, stable item IDs, prepared spells, learned costs, scribing receipts, transaction receipts and temporary effects.
Views never advance the spell clock. Casting validates current room, run, actor, source ownership, preparation, charges, range, line of sight and initiative targets.
Burning a required item fails its task. A replacement objective inserts actual replacement equipment and increasingly tough named guards without bypassing the boss gate or changing the active quest's task index.
