# Combat Sprite Sizing

The 2026-10-12 party replay exposed a shared combat-map calibration error, not a special PC scale. Benedict's saved High Elf stature is 1.0, but his compact `tiny` drawing layout reported only 52 source pixels of body height. The visible helmet, outline and feet occupy 72 pixels. Compensating for the smaller nominal measurement made him about 47 map pixels tall instead of 34. Ragok's compact layout was affected as well; ordinary layout variants differed by smaller amounts. The party avatars use a separate contain-fit path and were already correct.

`createTraitSpriteCanvas` now measures the rendered idle body, including its clothing, headgear and outline. A detached measurement pass excludes weapons, wings, tails, horns, halos and hand glow so accessories cannot change stature. This updates only combat metadata, not avatar pixels, saved traits, seeds, palette, source images or 3D artwork. The map applies the same measured fraction for PCs, NPCs and monsters, restores it from cached textures after roster rebuilds, and uses an explicit texture-metric revision to avoid reusing stale calibration.

Humanoid and monster stature remains the existing authoritative value. Normal combat body height is `cellSize * 1.35 * stature.scale`; core compact races stay at 0.8, humans/elves at 1.0 and Mortacia retains her existing special path and approved animation. Monster stature persists when recruited. Camera, movement, collision, reach and turn rules are unchanged.

## Native Large Drawings

World billboards retain their assigned stature at every camera distance. The
old fit-to-camera shrink is disabled: close figures may extend beyond the
viewport, and only ordinary perspective makes them larger. Their existing
walking animation, roaming/viewing distances, approach behavior, collision and
combat reach are unchanged. This does not change combat-map sizing.

`createCombatSpriteSheetCanvas` retains the original sources for ordinary creatures and Mortacia. Creatures above 1.1 stature receive a larger, bounded drawing grid, built directly from their existing body-plan primitives and palette. This is not a `drawImage` enlargement of the small sprite: lines, ellipse contours and wing polygons are rasterized on the finer logical grid, outlines remain one logical cell wide, and native folds/seams/scales supplement the retained silhouette. Padding prevents heads, tails and other extremities from being clipped.

The source frame is square only for atlas storage. Its occupied silhouette controls visible width and height. Broad beasts, slender figures, spiders and other plans retain their own proportions; display uses one uniform scale, never independent axis stretching. Native source resolution is the same for all actor roles and remains bounded to 384 pixels per square frame, with at most eight frames. Ordinary avatars, character uniqueness fingerprints and 3D frame generators still use their existing sources.

For developer comparisons, `window.NATIVE_COMBAT_SPRITES=false` selects the original source drawings with corrected body calibration; its separate texture key makes the switch reversible without rerolling or changing a campaign. The standard path is enabled by default.

## Verification

- Unit tests independently measure rendered pixel bounds rather than only multiplying the implementation's scale and fraction together.
- Tests preserve avatar bytes, canonical Mortacia frames, stored stature, accessory-independent calibration, warm caches and role changes.
- Native tests cover seven body plans, supported feet/extremities, broad/slender proportions, larger logical bodies and output that differs from nearest-neighbor magnification.
- `node tests/run-combat-sprite-probe.cjs --software --party-sizing --native-large` replays the current six stored party trait specifications read-only, plus synthetic large body plans, through actual Phaser texture registration and RenderTexture drawing. It checks 144 party cases and 144 native large cases across PC/NPC/monster roles, both facings and all four frames. Animated silhouette changes are compared to independently measured source poses, not mistaken for a per-frame size change.
- Comparison galleries are written to ignored probe output: `logs/probes/combat-party-size-comparison.png` and `logs/probes/native-large-combat-sprites.png`.

The replay does not contact the live game server, mutate campaign state or request generated traits.

## Tactical Presentation

Exploration retains its normal camera zoom. Combat starts at 175%, with 125%,
150% and 175% buttons in the expanded map header, and restores the pre-combat
zoom when the encounter ends or resets. This changes camera projection only, not character
stature, maze positions, reach or movement allowances. Ground tiles, actor
centers and inverse pointer picking share the same half-cell alignment.

Blue/red outlines mark occupied cells; white marks the cursor or the hovered
actor's entire footprint. There is no green movement fill. All highlights remain
beneath the avatars. Physical size categories, not artwork scale or wings, define
shared footprints: ordinary/humanoid 1x1, large 2x2, huge 3x3, gargantuan 4x4.
An explicit `combatFootprint:{width,height}` can describe a rectangular body.
The existing maze coordinate is the footprint's northwestern cell; actor artwork
and movement animation are unchanged. Tactical paths, pursuit, withdrawal,
retreat and attack/strike range use the same occupied cells on the server.
Hover shows the character's name and a hand cursor. Clicking opens the familiar
character sheet, without attacking until its Attack/Move + Attack is chosen.
Legal empty squares still move; unavailable squares report why.

The expanded window uses the available width from a 96-screen-pixel (roughly
one-inch) left margin, stopping before the right-hand shortcuts. A read-only
combat ledger sits to the map's right. Turn actions live in character popups;
Hold Position ends the turn from the lower-left party/dice dock, beside Retreat
Party (which retains its free-attack warning). The map stays
above the lower controls, so dice remain clickable. On narrow screens it temporarily
hides the oversized console/log panels; their previous visibility returns at
combat end. No save layout is overwritten.

`node tests/run-combat-map-probe.cjs` replays the production map draw and pointer
handler in isolated Phaser WebGL; `--canvas` checks the game's Canvas path.
Both test all three camera zooms across four UI scales. Comparison images are
written under ignored `logs/probes/`, without accessing the live adventure.

## Saved Adventure Replay

`node tests/run-saved-combat-sizing-probe.cjs --software` reads Slot 1 and Slot 2
without loading them into the game. It merges the saved server/browser rosters
using the load path's sprite precedence, then replays each saved appearance as a
PC, NPC and monster, in both facings and all four frames. It also checks Suzerain's
preset. This covers the shared sizing path used by Mortacia, Suzerain and Party
starts; it does not generate or play through three new campaigns.

The October 15 check passed 600 Phaser render cases with identical role output,
no clipping and unchanged save-file hashes. Mortacia's calibrated body height
was 40.5 map pixels in both saves, versus 33.75 for normal human/elf stature and
27 for compact races. Her complete idle silhouette was about 50 pixels high
because sword and wings extend beyond the calibrated body. These are map pixels
before any browser/CSS display scaling, not the square texture's dimensions.

The JSON measurements and same-scale comparison galleries are ignored outputs:
`logs/probes/saved-combat-sizing.json`, `logs/probes/save-01-combat-sizing.png`
and `logs/probes/save-02-combat-sizing.png`. The older `--party-sizing` replay
requires its historical named party traits; use the saved-adventure replay when
those records are no longer available. No production sizing change was needed.
