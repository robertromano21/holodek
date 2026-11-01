# Combat, Items And Windows

## Ownership

- Explicit `attack <resident>` enters engine combat before narrative adjudication, regardless of disposition. Nearby witnesses from that resident's saved encounter or explicit friend/alliance links defend them. Unrelated bystanders do not automatically join.
- Defeated room monsters drop carried items, recorded coins and equipped gear at 0 HP, including Dying and Unconscious states. Stabilizing or healing them does not restore belongings or equipment modifiers. Later death does not duplicate loot.
- Player death with an available return leaves the shared backpack and the player's equipped gear at the death position. Companion equipment and private resident inventories are not stripped. Party currency is unchanged. Unconscious recovery alone does not incur this loss.
- Ownership receipts and defeat/death-drop receipts prevent stale browser state from recreating equipment or items. Existing saves remain readable; pending returns also apply the equipment rule idempotently.
- Use `ask Tavik Edran to return gantry boltcaster` near Tavik. An uncredited gift from the current player can be returned without a model call. Other requests use one bounded consent decision followed by engine revalidation. Completed deliveries cannot be reclaimed as accidental gifts. Only an actual owned item moves; dialogue never creates one.
- Characters receive current private inventory and handoff facts for their own dialogue. Local-model work uses a smaller inventory context than cloud-model work.

## Feedback

Verified local-contract payouts publish a completion notice after committing the actual currency/items released from escrow. Quest delivery, defeat, puzzle and story-resolution paths publish step/final-quest completion notices. These notices do not invent quest rewards. Puzzle completion retains its existing notice. Notices respect pause, room/run identity and duplicate handling.

## Windows

`WindowUi` only adds manual edge/corner resize handles to the console, log and combat map, plus full-width title tabs for floating menus that lack a header. Native dialog cancellation handlers retain control over closing. The fullscreen world canvas and default panel positions/sizes are untouched. There is no automatic fitting, repositioning, global dragging or remembered layout.

The combat map stays above the world but below inventory, sheets, item dialogs, console and log windows. Map, console and log have eight resize grips. Their existing dragging behavior, expanded combat layout and map zoom remain available. Only an active resize gesture writes panel bounds; no style observer reapplies them. UI operations do not advance combat or bypass roll/turn guards.

Equipment changes use a dedicated, turn-bound engine transaction. The acting party member can equip or unequip before choosing an attack, without spending their action or movement. Other actors, stale turns, pending dice and movement in progress are rejected. Typed equipment commands and inventory drag/equip controls use this same path. Weapon reach, modifiers and spell choices refresh immediately, and subsequent combat health commits preserve the new equipment.

## Activation

These changes require a matching PC/server and website room-engine release. Do not restart the PC against an older helper bundle. Verify and coordinate activation; preserve unrelated work and the independently running test server.
