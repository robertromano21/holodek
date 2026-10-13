# Combat Sprite Sizing

The 2026-10-12 party replay exposed a shared combat-map calibration error, not a special PC scale. Benedict's saved High Elf stature is 1.0, but his compact `tiny` drawing layout reported only 52 source pixels of body height. The visible helmet, outline and feet occupy 72 pixels. Compensating for the smaller nominal measurement made him about 47 map pixels tall instead of 34. Ragok's compact layout was affected as well; ordinary layout variants differed by smaller amounts. The party avatars use a separate contain-fit path and were already correct.

`createTraitSpriteCanvas` now measures the rendered idle body, including its clothing, headgear and outline. A detached measurement pass excludes weapons, wings, tails, horns, halos and hand glow so accessories cannot change stature. This updates only combat metadata, not avatar pixels, saved traits, seeds, palette, source images or 3D artwork. The map applies the same measured fraction for PCs, NPCs and monsters, restores it from cached textures after roster rebuilds, and uses an explicit texture-metric revision to avoid reusing stale calibration.

Humanoid and monster stature remains the existing authoritative value. Normal combat body height is `cellSize * 1.35 * stature.scale`; core compact races stay at 0.8, humans/elves at 1.0 and Mortacia retains her existing special path and approved animation. Monster stature persists when recruited. Camera, movement, collision, reach and turn rules are unchanged.

## Native Large Drawings

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
