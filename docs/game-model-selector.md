# In-Game Model Selection

Open **Menu > Game Model**, choose an available non-reasoning model, then choose
**Use Model**. The next action uses it. An action already underway, including
its chained calls, keeps its previous model. Existing rooms, characters,
inventory, quests and saved memories are not regenerated. Images and voices
are separate systems and do not switch text models.

This is a shared-server game setting, not a separate setting per browser.
It survives page refreshes for the server's lifetime; a server restart returns
to **Original settings**. Restore that option at any time to return to the
original per-task GPT-4.1 Mini / GPT-4o Mini routing and environment overrides.
There is no silent automatic fallback to a different paid model.

## Compatibility and Availability

`retort/gameModels.js` contains a capability-reviewed catalog dated October 14,
2026. The menu intersects that catalog with the API key's `GET /v1/models`
results. It excludes unknown capabilities and models whose known shutdown date
has arrived. Account visibility is not a guarantee of quota, project permissions
or successful generation. Refresh List rechecks access, subject to a short
anti-flood cache. Failed checks do not change the active model or reveal secrets.
Adding future model names requires reviewing their endpoint, tool and reasoning
contracts; the model-list endpoint alone does not provide those capabilities.

The catalog includes GPT-6 Luna/Sol, GPT-5.6 Luna/Terra/Sol, GPT-5.5 and compatible
legacy GPT-4.1 / GPT-4o families. GPT-6 Astra and GPT-6.1 Sol are deliberately
excluded because they do not support the required non-reasoning mode.
See the [official model catalog](https://developers.openai.com/api/docs/models)
and the individual documentation URLs in `gameModels.js`.

`gameRetort.js` keeps Retort's prompt chaining, templates and message interface,
but replaces its generation transport per conversation. It does not modify
`node_modules` or globally patch the SDK. The adapter explicitly disables
reasoning where supported, omits application-imposed output-token caps, forces single schema
calls, validates required JSON fields/types/enums, propagates errors and enforces
an overall timeout including stalled streams. A failed optional model call no
longer poisons the remaining conversation's deterministic fallback narration.
Direct room and character JSON generators use the same model policy. The
original model audit remains a historical record of the unmodified dependency.

Output caps were disabled at the player's request after startup tile generation
hit its old 400-token hint. The original Retort adapter had ignored these hints.
Both streamed Retort calls and direct JSON helpers now omit `max_tokens` and
`max_completion_tokens`. Provider/model hard limits still exist; truncated JSON
is still rejected rather than applied. Request/stream timeouts are unchanged.

## Cost, Context and Persistence

### Grave Master Task Context

The modern-model branch adds a system-level backend protocol without rewriting
the original Grave Master prompt. The full original text, including its lore,
pantheon and personality, is passed unchanged as a system message. Nested room,
quest and helper conversations inherit that original text from their parent.
A separate system addendum supplies the confirmed PC and explains that subsequent
assistant-role prompts are backend work orders for the current task, not a request
to replay character selection or the whole introduction. The live console takes
priority over old startup character metadata. Original settings and the GPT-4.1
and GPT-4o selections keep their previous prompting path. There is no new room
rejection, automatic retry, live-room regeneration or gameplay-state reset.

Offline regressions: `node --test tests/grave-master-protocol.test.cjs`.

My starting recommendation is **GPT-6 Luna with reasoning off** for a low-cost
trial, compared against the original model on the same game tasks. This is an
engineering recommendation, not a measured claim that its prose beats 4.1.
Use **GPT-6 Sol with reasoning off** as a higher-cost quality comparison. Keep
the original setting available while comparing dialogue, lore fidelity, quest
facts, malformed-output frequency, latency and cost per successful action.
The code currently uses mostly **GPT-4.1 Mini**, not uniformly full GPT-4.1.

Official standard text prices on October 14, 2026, per million tokens:

| Model | Ordinary input | Cached input | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| GPT-6 Luna | $0.10 | $0.01 | $0.125 | $0.50 |
| GPT-4.1 Mini | $0.40 | $0.10 | No separate write premium | $1.60 |

[Luna pricing/context](https://developers.openai.com/api/docs/models/gpt-6-luna),
[4.1 Mini pricing/context](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
Prices are model/service dependent and exclude other game calls and services.
Luna prompts over 272K input tokens have higher rates for the entire request.

Luna's context is 1,050,000 tokens, including input and output. 4.1 Mini already
has about 1.05M context too: lower prices buy affordable use of more context,
not a sudden new order of magnitude in capacity. Do not fill a million tokens
on every action. A sensible experiment is 32K-64K of relevant narrative context,
then 100K-200K if retrieval/continuity tests justify it, reserving output space.
This change does not expand the game's history retrieval budgets automatically.
For example, the campaign-memory retriever currently caps its injected evidence
at 4,800 characters, independently of the model's context capacity.

Prompt caching is not permanent memory or free history. Supported models cache
matching prompt prefixes automatically. Keep fixed instructions/lore first and
changing console state, memories and commands last; changing earlier content or
tool definitions can lose the later cache match. GPT-5.6 and later use a 30-minute
minimum lifetime after the latest cache write/reuse, not indefinite storage;
cache reads remain billed and cache writes may carry a premium. Changing models
does not transfer a cache entry. Consult
[official prompt-caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching).

Retort currently resends the messages needed for a request. A future Responses
conversation can reduce transport bookkeeping, but even `previous_response_id`
still bills the earlier context used in the chain. See
[conversation-state billing](https://developers.openai.com/api/docs/guides/conversation-state).
Durable campaign truth must stay in our databases/journal and saved memories,
with relevant records retrieved into the prompt. An API cache expiring must
never erase progress. Prefix restructuring, larger history budgets, explicit
cache breakpoints and a Responses migration are separate measured follow-ups,
not silently bundled with the model picker.

## Verification

```powershell
node --test tests/game-models.test.cjs tests/retort-model-compatibility.test.cjs
node tests/run-dungeon-ui-probe.cjs --model-only
node tests/run-dungeon-ui-probe.cjs --model-only --narrow
```

These use fake account lists, synthetic model responses and isolated browser
fixtures. They do not call paid models, restart the real server or modify a
campaign. Live API/model quality acceptance still needs an isolated playtest.
