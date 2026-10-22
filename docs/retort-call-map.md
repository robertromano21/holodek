# Retort call map

Generated from the source (`component:` tags in `generationContracts.request` calls and direct `modelTransport.complete` calls). Every call passes through `modelTransport`, where `settingLayer.applyBody` swaps in a homebrew world's master prompt, translates Children of the Grave terms, and logs an ERROR on any denylisted term that remains. The playtest mock (`tools/playtest/capture.cjs`) answers each component locally.

| Component | File | Line |
|---|---|---|
| book-cover | `retort/bookLore.js` | 99 |
| book-chapter | `retort/bookLore.js` | 114 |
| campaign-cities | `retort/campaignSetting.js` | 179 |
| campaign-atlas | `retort/campaignSetting.js` | 199 |
| dialogue-cache | `retort/characterDialogue.js` | 40 |
| (direct json_object) | `retort/characterTraitSpec.js` | 151 |
| deity-biography | `retort/divineEncounters.js` | 198 |
| environment-intent | `retort/environmentIntents.js` | 220 |
| fortified-site | `retort/fortifiedSites.js` | 130 |
| (direct json_object) | `retort/levelSpec.js` | 238 |
| planar-portal | `retort/planarPortals.js` | 79 |
| regional-adventure | `retort/regionalAdventure.js` | 182 |
| (direct json_object) | `retort/retortWithUserInput.js` | 3329 |
| room-cast | `retort/roomCast.js` | 56 |
| room-illustration | `retort/roomIllustration.js` | 49 |
| setting-bible | `retort/settingLayer.js` | 160 |
| world-roster | `retort/settingLayer.js` | 220 |
| master-prompt | `retort/settingLayer.js` | 245 |
| instructions-expand | `retort/settingLayer.js` | 261 |
| sid-composition | `retort/sidComposition.js` | 218 |
| spell-flavor | `retort/spellSystem.js` | 96 |
| texture-spec | `retort/textureLibrary.js` | 53 |
| village-plan | `retort/villages.js` | 102 |

## Homebrew (world1) calls added

- `setting-bible`, `master-prompt`, `world-roster` (classes/races), `instructions-expand`: `retort/settingLayer.js`, called from `/builder/setting` in `retort/campaignBuilderRoutes.js`. Each prompt carries the per-world seed and a list of recently used names to avoid (`data/recent-world-names.json`), so cache keys differ between worlds.
