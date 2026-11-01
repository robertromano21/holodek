# Furnished Venues, Residents And Books

Status: source staged for a coordinated PC/helper release. No live server, helper or save was modified by this work.

## Physical Furnishing

- 26 approved furnishing families in each of 18 genre families: 468 voxel assets, including 216 additions.
- New silhouettes include dining tables, bookshelves, wardrobes, washbasins, altars/memorials, stages, noticeboards, tools, merchandise, planters, vessels and instruments.
- Genre-native models include technological, historical and organic construction differences, with material-coloured books, plants and displays. Children of the Grave uses its approved fantasy-family assets.
- Both street-level walk-in parcels and generated venue interiors use functional room recipes. Kitchens, archives, bedrooms, clinics, workshops and public waiting areas have different furnishing programs.
- Dimensions are metres converted at 2.5 metres/cell. A normal chair is 0.75 metres wide, not several metres wide. Placement retains reserved paths, doorway approaches, spawn clearance and room circulation. These furnishings are scenery, not automatically collectible loot or new economy stock.
- Authored venue envelopes remain shared between exterior and interior. The missing/empty-blueprint path now also fits within that envelope. Major shop complexes are 40 x 50 metres; temples are 110 x 130 metres with an 18-metre nave clearance. Towers retain their separate connected floor program. This does not turn every minor frontage into a skyscraper or load all floors simultaneously.
- Furnished bookshelves expose individually readable volumes through the existing library picker.

## Residents And Work

- Lightweight crowds retain saved venue assignments: work, visit or errand, with an activity, purpose and actual venue identity. Building occupants prefer physical work sites when available.
- Named residents retain their model-authored occupations and activities. Their venue assignments are saved without resetting positions or replacing histories.
- Meeting an ambient resident authors only that person and includes their saved reason for being there. Untouched bystanders do not request dialogue or sprite models.
- Ambient assignments do not create payable jobs or simulate a complete daily traffic/schedule system. Named contacts expose only actual saved contracts through the existing commerce menu.
- Outbound delivery contracts bind a real living sender and recipient in the same community/city along an unlocked saved route. Accepting issues one sealed dispatch into inventory, subject to the 25-item limit.
- The contract lives at its origin, avoiding a remote room write during helper construction. A real item-transfer receipt at the destination, including the issued dispatch identity, releases escrow once. Existing completion subtitles/logging and genre currency apply. A duplicate accept, a dropped item or an unrelated same-named item is not payment evidence.

## Books And Research

- Newly seeded chronicles and reference books contain no fixed chapter prose. The first reading authors title, known author or Unknown/Anonymous, written year and table of contents. A physical chronicle object may still occur in the CotG temple; its generated literary contents are not fixed.
- Covers and requested chapters are saved in the room database for that game. New games generate new literature. Rereading never deliberately rewrites a saved chapter.
- Existing authored puzzle text, book identity, modifiers, clue bindings and quest hooks survive metadata enrichment. Inscribed clues and spell formula scrolls keep their explicit engine-authored functions.
- Each unread chapter is generated on demand through normal read commands. Cover inspection is not reading a chapter. The reader provides clickable contents and previous/next navigation.
- Genre books retrieve that world's saved lore, not the CotG master prompt, pantheon or Surface Reckoning. Local inference uses keyword retrieval without a paid retrieval-model request. Model work is rejected for remote books or a stale game, and queued opens share the saved result.
- Actual chapter reading records book ID, source coordinates, chapter and content hash. Research objectives bind those facts, not prose claims or possession alone. They may require return to a real contact and explicit quest resolution.
- Existing seeded book titles, chapter subjects and cached excerpts are available as bounded quest inspiration. Reading never itself grants a spell, hidden exit, quest reward or physical object. Subsequent casting still requires the normal spell system.
- Book records, facts, reading evidence and dispatch identity are protected from stale model snapshots. Save/load uses the existing database persistence; no migration of a user's live save was performed.

## Verification

Run the focused city/book/contract tests, the complete test suite, and the coordinated helper verifier. The pre-existing full-suite baseline is 47 named failures, recorded in `.retort-data/city-streaming/full.log`; compare identities, not just the count.

Voxel contact sheets are generated with `node tools/preview/venue-furnishings.cjs`. This is an inspected procedural-art preview, not a live 3D gameplay or frame-rate verification. Native browser testing still requires approval. Activation must coordinate the PC engine with all three website helpers; do not independently switch helpers while the live PC still runs an older engine.
