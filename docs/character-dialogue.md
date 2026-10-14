# Grounded Queued Dialogue

## Character Creation

The Ruined Temple now uses the same inhabitant generator as regional rooms.
It retains one to four Friendly residents for solo starts; party awakening
still does not add another starting-room cast. The one generation supplies
individual names, occupations, personalities, voices, histories, motivations
and greetings. The engine continues to assign allegiance, stats and equipment.
Authored profiles persist with the room, companions and campaign memories;
switching models does not reroll a character's life or identity.

Party creation already requested biographies. Its original pre-Luna writing
prompt is preserved verbatim, with Mortacia and Suzerain's canonical profiles
excluded from random authorship. Completing an older partial profile preserves
its established fields rather than rewriting a real history to add a voice.

Missing biographies no longer get locally fabricated regret/betrayal templates.
Existing sessions detect those legacy templates and request real authorship
before the next story response. Invalid JSON, missing rows or fields, duplicate
identities and provider errors stop generation with a bounded diagnostic;
they do not substitute stock residents or retry silently. Look for
`[InhabitantGeneration]` and `[CharacterProfiles]` requested/generated/failed
events, including the failing field and up to 2,000 response characters.

Isolated Retort character-generation sub-runs explicitly inherit the unchanged
original Grave Master lore for either model. Biography and inhabitant calls
clear any previous equipment-modifier response schema. The model adapter
contains backend routing/format instructions, not a different personality prompt.

`tests/character-generation.test.cjs` pins the pre-Luna biography prompt and
captures offline starting/regional requests with identical cast/world inputs
for 4.1 Mini and Luna. This verifies prompt/transport parity, not a claim about
live literary quality. Both original top and bottom prompts remain hash-pinned.

Normal Retort narration keeps the existing bounded conversation history, prose,
speaker metadata and subtitle pipeline. That same generation prepares future
character remarks and optional companion exchanges; it does not make a second
API request. Routine mechanical puzzle actions still bypass the model.

Both normal turns and the five-minute fallback receive:

- Individual personality, voice, past-life history, occupation and motivation.
- A bounded chronological recap of personally witnessed speech and player inputs.
- Witnessed committed outcomes and older, relevant search-backed memories.
- The existing verified journey synopsis, explicitly reserved for party members.

Recall is capped at 6,000 serialized characters across the cast. Party members
and nearby listeners get more of that budget than distant residents. Unheard
player conversation is not used as a distant character's search query. Backgrounds,
claims and reported room history are not proof that a puzzle or quest is complete.

## Batches And Playback

The planner requests up to six remarks per companion, four per encountered
resident, and two per unseen resident, capped at 64 individual remarks per batch.
The parser also enforces the room-wide cap and rejects unknown speakers. At most
two additional two-line companion exchanges can be queued. Both speakers must
still be living party members within hearing distance before an exchange plays.

Playback uses the existing 30-second ambient cadence and subtitle queue without
model calls. Discovery, room, hearing, pause and directed-conversation gates still
apply. A fresh batch replaces stale alternatives and resets the five-minute
refresh clock on both server and client. Partial or stale background generations
cannot overwrite a newer turn's batch. Queues persist with room inhabitants in
the existing IndexedDB storage; they are not stored as performed dialogue.

`[DialogueGrounding]` logs which personal evidence IDs reached each speaker's
prompt. `[DialogueRefresh]` reports the periodic batch. `[DialogueSubtitle]`
distinguishes queued text from text actually displayed. Only delivered speech
enters the campaign dialogue archive, never unspoken alternatives.

## Complete Speech And Idle Echoes

The October 14 Edran reply contained three quotations separated by gestures.
Only its first quote appeared in `[DialogueSubtitle]` reports: unlabelled speech
after "His thumb rubs at a faded groove" lost its speaker before reaching the
voice system. The shared fallback extractor now accepts embodied possessive
gestures only after a speaker has been established. Existing inscription,
unknown-speaker and player-speech exclusions remain. Inline labelled speech is
still preferred. No SID synthesis or voice timing change was needed.

The same generation put shortened versions of that answer into future idle
alternatives. Prompt guidance now requires new thoughts, not live-answer copies.
Server cache updates and the browser subtitle queue also screen obvious lexical
echoes against recent speech by that character. This bounded history expires
after ten minutes and is not campaign evidence. New facts and questions are
retained; live player-requested answers are not suppressed by the idle filter.

## Prompt Comparison Baseline

The added public-culture recap and instruction to give lore before asking a
question have been removed from inhabitant creation, live dialogue and queued
dialogue. Campaign recall again uses its earlier unknown-evidence wording.
The full original Grave Master lore and bottom action/dialogue instructions
remain unchanged, including character agency, questions and disagreements.

Custom biography generation, error diagnostics, witnessed-memory restrictions,
command-selector semantics and speech deduplication remain in place. Regional
inhabitants still receive their original community-generation context. This
isolates the added lore emphasis from the removal of stock biography fallbacks;
it does not substitute another personality directive. Moral inversion remains
absent from variability seeds; its leftover rhyme examples and mandatory
quest-progress moral twists have also been removed.

Restart the server to load prompt changes. Saved biographies, delivered dialogue
and existing caches are not rewritten. Use a new adventure for the cleanest
comparison; earlier lore-heavy conversations otherwise remain part of memory.

## Dismiss Controls

Only dialogue subtitles and action notices have new X buttons. They hide the
visible card immediately, preserve subsequent unread speech/notices, and work
while paused or loading without triggering a world interaction. They do not
change the Game Log, room/encounter title overlays or game state.

## Logged Speech And Listeners

Speech already delivered in the Game Log is authoritative for subtitle playback:
distance, walls and missing world positions cannot suppress it. Nearby ambient
speech still obeys hearing limits. Mixed responses retain backend-labelled
identities while also recovering clearly attributed, unlabelled quotations.
The fallback recognizes actions such as "stills", "slows", "keeps" and "remains";
inscriptions, thoughts and ambiguous speakers are not invented as dialogue.

Optional spoken metadata `recipient` identifies the PC or another known character.
Paired companion exchanges supply each other's names automatically; an unambiguous
vocative can also identify a listener. Merely mentioning someone is not addressing
them. NPCs and residents use existing collision-checked walking toward a clear
viewing tile in front of the PC, or beside the addressed character. Combat movement
stays authoritative. An unreachable goal never teleports the speaker or delays
their subtitles. Reload browser assets and restart the server for these changes.
