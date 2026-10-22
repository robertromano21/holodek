# Shared Retort Contracts

## Scope

This overlay is staged on top of schema-hardening, room-coordination and
holodek-chain-cleanup. It has not been installed into the live game, the active
gameServer2 test copy or any website worker. No inference or paid calls were
used for this overlay. The running test and its GPU are left alone.

The objective is first-pass validity, not a guarantee that a model or network
cannot fail. Fallbacks remain explicit diagnostics, not silently accepted model
answers. Validators and world-state checks are not weakened to manufacture a
clean run.

## Contracts And Recovery

- All callers of generationContracts.request share the recovery policy: the
  initial attempt plus at most three retries per recoverable generation unit.
  Nested operation scopes share that budget rather than multiplying attempts.
  Legacy per-call attempts hints no longer select a different limit.
- Refusals, cancellation, stale runs, permanent authorization/quota failures,
  unavailable providers and context-budget failures are not blindly retried.
  Inhabitant timeout retries use a fresh conversation for only the unaccepted
  batch, with the same shared budget. Previously accepted batches are retained.
- Local work can partition a capped multi-field response. A capped indivisible
  scalar stops rather than repeating the same oversized work. It remains a
  reported failure, not a fabricated answer.
- Typed validation errors carry precise JSON paths. Repair requests contain
  only invalid fields, their rejected values and compact identity anchors.
  Applying a repair cannot change accepted siblings or prototype properties.
  A malformed repair with extra keys cannot reinterpret those keys as edits to
  previously accepted fields. Unsupported/root-wide semantic errors still need
  whole-unit correction; this is not universal automatic semantic repair.
- Cloud providers retain tool calls; holodek-1 retains strict final JSON for
  bounded work. Reasoning is never promoted to final content by this overlay.

## Confirmed Historical Problems

The read-only Luna audit was checked against current source, not blindly applied
as a list of still-open bugs.

- Fresco-only aspectRatio was offered to mosaics. Artwork now has kind-specific
  variants. Mosaic-only attributes are absent from fresco/relief/inscription
  variants. The renderer and its validators are unchanged.
- Canonical figures/deities could receive mortal identity overrides. Variant
  schemas exclude those fields; local dependent choices offer only null where
  applicable. Ordinary figures use the engine's actual race/class/sex catalogs.
- Dialogue-cache schemas allowed remarks the semantic 20-word check rejected.
  Both now use the same definition, with indexed expected/actual word counts.
  Recovery authors just the bad remark, without truncating or replacing the
  accepted cache. This does NOT reintroduce a word limit on initial inhabitant
  greetings. Those still require three real, nonblank authored remarks.
- The shared nonblank pattern was a substring test. xAI documents whole-string
  pattern matching, under which that old pattern could restrict text to a
  single character. The replacement explicitly spans the surrounding text and
  behaves identically under both matching conventions, including multiline
  text. Whitespace-only answers remain invalid.
- Cache allocation is bounded per speaker, including the 64-line/32-character
  ceiling. Empty/partial cache responses remain compatible with existing callers;
  the schema does not require every speaker to receive a full cache.
- Compact character context now includes authoritative sex and explicit
  pronouns. Prompts forbid inferring these from names or sprites. This is better
  grounding, not proof that arbitrary narrative pronouns are semantically correct.
- Puzzle schemas now reflect seeded control counts, valid integer settings,
  label suffixes, options and engine collection limits. Glyphs use 7-by-7 binary
  rows. Readable clues are one-based chapters, not 0-2; modifiers are integers.
  Solvability, uniqueness and chapter-existence checks remain authoritative at
  compile time.
- The historical drumless/transient conflict is already constrained by the
  current compound orchestration choices. No duplicate fix was made. Realized
  melody repetition, cross-field coherence and musical quality still require
  semantic validation and an actual model pilot.

## Verification And Rollout Gates

Offline tests replay OpenAI-style tools, xAI-style tools and local final JSON.
They exercise initial success, success after each allowed retry, exhaustion,
malformed corrections, precise field preservation, unsafe path rejection,
permanent-failure classification and existing local work/checkpoint behavior.
These are deterministic fixtures, NOT evidence of live provider compatibility,
whole-room quality, lower latency or a clean native room build.

OpenAI documents nested anyOf in structured outputs, but root schemas remain
objects and optional fields use nullable required properties with strict objects.
See https://developers.openai.com/api/docs/guides/structured-outputs . Other
providers and fine-tuned model capability differences require their own pilot.
xAI documents anyOf and tool-schema support, plus its distinct full-string regex
semantics: https://docs.x.ai/developers/model-capabilities/text/structured-outputs .
No whole-model quality or live compatibility claim is inferred from fixtures or
from schema documentation alone.

Remaining migration includes legacy direct generation loops in levelSpec,
characterTraitSpec and retortWithUserInput (adjudication/object modifiers and
other non-contract requests). In particular, legacy background scenery retries
are not yet governed by this new per-unit model budget. State-conflict retries
are separate mechanical reconciliation, not model retries. Do not describe this
overlay as global elimination of retries/fallbacks or completed policy coverage.

Before deployment: reconcile source hashes with current root changes; run an
isolated provider pilot; verify a complete room and ordinary turns; assess
latency/cost; obtain restart approval; deploy a matching isolated engine to web
workers if distributed tests are authorized. Do not upgrade shared live workers
under an active session. Durable resume after process restart remains separate.

The unrestricted parallel full-suite check once exposed a 50ms dice-deadline
test's sensitivity to scheduling load. That unchanged test passed in isolation;
the final full-suite verification uses test-concurrency=4. No timing assertion
was removed or relaxed, and no dice implementation was changed.
