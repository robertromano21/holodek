# Local Holodek Authoring

`holodek-1` uses the installed 4096-token context. Admission counts the final
messages, schema instructions and native JSON schema, with an estimated input
ceiling of 2816 tokens, 1024 answer tokens and 256 framing/safety tokens. These
are conservative character-based estimates, not the model's exact tokenizer.
Oversized immutable instructions are rejected before inference, never silently
cut off. Completed old work may be removed, but system rules, the latest game
console and unfinished instructions are protected.

Large local authoring jobs opt into `generationContracts.request({localWork})`:

- Campaign regions, factions and city placements are authored in ordered pieces.
- Adjacent room names use exact destination coordinates and a fresh branch per
  name; a published destination is reused without a request or rename.
- Room descriptions and visual styles receive their physical room facts only.
- Residents use one slot per request; the complete population validates before installation.
- Missing backgrounds are authored one exact character at a time. Recurring
  casts and regional adventures retain their accepted identities across parts.
- Dungeon concept, spaces, connections, buildings, paths and scenery are separate orders.
- Custom tiles split identities, sprite geometry/details and drawing programs.
- Room paintings split composition/palette and ordered component batches.
- Mechanisms split controls, decorative art, documents and inscriptions.
- Music splits identity, harmony/rhythm choices, contours, performance and movements.
- Quest element counts, kinds, placements, task actions, descriptions, metrics
  and progress narration are separate orders. Engine completion checks still win.

Story responses split scene prose, each NPC's live speech, and each character's
future reply cache. Only completed live lines enter dialogue memory/subtitles;
future alternatives are never witnessed events.
Ordinary narration refreshes alternatives only for its actual speakers; other
residents retain their existing replies until the scheduled full cache refresh.
Each speaker receives only their
own recalled disclosures. Unheard residents get no current conversation, private
quest plan or party journey. The scene receives bounded campaign evidence and
ranked lore references; individual speech receives witness-filtered memories.
Full task graphs and duplicate console snapshots are not narration dependencies.

Adjudication splits intent, each actor's range boundaries, each potential range,
and selected-result effects/XP. JavaScript compiles the complete range table
before rolling; later links see actual selected results, not hypothetical wins.
Rolls, HP, prerequisites, first-completion rewards and commits remain engine-owned.

`holodekWork.js` admits each part against its estimated input AND output size.
Each part starts a clean Retort branch and receives the task brief plus accepted
dependencies. Geometry summaries retain footprints and indexed connections;
mechanism summaries retain control IDs/options/states. Large enum menus use
bounded family selection or shortlists without introducing unlisted values.
Contour cardinality follows the selected rhythm. JavaScript assembles results
in order and runs the existing final validator before returning a completed job.
A failed part does not return a partial plan as completed. Semantic retries may
reauthor a job; unfinished part results are not a persisted cross-session cache.

Logs: `[HolodekWork]` shows component, path, requested/accepted status and token
estimates. `[holodek-1 budget]` reports final wire admission. Website helper
`[WebsiteJob]` and room-build logs only appear when those jobs are dispatched;
connected idle workers alone do not establish that a room was prefetched.

This path applies only to explicitly selected `holodek-1`. Other providers keep
their existing requests; Luna remains the application default. Polling, existing
world flags, saved games and website/PC model routing are unchanged. Smaller
requests prevent context starvation but add per-request overhead; speed and
creative quality still require real-model playtesting.

Offline coverage: `node --test tests/holodek-work.test.cjs` exercises final native
request budgets, assembly, dependency retention, failure atomicity and the real
art/music/mechanism schemas through a mocked PC host. It makes no inference calls.
`tests/holodek-chain-isolation.test.cjs` additionally covers poisoned parent
history, coordinate reuse, scene/speech/cache separation, private memory scopes,
per-actor range compilation, selected-only XP, backgrounds and the real local
level-spec chain without a cloud API key. Full gameplay remains a separate test;
an individual mandatory payload can still require further splitting if it alone
exceeds the conservative input allowance.
