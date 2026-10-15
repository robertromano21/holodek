# Campaign And Character Memory

The existing text-command and Retort narrative pipelines remain intact. Memory is
separate metadata, not another character-sheet field or source of game state.

## Sources And Persistence

- The PC and party-mode companions receive short origin profiles at game start.
  Random companions share one generation request. Mortacia and Suzerain retain
  their established canon. Invalid generation uses stable local backgrounds.
- The existing room-cast request also creates each resident's personality,
  history and motivation. Profiles travel with population/companion metadata.
- Actual player commands, spoken dialogue, selected dice outcomes, committed
  console changes and verified quest steps become distinct memory records.
- Original room responses and descriptions are indexed from existing room
  history and the conversation store. Recursive personal narratives, system
  prompts, complete sheets and item-property JSON are not indexed.
- A separate IndexedDB database, `DungeonCampaignMemories`, archives records by
  campaign and room. It does not migrate or rewrite the existing conversation or
  dungeon geometry databases. Old unscoped history is adopted by one legacy run
  only. Newly saved exchanges, ambient speech and room entries carry a run ID.

## Retrieval And Knowledge

`assets/campaignMemory.js` implements a local inverted index with BM25-style
ranking, activity synonyms, inflections and limited fuzzy matching for names.
Room relevance and character participation supplement lexical relevance;
recency is a small bonus, not a reason to discard an important old clue.

Records retain literal text, room, source, witnesses and an evidence ID. Personal
dialogue retrieval filters by the character who actually witnessed or spoke the
exchange. Undiscovered/distant residents do not acquire current conversation
memories. Shared narration and private background are not objective proof.

The browser searches its archive before an ordinary command, sending only
relevant hits to the server. The server uses them in action classification,
outcome generation, quest evaluation, narration and individual dialogue. Origins
and witnessed promises/relationships also inform entry dialogue and the existing
five-minute canned-reply refresh. Cached alternatives are never remembered as
events until spoken. No extra language-model call is made just to search memory.

## Budgets And Adjudication

- Recent conversation remains the last 15 rows under the existing 700-word and
  character budget; stored history is not truncated.
- Each indexed excerpt is at most 1,400 characters. Search results/context are
  capped at 4,800 serialized characters, normally six browser recall hits.
- Individual dialogue gets at most 6,000 characters of owner-filtered recall.
- The hot index holds at most 8,192 records. Larger IndexedDB archives are
  searched in bounded pages so old entries remain retrievable.
- Browser imports are treated as historical reports. They cannot replace
  stronger server-committed evidence, including after it leaves the hot index.

The range-table generator appends hidden `ACTION_METADATA` records for potential
outcomes. The server retains only the record matching the real actor and die
roll. It validates action, range, result, puzzle steps and allowed evidence IDs.
Missing or malformed metadata falls back to the existing interpretation calls.
Valid metadata avoids two redundant interpretation calls.

A partial puzzle attempt is recorded as partial, not success. Metadata/memory
cannot grant equipment, keys or XP, bypass locks, change the bound boss, or
complete a quest outside the existing prerequisite and verification gates.

## Testing And Activation

All room entries finish the main Retort narrative, retaining the earlier room,
puzzle and quest-seeding instructions. Startup also retains the original party
awakening, Mortacia's return from exile, or Suzerain's repeated arrival after
death. Spoken passages feed the same subtitle pipeline as ordinary turns, while
the full opening is stored as room history. Nearby, visible neutral/friendly
quest contacts can introduce the existing hook on entry; other undiscovered or
distant residents remain silent. Hearing an introduction never completes a task,
grants loot, or replaces the bound boss. The reserved hook survives cache refreshes.

Directed dialogue distinguishes witnesses from recipients. `say to monsters`
selects nearby, discovered residents, while a named recipient takes precedence
over names mentioned in the question itself. Silent listeners still remember
what they hear but cannot answer instead. One companion may follow up on a
resident's preceding current-turn speech, using hidden `replyTo` and `reactsTo`
metadata. The latter must quote at least three words actually spoken by that
resident earlier in the response. Unrelated replies are excluded from both the
Game Log and subtitles; ambient canned chatter waits briefly during the exchange.
No additional generation request or change to the text-command handler is needed.

Unit tests use mocked generation, not paid API calls. The dungeon UI browser
probe exercises actual IndexedDB import, reopen, run isolation, bounded recall,
native room history and archives larger than the hot index, alongside the
existing text equipment and subtitle tests.

Backend modules require a server restart; browser modules require a refresh.
Restarting this application's server discards its current in-memory game, so
save the current game before restarting, then load the checkpoint. Do not interrupt an unsaved live demo.

## Local Semantic Recall (Additive)

The existing conversation history, per-character dialogue memories, origin profiles,
room histories and keyword index remain in place. Local semantic search supplements
them; it is not a replacement Grave Master or a source of invented memories.

### Recall Pipeline

1. Search using the current player command, not the beginning of the accumulated transcript.
2. Keep event markers: kind, source, authority, room, turn, actors and actual witnesses.
3. Qualify candidates using the current audience before local semantic encoding.
4. Combine keyword ranking with semantic matches, preserving the best keyword match.
5. Include the response to a matching exchange, not merely the earlier question.
6. Send bounded, original excerpts with provenance and character-specific evidence IDs.

`room-history` and dialogue record what happened in the narration or what someone said.
They do not prove that a belief is true. Only engine-committed/adjudicated events can
establish mechanical outcomes. Current inventory, HP, locks and quest gates still win.
Biographies remain private unless information was disclosed in a witnessed exchange.
Shared encounters establish acquaintance, not automatic friendship or omniscience.

Older server narratives that were mistakenly assigned only to the PC are linked to
the audience recorded for their original room/turn/input. No witness is inferred
from today's party or from a character merely appearing in an old character sheet.
The migration is in memory and does not overwrite an existing save file.

### Local Model

Run `node tools/install-memory-model.cjs` once. It downloads the official
`sentence-transformers/all-MiniLM-L6-v2` quantized ONNX export and vocabulary,
pins their upstream revision and writes SHA-256 checksums. Downloaded files live
under the already Git-ignored `models/memory/` directory.

Node's existing ONNX runtime runs the encoder on CPU in a worker with two threads.
No Python runtime, external inference endpoint or additional API key is required.
Sentence-sized passages avoid losing important details to the model's input limit.
Vectors are cached by model/content hash in `.retort-data/memory-vectors/`, also
Git-ignored. The cache is disposable and can be rebuilt from saved original records.
No generated summaries replace those records.

Initial indexing has a two-second foreground allowance; keyword recall stays usable
while the worker finishes warming. Logs explicitly distinguish `not-installed`,
`ready`, errors, keyword recall and hybrid-local recall. Semantic matches are not
guaranteed correct, so the existing keyword anchor and witness gates remain mandatory.

The server hot index remains bounded at 8,192 records. The browser's existing paged
archive search can reintroduce older evidence. This is not a guarantee that every
event will be retrieved for every possible question.

### Verification

- `node --test tests/campaign-recall.test.cjs tests/campaign-memory.test.cjs`
- `node tools/verify-campaign-memory.cjs 1` reads Slot 1 in an isolated process.

`[CampaignRecall]` logs the query, retrieval mode, evidence IDs, scores, room/turn,
witnesses, excerpt flags and serialized context size. `[SemanticRecall]` records
local timing and similarity candidates. Neither triggers another story generation.

References: [MiniLM model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2),
[Sentence Transformers similarity documentation](https://www.sbert.net/docs/sentence_transformer/usage/semantic_textual_similarity.html).
