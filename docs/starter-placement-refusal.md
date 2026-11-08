# Starter Placement and Stay-Behind Replies

An invitation is a conversation, not permission to override a character's role. Guardians and other protected group contacts now receive only the `explain-staying` dialogue action. The model authors their actual spoken explanation using their established duty, motives and any previous explanation. They cannot accept recruitment, propose a recruitment condition, or bypass a quest role through that action.

New group invitations mark those members as awaiting a response. A group cannot seal its review or recruit willing members until every participating member has answered, including those staying behind. The authored refusal enters the same speech, memory, subtitle and voice pipeline as the other replies. Ordinary greetings do not provoke unsolicited refusals. Only residents actually available to the conversation enter a new group; an unreachable guardian cannot leave it waiting forever. An already saved stay-behind decision can receive its missing spoken explanation without reopening a completed invitation.

Fresh starter populations receive one random placement seed. Sites are selected throughout reachable space rather than forced into sight and conversation range of the entrance. Residents remain clustered with their group, away from the landing, items, exits and sealed chambers. If a candidate cannot fit the group, placement tries another safe candidate instead of piling residents onto the player. The seed and resulting positions persist through saves and revisits. Existing placed groups are not relocated. Non-starter placement keeps its existing policy.

The original starter limits and protections remain: friendly inhabitants, no ordinary shop/job offers, and Children of the Grave's local recruitment favor and 70% guardian rule. Genre content is not replaced with CotG content.

Existing service anchors remain authoritative: a legacy trader attached to an actual stall is not randomized away from it. This does not enable starter-room services.

## Testing

`tests/starter-placement-refusal.test.cjs` covers fresh placement variation, reachable and unobstructed sites, persistence, non-starter isolation, immutable guardian eligibility, complete invitation ordering, failed speech, subtitle/voice deduplication, and unreachable participants. Existing recruitment, starter-generation and whole-game suites remain release gates. No paid model calls or live save edits are used.

Save and close the game, restart only `gameServer`, run `tools/update-helpers.ps1`, and refresh the browser. Start a new game to see newly randomized starter placement; saved actor positions stay where they were. The updater verifies the exact local or authenticated website-helper release and never restarts either server. Leave `gameServer2` unchanged.
