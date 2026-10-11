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
test activation with a new game rather than interrupting a live demo.
