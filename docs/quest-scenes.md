# Verified Quest Scenes

## Design Basis

This is our design synthesis, not a reproduction of another game's quests:

- **Witcher 3 / Cyberpunk 2077:** connect clear goals to emotional stakes, concise narrative, novelty, and choices with consequences. [Pawe Sasko's GDC session overview](https://www.gdcvault.com/play/1028897/10-Key-Quest-Design-LessonsStartup).
- **Fallout: New Vegas:** conversations should support gameplay and player expression, rather than merely choosing a different line of text. [Joshua Sawyer's GDC session overview](https://www.gdcvault.com/play/1016166/Do-%28Say%29-The-Right-Thing).
- **Inkle / 80 Days:** linked story sections, conditional choices, one-time actions, and explicit endings make branches manageable. [Official ink tutorial](https://www.inklestudios.com/ink/web-tutorial/).

Our working structure is **hook -> concrete objective -> optional encounter -> consequential resolution**. The framework separates authored dialogue from the mechanical actions that can change a stage.

## Implemented Pass

New ordinary objectives receive a small persisted stage graph around the existing verified retrieval, delivery, defeat, or puzzle contract. Previously generated objectives are not rewritten. The existing pre-boss seal-key and final boss sequence is not decorated or bypassed.

Hooks rotate between a living non-hostile resident, an existing document with actual chapters, and a newly stored covenant inscription. Source rooms and required objects come from the compiled objective, not invented room directions or abbreviated item names. Contact records retain their associated quest hooks.

Retrieval scenes can bind up to two actual existing hostiles as a required encounter. Defeating them, or recruiting them through the normal game rules, resolves that encounter. These scene participants are protected from cross-room pursuit and deferred discovery relocation while the task is active; ordinary hostiles keep their existing pursuit policy.

At the resolution, choices can conclude separately, invite a neutral/friendly contact, or accept an item already in that contact's personal inventory. No story choice invents an item, boss key, stat modifier, XP award, or automatic combat victory. Gifts retain item metadata; recruitment transfers loose possessions into party inventory and keeps the character's equipped sheet and current HP. A full party, duplicate item, missing gift, hostile contact, or full inventory can refuse the optional bargain without blocking the separate conclusion.

Direct add/invite/recruit commands for a staged contact redirect to the quest bargain instead of removing the recipient before their required handoff. Other characters' ordinary recruitment remains available.

Delivery choices use the existing engine item-transfer receipt. A dead delivery recipient still delegates to their real assistant through the successor system. For other dead optional contacts, the surviving covenant tablet allows acceptance or a separate conclusion, without pretending the dead character is speaking.

## Writing And Interaction

Quest tablets are additional engraved voxel plaques using the existing plaque geometry, not wall textures. They are mounted beside reachable floors or stand on an available floor site, above terrain and below the ceiling. They do not replace columns, sculpture, puzzle apparatus, lighting, or collision cells.

On approaching a camera-visible important writing, an encounter-style notice displays stored text. Nearness alone, a writing behind the camera, or an occluded writing does not trigger discovery. Discovery is remembered with the room's local dungeon cache; it does **not** grant reading credit. Reading chapter one via the actual read action does.

Character sheets in 2D/3D and game-console character menus offer **Quest Conversation** for an active scene participant. Clicking the writing opens its current read/respond choices. Reading an existing document can also offer its active scene. Popups are centered, use explicit confirmations, preserve a command draft, and support Later/Escape without accepting anything.

The endpoints accept a story ID, stage ID, revision, and option ID. The server resolves the action from the immutable task and validates the current run, room, living PC, participant presence, distance, and line of sight. It does not execute client-supplied effects. Busy/paused simulations, stale choices, repeated requests, and old-room responses are refused. HTTP and SSE updates share an event ID to avoid applying a result twice.

Runtime history lives in `room.questScenes[storyId]`; the immutable plan is mirrored in `room.questStories` for UI hints. Each transition has an engine receipt and is bound to the full immutable task identity. The final `quest_story_complete` gate is additional to, not a replacement for, the original requirements.

## Extension Rules

Future recipes should add fresh situations rather than increase the number of errands: an uneasy ally, disputed ownership, a rescue with competing obligations, a clue that exposes a false lead, or a negotiation with two real outcomes.

Before adding one, implement and test its actual action and evidence: escort arrival, a survivor reaching a safe tile, a bounded ambush, knowledge learned from a stored chapter, or a faction decision. Bind real actors/items/rooms before publishing it; every branch needs a completion path and a death/reload recovery rule. Unsupported proposals remain ordinary verified objectives, rather than impossible narrative tasks.

Multi-route ambush stories, escort/rescue contracts, reputation rewards, and mandatory recruitment objectives are **not implemented in this pass**. The current graph and receipt boundary are the foundation for them, not a claim that prose already makes them playable.

## Rollout

Restart the server and refresh the browser when ready to use this code. This work does not restart the live server or rewrite the active campaign.

Set `QUEST_STORIES=off` in the server environment to stop decorating future objectives. Already-published stories remain resolvable. The boss-key loop, ordinary quest compiler, and physical puzzle controls remain available. If a cached room has no legal writing site, generation keeps the plain verified objective instead.
