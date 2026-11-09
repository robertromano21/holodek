# Monster Equipment and Environmental Hazards

## Equipment

Room objects still roll their category **before** authoring: weapon, armor, shield and other each have an independent 25% chance. This is not a quota; existing saves are not retyped.

Ordinary materialized monsters now receive 1-3 distinct equipment slots each, including friendly and neutral residents. Hostiles always receive an offensive implement; their minimum loadout size considers the living mortal party's equipped slot count (maximum three). Mortacia remains excluded from that difficulty floor. Actual party item names, known modifiers and combat totals inform authoring. Legal item modifiers remain unchanged. Anatomy and setting guide the LLM's physical equipment descriptions; no new natural-attack system is invented.

Normal room populations and supplemental encounters use the same bounded item batches, with no room-wide four-item cap. Each item's owner, slot, type, description and exact modifiers persist. Stats are applied once after the entire loadout validates. Existing live/saved actors, scripted bosses and ambient crowd placeholders are not retroactively re-equipped.

## Hazards

The four original hazards remain: collapsing bridge, gas vent, unstable floor and ward stone. Fourteen additions are burning ground, flame spout, falling debris/avalanche, searing heat, freezing cold, lightning/electrical arcs, sinking ground, ice/deep snow, acid, boiling geyser, blinding fog/smoke, moving machinery, radiation and volatile fuel/gas leaks.

New non-starter rooms have required hazard quotas: at least one indoors, and a stable seeded count of two through five outdoors. Geometry first selects supported, safely placeable mechanics; a scoped LLM authoring step supplies every hazard's original name and complete description before room delivery. The starter room is exempt, including outdoor genre starts; private upper floors at the starter city's host coordinate are not the starter street. Existing authored literal dangers are preferred, while climate and genre constrain the available mechanics. Legacy compiled rooms keep their saved decisions, including zero hazards, and the older literal-evidence installer remains available for legacy/diagnostic content. No procedural room prose is generated. Hazards avoid protected fixtures, quest objects, secret-room rewards and exits; a safe bypass must remain.

New hazards use visible voxel patches, an entry d20 check, a lower-DC careful crossing, and damage on failure where applicable. Ice, sinking ground, machinery, falling debris and fog force a safe retreat on failure. Fog deals no damage. Applicable sources can be neutralized by a separate check. Falling debris and volatile leaks are one-shot events. Neutralization and spent events persist across saves/rebuilds.

The current hazard system is **exploration-only**, not a combat status engine. It does not implement ongoing exposure damage while standing still, hunger/thirst, persistent radiation sickness, EMP equipment shutdown or spell suppression. These effects must not be promised as implemented mechanics. Automatic rolls remain the default; the existing optional pause-on-roll setting is retained. Expansion does not add hazards retroactively to an already compiled room.

## Test and Activate

Use `node --test tests/monster-equipment.test.cjs tests/item-authoring.test.cjs tests/random-encounters.test.cjs tests/room-hazards.test.cjs` for focused offline tests. No model calls or live-save changes are needed.

After the exact release is verified, close and relaunch Holodek, then run `./tools/update-helpers.ps1`. The updater refuses a mismatched running engine, verifies local concurrency or all three website helpers, and never restarts either server. Leave gameServer2 untouched. Test with a newly constructed room to exercise new generation.
