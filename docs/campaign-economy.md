# Campaign Geography And Economy

## Planning A New Journey

One bounded model request at startup proposes four regions and four factions. The
engine validates and stores the atlas under `0,0,0.campaignAtlas`, scoped to the
game run. An invalid response falls back to the built-in setting. This is broad
world planning, not a second quest generator or a map of every future room.

Nearby four-by-four geographic districts share community names, resources,
governance and factions. Regional flavor changes across geographic bands and
verified main-quest progress. Previously published room names, descriptions,
routes, boss gates and required items remain authoritative on return visits.

New frontier sites can include fertile oases, graveyards, commons, markets, inns,
houses, guild halls, temples, forts and citadels. Buildings retain indoor planning;
known neighboring buildings use the existing exterior/entrance renderer. Fertile
oases use the existing living-tree and green-reed voxel forms, not dead-grove
recolors. Descriptions and inhabitant generation receive the same saved regional
facts. Regional flavor does not unlock Hades or waive campaign victory checks.

`CAMPAIGN_SETTING=off` disables new regional decoration. Stored rooms are not
rewritten. No campaign or paid model requests are needed to run the tests.

## Silver And Supplies

`Silver Pieces:` is a standalone console field. The inventory menu displays the
balance separately; silver is never inserted into Inventory or Inventory
Properties. `0,0,0.economy` is the authoritative, run-scoped ledger.

Each initial party member except Mortacia contributes one silver. Solo Mortacia
starts with zero; solo Suzerain starts with one. A generated resident has a saved
birth purse: an uncrossed fare, lost/spent fare, actual raider plunder, toll receipts,
or no coins. Beasts normally have none. Death exposes recorded possessions once,
as ground loot; it does not award a flat payment. Joining the party pools actual
loose possessions, not a fresh starting allowance.

Healing potions are ordinary Other-category inventory items with **Magic 3-10**.
Magic is their healing amount, not an equipment bonus. Names include strength.
Drink restores `min(Magic, missing HP)` and removes exactly one potion. Empty,
full-health, dead, stale, paused and invalid-target actions do not consume one.
The option is Drink; Equip is hidden/blocked for healing potions. Identical-strength
copies stack in the existing inventory UI. Room finds and carried loot vary in
strength; shops and temples stock several strengths. Prices are centralized in
`assets/economyRules.js`.

Neutral shops have finite stock and tills; purchases/sales transfer actual items
and silver. Keys, artifacts and reserved quest/contract items cannot be sold.
Temples sell potions, heal living party members and resurrect actual dead party
members at 1 HP. Healing costs one silver per ten missing HP, rounded up;
resurrection costs at least five silver and scales with level.

Transactions validate current run, room, proximity, line of sight, ownership,
balance, ledger revision and an idempotency nonce. Browser room synchronization
cannot overwrite the ledger, service stock or recorded currency loot. Actions
reuse the existing console/roster result path without changing terrain or lights.

Room loot is registered in `room.objects` before the room-generation snapshot is
saved, including ordinary equipment as well as puzzle readables. The server owns
catalogs marked `groundInventoryVersion: 1`; browser synchronization cannot remove,
change or respawn their objects. Committed pickups also survive stale inventory
consoles, while actual equipping can still move a copy into a character's slot.

Older puzzle-only catalogs are repaired once from the current saved console's
named object metadata. Already carried items and recorded pickups are excluded.
Existing valid scene placements stay fixed; missing placements use the existing
reachable-floor placement rules. Passive state-sync results include the resulting
scene-object list so browser visibility and server pickup checks use the same
objects. Camera visibility, the 2.5-tile pickup radius and clear-path validation
remain mandatory; repair does not grant loot or waive these checks.

## Local Contracts

Occasional inhabited communities offer a separate paid delivery contract. The
engine first inserts a real named guild packet into a known populated location
in that community, then publishes its exact source room and recipient. Accept
Local Contract and use Give Item for the handoff. A real engine handoff receipt
releases its community escrow (two silver or a named healing potion) exactly once. Prose, dropping the packet
or merely carrying it cannot claim payment. Local contracts never advance the
main quest or issue a boss key. If a service keeper or recipient dies/leaves,
an actual assistant takes over the existing stock or contract, not a new reward.

This first local-contract implementation is delivery-based; escorts, faction
reputation, schedules and evolving political control are not implemented here.

## Research

- [D&D: Building Your Own Campaign Setting](https://www.dndbeyond.com/posts/772-new-players-guide-building-your-own-campaign?page=2): start with a settlement and its surrounding physical region.
- [D&D: Running Hub Cities And Strongholds](https://www.dndbeyond.com/posts/1564-running-hub-cities-and-strongholds-in-d-d): recurring home bases link preparation, residents and adventure hooks.
- [Paizo: Towns Of The Inner Sea](https://store.paizo.com/pathfinder-campaign-setting-towns-of-the-inner-sea-pfrpg-pdf/): settlements combine local history, culture, residents and threats.
- [Paizo: Verdant Wheel](https://paizo.com/pathfindersociety/factions/verdant-wheel): a faction can supply shared goals grounded in ecology and stewardship.

The regional graph, underworld factions, economy and contract rules above are our
design choices, not mechanics copied from those settings.
