# Genre Asset Pipeline

`retort/genreAssetPolicy.js` is the authoritative genre-scoped catalog. It resolves the selected world's weighted genres and explicit portal overrides, then exposes only registered assets belonging to that set. A saved room's stale genre tag cannot introduce another genre.

## Coverage

All 18 genres have native architecture, wall/floor/door treatments, distinct ceiling undersides, characters, equipment, lights, and fourteen furnishing families: storage, workstation, seat, light fixture, barrier, transport prop, working device, display, sleeping, food, medical, communication, research, and craft. There are 252 named furnishing assets and 126 genre-native structural supports, beams, roof panels, windows, doorframes, canopies, and trim pieces. Furnishings are scenery, not new vehicle or machine interaction mechanics.

`architectureDesigns.js` provides 82 additional silhouettes: four per genre (gate, gallery, workstation, overlook) and ten canonical funerary designs. The 18 new overlooks include pressure-rated observation ribs, timber survey shelters, planted pergolas and pierced windcatcher loggias. Their procedural 2D sprites and 3D voxels share the same silhouette and genre palette. They are scenery; real traversable elevation is owned by the floorplan, not by climbing a decorative voxel prop.

| Genre | Interior Examples |
| --- | --- |
| Fantasy | Ironbound chest, alchemy bench, well winch |
| Dark Fantasy | Bone coffer, embalming table, reliquary |
| Mythic | Amphora rack, sculptor bench, orrery |
| Science Fiction | Cargo locker, engineering console, reactor coil |
| Cyberpunk | Server rack, capsule bunk, power junction |
| Post-Apocalyptic | Scrap cache, salvage bench, water filter |
| Steampunk | Brass cabinet, machinist bench, piston engine |
| Western | Smith's anvil, covered wagon, wind pump |
| Modern | Filing cabinet, office desk, transformer |
| Noir | Evidence cabinet, detective desk, radio |
| Nautical | Sea chest, sailmaker's table, capstan |
| Cosmic Horror | Sealed casket, crooked throne, resonator |
| Gothic Horror | Coffin rack, funeral carriage, pipe organ |
| Solarpunk | Seed bank, repair table, rain collector |
| Dieselpunk | Munition locker, tracked trolley, generator |
| Underwater | Pressure locker, dive console, oxygen manifold |
| Prehistoric | Woven baskets, flint table, drying rack |
| Desert Fantasy | Ceramic jars, lattice screen, waterwheel |

## Selection And Compilation

- Level specifications and custom scenery use Retort answer schemas with exact, genre-scoped shape enums on every model. Unsupported IDs fail validation; free labels cannot select foreign assets.
- Homebrew blueprints use the same bounded structured chain as local models, with genre-appropriate roof, column, module and building choices. Supplementary builders cannot add a classical shrine to a technical setting.
- Native shapes paint both map sprites and voxel meshes from the same occupancy generator. New expansion assets remain behind the existing genre/architecture expansion switches.
- The final compiler validates procedural dressing too. Station supports are plain struts, beams are girders and roofs use panels, not Doric columns and barrel-vault shells.
- Old rooms receive visual descriptor corrections at complete-room delivery boundaries. Cells, collision extents, placed actors, inventory, puzzle state and exit bindings remain unchanged. Ordinary action deltas do not regenerate cached geometry.
- Canonical Children of the Grave keeps its existing visual language; intentional fantasy crossovers remain available when fantasy is explicitly selected in a blend.
- Resource names are display-only aliases across console, inventory-property JSON and character popups: Tech, Luck, Magic or the world's override. Switching worlds restores the correct label without rewriting saved numeric fields or item names.

## Spatial Design

`genreLevelDesign.js` defines three architectural briefs per genre, 54 total. Room seed, coordinate and name select a reproducible direction; continuous seeded elevation, reflection and placement variation prevents the brief from being a single fixed map. Examples include science-fiction reactor annuli and cultivation cascades, nautical drydock rims and split quarterdecks, noir theatre balconies, and prehistoric cliff shelters. The bounded blueprint chain receives the selected composition, material language, alternate-route and ceiling requirements on every model.

When a newly generated constructed interior omits a floorplan, the compiler can supply a connected ring, spine or terraced composition, with actual floor heights, lower side spaces and ramps. This is an omission supplement, not a retrofit of visited geometry or an excuse to turn caves into buildings. Authored placements win. Covered and underwater interiors retain roofs; no unsupported stacked walkable floors are promised by the XY renderer. New work remains behind the existing genre/architecture switches and uses the same compiled code on PC and website helpers.

The architectural briefs do not grant victory or create quest state. Alternative-world quest prose is setting-specific, but the existing objective-item/boss loop is still largely shared. Distinct investigation, rescue, restoration or political finales require their own engine-verified completion rules; arriving at a final room or a model announcing success is not a substitute.

## Verification

Mode 4 uses `homebrewStoryPrompts.js`, not renamed canonical campaign instructions. Its story, room, population and voice work orders use the original world's own history and destination. `genreStoryPalette.js` supplies open narrative dimensions for all 18 genres, not canned room scenarios. `genreCeilings.js` supplies deterministic native ceiling undersides while roof geometry remains in the existing structural system.

Remote geometry embeds generated PNG bytes in its checkpoint rather than returning website-only file URLs. Legacy missing images and ceiling styles are repaired at complete-room delivery boundaries, without moving actors or changing the collision layout. A separate visual asset stamp invalidates image preloads without changing geometry identity. Non-fantasy mounted lights and art lights use appropriate native fixtures instead of inherited torch flames.

`genreFixtures.js` adds 54 approved sources (three per genre), with shared sprite/voxel silhouettes, luminous cores and fitting light colors. Wall replacements retain the existing solid cell and torch mounting/occlusion path. Placed light furnishings and fixture structures also emit at their actual positions. WebGL, WebGPU and Canvas carry per-source RGB instead of replacing every color with torch orange. Existing nearby-light caps and shadow caches remain in use; light detection and color decoding are cached. Canonical mounted torches retain their original assets and behavior.

Mode 4's initial description is not evidence that its resident cast was authored. A component-only repair creates two to four Friendly residents when the starting room still has an empty runtime placeholder, without rebuilding the room. Authored populations, recruited records and tombstones prevent repeat generation. Starting residents are placed within arrival sight/conversation range; their authored greetings explain this setting and offer companionship without auto-recruitment or an invented quest.

`node --test tests/genre-asset-policy.test.cjs tests/genre-local-budget.test.cjs tests/resource-label.test.cjs` checks all catalogs, schema exclusions, blends, portal overrides, furnishing coverage, silhouettes, native sprite/mesh output, gameplay-preserving upgrades, actual 4096-token local work orders with mocked inference, and display-only resource labels. `node tools/preview/genre-assets-sheet.cjs` renders the registered generators to an ignored preview sheet.

This establishes a consistent procedural baseline across genres. The fantasy campaign still has deeper bespoke content, puzzles and lore; equal asset coverage is not a claim that every genre already has the same amount of authored campaign content.

## Future Cities And Biomes

`urbanDesigns.js` adds 54 native building silhouettes, three for each genre: a midrise, a skyline landmark and a terraced block. These share occupancy geometry between map sprites and voxels. Declared futuristic cities receive metropolis metadata; outposts and villages retain their scale. Future city dressing uses the existing 220-placement ceiling and concentrates street furniture, actual stalls and building clusters within sight of arrival, rather than distributing a few props across a 512-square map. Reserved navigation and the arrival clearing remain intact. Decorative skyline blocks are not additional walkable storeys; enterable buildings remain the existing reciprocal city-site rooms.

`biomeRecipes.js` adds 18 genre-scoped ecological combinations plus three canonical Tartarus biomes. Approved terrain relief, plants and prop species are compiled together: mistwood terraces, reclamation marsh, painted gulch, mangrove reach, vent garden, gypsum wadi, ashen bonewood and other distinct locales. Explicit saved intent selects a recipe; this does not randomly replace authored biomes. New options are filtered by the active world before entering model prompts. City streets no longer acquire automatic badlands props or dead forests merely because their prose mentions the surrounding wastes.

`locationAwareness.js` projects bounded public geography from actual saved coordinates, exits, city bindings and nearby atlas entries. Individual live replies, scene narration and cached alternatives receive the same local facts. Verified first-hop routes are distinguished from map bearings; closed and hidden routes are not invented. Names alone do not turn a wilderness room into a city. Available services require present living operators; recruited/dead residents are not phantom vendors. Newly generated markets reserve an authored operator slot, including friendly starting markets, with other guides still available to recruit. Existing populations and their tombstones are not replaced.

`currencyLanguage.js` supplies distinct defaults for all 18 genres and supports a saved world override. CotG retains silver pieces. Engine wallets and saves keep their numeric compatibility fields; UI labels, price text and world instructions use the setting's denomination without renaming silver equipment. These changes do not retrofit current saved terrain or silently restart either server.

Dialogue context uses model-specific policies. Only holodek-1 takes the compact voice/profile and local-geography path; its work orders reserve output and safety space inside 4096 tokens. API models retain the supplied room, quest and conversation text, full character profiles, larger public regional context and a 24,000-character witnessed-memory retrieval budget instead of the local 6,000-character maximum. Explicit caller budgets remain honored. Witness ownership, perception and short idle-cache playback limits are gameplay rules on every model, not reasons to truncate API story context.

`node --test tests/genre-level-design.test.cjs tests/tactical-layout.test.cjs tests/resource-label.test.cjs` covers all genre floorplans at two grid sizes, reachability, headroom, saved-plan preservation, mocked local blueprint token budgets, the actual first-round roster merge and presentation-only resource labels. `architecture-designs.test.cjs` also checks every registered silhouette at 16, 24 and 32 voxels; its pre-existing expanded-asset checksum failure is tracked separately from new geometry.
