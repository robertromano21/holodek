# Grave Master Style and Prompt Continuity

Local transcript review, October 14, 2026. No paid model evaluations or live
campaign edits were performed. These are different player inputs and scenes,
not a controlled model benchmark or access to either model's hidden reasoning.

## Sources and Observations

`logs/server.log` records the current server starting at 14:36:41 UTC and the
selection of `gpt-6-luna` at 14:37:10 UTC. The subsequent campaign run is
`51604c44-0138-4730-959c-f2391e2a6898`. Retort's saved `settings.model` still
records the helper's requested model, not the effective model override; do not
use that field alone to label a transcript.

Saved transcripts under `.retort-data/log` examined:

| File prefix | Scene | Visible prose words |
| --- | --- | ---: |
| `063563e73863` | Earlier 4.1 Mortacia temple arrival | 186 |
| `22a947424fa3` | Earlier 4.1 party conversation | 271 |
| `667374c05ea7` | Earlier 4.1 Liora quest conversation | 363 |
| `fa2af94fd627` | Current Luna Mortacia/pilgrim conversation | 142 |

Counts exclude backend dialogue metadata and speech labels. Scene size and
number of speakers differ. Earlier prose uses longer descriptive transitions,
more sensory detail and fuller monologues, but also repetitive sands, shadows
and debts. Luna's pilgrims ask follow-up questions and disagree thoughtfully;
retain that agency rather than reproducing the older repetition or omniscience.
Repeated uncertainty and returning to their work can flatten personal history
and emotional development. Encourage specific memories and specialist cultural
knowledge without inventing current quest facts or private witnessed events.

The raw naming output was `Sereveth-Notched-Ear` and `Veyr-of-the-Last-Breath`.
The starting-monster sanitizer deleted punctuation, creating glued names; this
was not solely model formatting. New names now convert separators to spaces
before registration. Existing saved names are deliberately not renamed because
inventory ownership, dialogue memory, factions and quest bindings use them.

The awkward "An ancient echo chimes ... links" sentence comes from the local
physical-puzzle fallback template, not truncation of Luna's room description.
Its grammar is repaired without changing puzzle rules or solutions.

## Both Original Prompts Are Preserved

All three full Grave Master instruction copies remain unchanged. Both source
copies of the bottom prompt beginning "Write an interactive fiction adventure"
also remain unchanged, through the final "Improvise!". It is present in the
earlier 4.1 and current Luna saved conversations. Different rendered lengths
come from the interpolated room name. Offline request-capture tests verify that
the complete bottom prompt reaches the wire for Original, 4.1 Mini and Luna,
alongside the complete lore and later subtitle/cache instructions.

The modern-model addendum distinguishes substantive narrative from 20-word
cached remarks, but no longer contains model-specific literary/personality
coaching. Character-writing instructions are shared by both model paths. The
subsequent public-lore addendum was removed at the user's request for a comparison
without that emphasis; original lore and both bottom prompts remain intact.
Recognition does not imply trust, worship or access to private plans.

## Verification

`tests/grave-master-protocol.test.cjs` pins the original top and bottom prompt
hashes and captures complete offline requests. `tests/generated-names.test.cjs`
covers actual naming paths, consistent new identities and puzzle fallback
grammar. Improved prose quality still needs live playtesting after restart.

## Follow-Up: Metadata-Only Opening

The later October 14 session selected Luna at 18:39:02 UTC. Its opening
generation at approximately 18:41:40 UTC included the full `Integrate` and
`Write an interactive fiction adventure` prompts, but returned only a
`CHARACTER_DIALOGUE` block with future cached remarks for Edran Bellworn.
Removing that backend block left no opening prose. The displayed mechanism
paragraphs were the independently compiled puzzle description. Prompt presence
alone therefore did not establish that the opening story actually appeared.

The user's October 5 reference in `holodek-2/retort/retortWithUserInput.js`
generated narrative immediately after the bottom sequence. The current pipeline
also included a later "Queued dialogue planning, not immediate speech" work
order, conflating a live story turn with a background cache update. Startup's
empty internal input additionally received a misleading 45-second idle prompt.

Live turns now use an explicitly narrative-scoped grounding prompt: cache
instructions apply only to trailing metadata. The final generation instruction
requires prose first, including when no resident is permitted to speak.
Genuine background cache refreshes retain their cache-only instructions. Empty
startup input no longer receives the idle prompt. Quest seeding supplements
rather than skips the complete bottom story sequence. The original top and
bottom prompt texts are unchanged, and combat's mechanical early return remains.
No metadata rejection, automatic model retry or fabricated fallback story was
introduced. A bounded `StoryNarration` diagnostic records phase, story length
and `story` versus `metadata-only`, without copying story text into another log.

`tests/story-turn-pipeline.test.cjs` executes the real bottom branches,
narration and response assembly with an offline transport for both model paths.
It verifies the request and displayed result, the no-discovered-speaker case,
quest seeding, idle separation and unchanged encounter/geometry state. Synthetic
prose verifies transport and assembly, not live model compliance or quality.

## Follow-Up: Character Generation Was Not Equivalent

The legacy starting-room path generated names, race/class and equipment but
never requested personal biographies. Population construction then silently
filled missing fields with hash-selected local templates. Their common history
ending was "That memory still shapes how this individual treats strangers and
obligations." Their motivation was always a regret and avoiding betrayal.
Those were local defaults, not rejected model-written biographies.

The regional generator did request individual histories and motivations, and
party creation already used a dedicated biography batch. Earlier 4.1 transcripts
also contain some local template profiles. Comparing authored regional or party
characters with templated starting residents is not a controlled model comparison.

The Ruined Temple now calls the regional generator while preserving the friendly
solo opening and separate party awakening. Profiles include an explicit voice,
and malformed generation fails visibly instead of manufacturing replacement
residents. Existing complete authored profiles remain stable; detected legacy
templates can be replaced before narration, without changing mechanical sheets
or sprites. The party-writing prompt matches its pre-Luna source exactly.

Offline request-capture tests use the same initial cast/world data and full
original lore under 4.1 Mini and Luna. They verify identical character-writing
instructions and temperature; the modern backend role adapter remains the only
protocol difference. The three original top and two bottom prompts retain their
previous hashes. A live quality comparison still needs the same scene, selected
PC, cast, authored biographies, history and player command, not two unrelated
campaigns. No paid A/B generation or live campaign mutation was performed.
