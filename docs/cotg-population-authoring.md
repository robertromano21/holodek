# Children Of The Grave Population Authoring

CotG creature design starts from the original Tartarus race/class prompt. It
supports intelligent and unintelligent animals, monsters, spirits, souls,
dragons, angels, demons and stranger native beings, not a mandatory species
catalog or generic medieval population. Full campaign lore remains supplied by
the existing runtime; the compact local model keeps its established context
packing. Race and custom class fiction are LLM-authored, while combat archetypes,
stats, spells, dispositions, group sizes and placement stay engine-owned.

Each ordinary planned group independently receives one stable source choice:

- 65% unrestricted CotG authorship, without an ecology lineage or SRD race enum.
- 35% informed by a saved ecology or SRD reference, interpreted through CotG.

The 35% is a reference stage, not a post-generation replacement or a requirement
to copy a race name exactly. The existing ecology table's `originalPercent` and
city weights still choose between reference sources *within* that branch; they
do not control all CotG residents. Missing legacy ecology can use the SRD catalog
as reference data. No extra authoring/model call is added. Choices are made
before generation, shared across cohort members/batches and not rerolled on a
retry. Statistical proportions apply across ordinary groups, not as an exact
quota in every room.

Starter casts, service operators, bound quest contacts, scripted/boss casts and
saved planar identities retain their protections. Existing visible ambient
citizens keep their race and body when promoted into named characters. Existing
saved populations are reused, never regenerated or rebalanced. Supplemental
CotG groups use the same source split and persist the selected plan on the
installed encounter group. The `[InhabitantGeneration]` log reports
`cotgAuthorship`, including each group plan and any selected reference.

This is separate from the existing 60% Hostile / 20% Neutral / 20% Friendly
disposition roll. Difficulty, party-size scaling, safe-room exceptions, services,
quest seeding and encounter pacing do not change.

Genre games keep their existing world bible, ecology sampling, race validation,
name suggestions and population prompts. No CotG source plan is applied to them.
