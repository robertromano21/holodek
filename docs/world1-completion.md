# Genre and City Completion

This additive expansion is opt-in. Verify it in `holodek-1-world1-test` before
enabling it in a deployed game. No model download, provider credentials, saved
games, or services need changing. Existing source work is retained.

## Content and Routing

- Eighteen visual genres: the original twelve plus gothic-horror, solarpunk,
  dieselpunk, underwater, prehistoric, and desert-fantasy.
- 144 additional native voxel recipes cover house, hall, gate, tower, column,
  shrine, stall, and utility roles in every genre. Frontier false fronts and
  porches, pressure habitats, neon setbacks, salvage shelters, canal foundries,
  deco tiers, reef domes, lodges, and courtyard wind towers have different geometry.
- Eight additional CotG pieces: funerary stoa, ossuary arcade, sepulchral pylon,
  ribbed buttress, basalt ziggurat, bone reliquary, memorial rotunda, mourning gate.
  These are also available as Holodek building options.
- 54 additional wall/floor/door materials use the existing procedural texture
  pipeline. Existing materials and art remain available. No image API is used.
- Genre clothing reaches the original 2D tokens and native multi-view 3D actors;
  body plans, equipment authority, movement, and CotG character styling remain intact.
- Campaign Builder genre choices, structure choices, texture prefabs, room
  illustrations, native props, and the developer sandbox share the actual catalog.
- `settingLayer` remains the routing point. The homebrew level/puzzle prompts use
  that world's art direction, peoples and history. The canonical mural injector
  does not force CotG deities into homebrew art. Homebrew start geometry, campaign
  regions, factions, city planning and authoring prompts use their own bible, not
  the CotG temple or Tartarus-to-Hades atlas. Invalid genres and failed generation
  produce explicit errors rather than silently creating a different world.

## Cities and Markets

The existing 30-60-room city planner now has genre vocabulary and dressing for all
18 genres, district population guidance, service roles, seeded markets, and actual
route metadata. Enterable buildings receive genre-native frames labeled with their
actual saved destinations. Markets and civic services do not require an invented shopkeeper.
Actors are still authored by the LLM within authoritative allegiance slots.

Re-entering a city member does not recursively create another city. New cities
relocate private layers around saved rooms, stay within coordinate bounds, and
never overwrite those rooms. Metadata upgrades preserve existing residents,
deaths, recruitment, exits, puzzles, inventory, and markets. Browser synchronization
cannot remove city identity/routes or forge market pressure.

Optional trade follows existing open routes, including cavern/surface and diagonal
connections, respecting nested door locks and excluding portals. It propagates
bounded demand pressure only, not goods, currency, jobs, contracts, or quest rewards.

## Opt-In Test Configuration

New flags default **off**. Enable together on the test process only:

```text
HOLODEK_GENRE_EXPANSION=1
HOLODEK_ARCHITECTURE_EXPANSION=1
HOLODEK_CITY_COMPLETE=1
HOLODEK_TRADE_ROUTES=1
HOLODEK_CITY_SITES=1
```

Prerequisites: existing HOMEBREW, CAMPAIGN_BUILDER, GENRE_KITS, GENRE_ARCH,
CITY_SITES, CITY_PROPS, CITY_PLACEMENT, CAMPAIGN_MAP, and MARKET_ECONOMY switches.
Do not enable on live until the test-copy playthrough is approved and passes.

```powershell
node --test tests/world1-completion.test.cjs tests/luna-default.test.cjs
node tests/world1-genres.test.cjs
node --test "tests/*.test.cjs"
node tools/preview/world1-completion.cjs
```

Contact sheets are written to `previews/completion/genres-1.png` through
`genres-3.png` and `cotg-architecture.png`. They use real voxel geometry, native
tiles, 2D tokens and solid 3D actor frames, not illustrative mock assets.

Validation on 2026-10-20: focused suite 31/31 (27 expansion and four Luna-default
tests), plus two updated startup regression checks; existing genre runner 20/20.
The isolated full suite passed 2,299/2,332,
compared with 2,272/2,305 before edits: the same 33 failing test locations, with all
27 new tests passing. These include existing source-fingerprint and VM-harness
failures; the full suite is not green. Exact installed-worktree results belong in
the handoff because Git context and concurrent source edits affect the baseline.
Mode 4's live-failure errors apply even with expansion disabled; deliberately
runner-free offline/mock generation remains available for local testing.

With native-dialog approval, live smoke tests made 12 calls to `gpt-6-luna`:
Western, sci-fi and underwater each generated a bible, master prompt, playable
roster and native scene specification. All passed schema, model and setting
isolation checks. `tools/playtest/genre-luna-smoke.ps1` reruns this bounded test
after another permission dialog. The ordinary authoring runner is also checked
offline through its real streaming transport using a fake SDK response.

A browser playthrough of the expanded start/city flow remains a release gate,
along with resolving or accepting the existing suite failures. Any browser or
live-model test session requires the native permission dialog first.

## Deployment Profile

`ecosystem.config.cjs` provides an explicit `city_expansion` environment. It enables
the five switches together without changing `worldFlags` defaults, selecting a
different model, or enabling the developer sandbox:

```powershell
pm2 restart ecosystem.config.cjs --only gameServer --env city_expansion --update-env
pm2 save
```

On 2026-10-21 the local live process was activated with this profile after the
user saved and approved the restart. Verification included 55/55 focused checks,
the isolated full suite (2,405/2,461; the same 56 baseline failures), MD5-verified
source backups, and syntax checks of all 303 installed JavaScript files.
Native-dialog-approved, model-free browser checks exercised the 18-genre picker,
world bible/master/roster/start flow, and nine rendered city visits across western,
sci-fi and underwater fixtures. These fixture checks are not a paid-model
end-to-end adventure playthrough. Private deployment reports and rollback backups
are in `.retort-data/city-genre-activation/` and are not published.

Refresh the game page and reload the saved game after activation so the browser
receives the new switches. Existing authored rooms and residents are not rerolled;
the new options apply to subsequent generation.
