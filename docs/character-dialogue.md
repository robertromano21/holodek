# Grounded Queued Dialogue

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

## Dismiss Controls

Only dialogue subtitles and action notices have new X buttons. They hide the
visible card immediately, preserve subsequent unread speech/notices, and work
while paused or loading without triggering a world interaction. They do not
change the Game Log, room/encounter title overlays or game state.
