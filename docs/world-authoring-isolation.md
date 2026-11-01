# Original World Authoring

The audited new-world requests used the brief `coastal city state`, with fantasy/dark-fantasy weights and a city opening. Their quay names and maritime plots were returned by the model, not inserted from the offline sample bible. The legacy `GenerationFallback` log label also covers ordinary generation and validation retries; it does not mean that a stock campaign was substituted. Authoring diagnostics now explicitly report `authorship:model` and `contentFallback:false`.

## Context Isolation

The old setting context preferred the running game's bible over the builder draft. The transport's three-life rule could consequently append the old game's recovery explanation to a new-world request. A process-global draft also allowed simultaneous asynchronous work to share the wrong setting.

Authoring now uses async-local contexts. A fresh bible has an explicit neutral context, with no running-world lore or CotG persona. Master, roster, and instruction authoring use their supplied bible. Nested and concurrent drafts restore their caller's context without mutating the live world.

## No Content Substitution

Production endpoints supply a model runner. Missing runners are explicit errors for bible, master, roster, and nonempty instruction authoring. Offline demonstrations require `offline:true` or direct fixture APIs. Provider failures still fail explicitly; retries ask the model to repair its answer and never install a local sample campaign.

GM names accept an optional punctuated title up to 80 characters. The previous comma-free, 40-character restriction rejected otherwise valid authored titles and unnecessarily retried the complete master prompt.

## Name Variety

Successful drafts are remembered before the player starts them in a bounded 24-world authoring history. Local validation checks exact campaign, settlement, and GM-name reuse, plus recurring opening-settlement suffixes. The legacy recent-name file seeds these checks for existing players. No lists of old names or example replacement names are inserted into the prompt. Rejections ask the model for an original, coherent replacement; the engine does not generate or substitute names. Explicit player-provided names remain authoritative. A geographic word is not globally banned.

Existing saves, built rooms, and campaigns are not renamed or regenerated. No paid authoring request is needed for the regression suite. Tests exercise model responses and transport-boundary setting translation with fixtures; the next fresh live world remains the creative-quality test.

Release verification: `.retort-data/host-local-floors/verify.cjs`. The pinned updater checks the exact source and coordinates all three helpers. Server restarts remain with the user; `gameServer2` is untouched.
