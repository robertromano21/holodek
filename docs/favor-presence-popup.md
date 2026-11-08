# Resident Favor Presence and Offer UI

Once a resident has offered a verified favor, accepting, discussing, reporting and claiming its recruitment reward no longer require standing within three tiles or chasing their wandering position. Both actors must still be present and able to act in the same current room and host-local floor. The contract must belong to the current run and scope. Undiscovered, departed, hostile, dead and incapacitated residents remain unavailable. First conversations and physical item handoffs retain their own discovery/reach rules.

Economic actions also remove the three-tile check. An already introduced peaceful operator can finish a transaction while elsewhere in the same room; an unintroduced operator still requires a valid first introduction or service counter. Room/floor/run, prices, funds, stock and transaction receipts remain authoritative.

Saved offered resident favors produce a direct popup with Accept Favor, Decline Favor and Not Now. The existing 500 ms dialogue heartbeat delivers queued offers after active commands finish, including while the player is stationary. Subtitle playback alone does not block the popup. Saved local state supplies all offer text: no new model request or quest regeneration is needed.

Each offer appears once per loaded client run, unless dismissed state is evicted from the bounded UI history. Not Now preserves the offer and opens the normal resident sheet; the Local Contract action can reopen it. Stale results cannot introduce offers in another room, run or floor. Accepted, completed and withdrawn offers do not reopen.

The CotG starter exception exposes only its saved recruitment favor, not shops or ordinary jobs. Existing saved favors can use this fix after loading; no new campaign is required.
