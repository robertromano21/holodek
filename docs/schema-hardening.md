# Structured Authoring Contracts

Inhabitant generation requires exactly three nonblank authored remarks. Its
Retort schema now carries matching nested minItems/maxItems and string item
constraints. The game still validates the count and content after generation.
There is no added dialogue word or character limit. Correction requests state
the received count and require separate remarks, never padding, duplication or
splitting a sentence to manufacture missing content.

`generationContracts.request({ strictAnswer: true })` is an opt-in for critical
holodek-1 work, currently inhabitant generation. It propagates into bounded
localWork parts. The local response-format route must return final-channel JSON
matching the unrelaxed schema. It does not extract wrapped JSON, promote
reasoning, fill missing scalar fields, or round invalid numeric enum choices.
Legacy local callers retain existing compatibility handling; cloud models retain
their existing tool-call transport. Schema validity is not story coherence.

The adjacent audit aligns campaign trade items, recurring-cast counts/names and
dialogue cache array bounds with existing rules. Generation-only cast validation
preserves legacy saved-cast acceptance and feature flags. Cross-field spell
preferences remain governed by the existing spell engine. Their intentional
normalization policy needs a separate archetype-first authoring review, not a
blanket validator change. Cloud cache schemas bound the known per-speaker range;
they do not encode the complete dependent allocation or require every cache row.

Tests cover the complete Retort-to-PC wire path on initial and correction calls,
malformed arrays/items, authored long remarks, strict/legacy compatibility,
reasoning-only rejection, cloud compatibility, and adjacent schema contracts.
This staged patch does not deploy code, restart servers, retrain models or grant
standing permission for inference, deployment or paid API calls.
