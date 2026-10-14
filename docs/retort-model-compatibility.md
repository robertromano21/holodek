# Retort / GPT-6 Luna Compatibility Audit

Checked October 14, 2026. This is an audit, not a model migration. No active
models, API keys, dependency versions, live game data or server processes were
changed. Tests use synthetic responses and an offline HTTP transport.

Follow-up: the game now has an application-owned adapter and in-game model
selector. See [current model-switching behavior](game-model-selector.md).
The findings below describe the unmodified installed Retort dependency; they
remain covered by characterization tests, not the patched game transport.
The player subsequently requested the original uncapped-output behavior after
startup hit a previously ignored hint. The current adapter deliberately omits
application token caps; do not reinstate the historical budget proposal below
without reviewing all generation workloads.

## Verdict

Retort's prompt chaining can stay. Switching the model name alone is NOT safe.
The installed `retort-js@0.0.4` uses OpenAI Chat Completions, which GPT-6 Luna
supports, including function calling when `reasoning_effort` is explicitly
`none`. Luna defaults to `medium`, not `none`. The stock Retort adapter never
forwards that setting, even if added to conversation or generation settings.

The model does not need to know about Retort. Retort locally assembles messages
and consumes API results. Endpoint, request and result compatibility matter;
the model does not execute the Retort JavaScript. This does not guarantee that
future model or endpoint changes need no maintenance.

## Installed Contracts and Findings

| Surface | Finding |
| --- | --- |
| `node_modules/retort-js/dist/define-generation.js` | Merges generation settings and dispatches every non-Claude model to the OpenAI adapter. There is no runtime OpenAI-model allowlist. |
| `node_modules/retort-js/dist/openai-chat-completion.js` | Calls `chat.completions.create`, always streams and requests usage. Forwards model, temperature, topP and function parameters. Drops reasoning settings and `maxTokens`; `max_tokens` is hardcoded to `undefined`. |
| Structured generation | `parameters` becomes a forced single named function (usually `answer`), not strict JSON-schema output. Retort assembles its streamed arguments into `message.content`; `message.result` parses JSON. |
| Stream handling | Reads only the first tool call in a chunk. Does not inspect refusals or `finish_reason`; a refusal-only response becomes empty text, and truncated JSON fails only when parsed. |
| `node_modules/retort-js/dist/create-stream-cloner.js` | A generator error rejects its detached producer rather than its waiting consumers. A failed API request can leave generation waiting indefinitely or produce an unhandled rejection. The SDK's HTTP error alone is not sufficient recovery. |
| OpenAI SDK | Installed `openai@4.52.3` serializes new request fields and arbitrary model IDs in JavaScript. Offline tests confirm serialization, not live API acceptance or account access. An SDK upgrade alone cannot fix fields dropped earlier by Retort. |
| Game configuration | Many helpers explicitly assign `$.model = 'gpt-4.1-mini'`; others use `gpt-4o-mini`. A single environment variable does not switch the whole game. |
| Direct non-Retort callers | `retort/characterTraitSpec.js` and `retort/levelSpec.js` use JSON-mode Chat Completions with separate `HOLODEK_TRAIT_MODEL` / `HOLODEK_LEVEL_MODEL` settings. `classifyDungeon` in `retortWithUserInput.js` uses `OPENAI_MODEL`. Each needs its own compatible request settings. |

`OPENAI_MODEL=gpt-6-luna` currently affects the direct dungeon classifier only,
not the main narrator and all its helpers. Its request still sends temperature
without explicitly disabling reasoning. Do not use it as a migration shortcut.

The old Assistants/thread code is also present in `retortWithUserInput.js`.
Do not confuse those legacy helpers with Retort's Chat Completions transport,
or assume a model-name change migrates endpoints. Image generation is a
separate image-model request and is not a Luna text request.

## Smallest Safe Migration

1. Keep Retort's existing prompt/agent/message interface and engine validators.
   Introduce a version-controlled, application-owned transport seam, rather
   than editing `node_modules` or globally monkey-patching the OpenAI SDK.
2. At that seam, retain generation settings before Retort discards them. For
   Luna Chat Completions send `reasoning_effort: 'none'`, translate `maxTokens`
   to `max_completion_tokens`, and set `parallel_tool_calls: false` for Retort's
   single-result schema calls. Preserve the intended sampling settings for
   non-reasoning use. Unsupported reasoning/tool combinations must fail clearly.
   Re-evaluate the existing tiny 30-80 token budgets: they were not previously
   enforced, so enforcing them without representative tests could truncate
   responses that used to succeed.
3. Fix stream error propagation and enforce request/stream timeouts. Detect
   refusal, incomplete output, malformed JSON, unexpected tool calls and empty
   responses before passing results to game logic. Retort's stream-cloner error
   path must be addressed too, not just the underlying request generator.
4. Route Retort and direct JSON helpers through explicit per-workload config.
   Keep the existing defaults until an opt-in candidate passes testing. Preserve
   the current dependency lockfile and a working rollback configuration. An old
   model is only a temporary fallback while the provider still serves it.
5. Run paid smoke tests separately, with approval and isolated disposable game
   state: plain text, a real forced-schema request, JSON room generation, streamed
   usage, long-context narration, and malformed/incomplete-response handling.
   Confirm account availability and actual latency, usage and reasoning tokens.
6. Compare gameplay in an isolated campaign: character creation, room and
   inhabitant generation, first regional quest and boss-key verification,
   inventory transfers, combat narration, directed dialogue, memory and journal
   updates. Evaluate factual consistency and variety, not merely valid JSON.
   Do not retry a partially committed gameplay transaction as a new action.

No production transport shim or model switch was installed by this audit.
The test-only adaptation proves that the installed SDK can carry the proposed
fields and Retort can consume a compatible synthetic result. It does not prove
that Luna produces equivalent game content or accepts this account's requests.

## Offline Checks

```powershell
node --test tests/retort-model-compatibility.test.cjs
```

These execute the installed Retort modules in an isolated module graph and use
the real installed OpenAI SDK's serialization and SSE decoder. Only HTTP and
Retort console logging are substituted. No real API key is used and Retort
run-file logging is disabled. The stream-cloner rejection check is isolated in
a child process. Known-gap tests characterize the current adapter; update them
deliberately when implementing the migration, not as live-model acceptance tests.

## Retirement Risk and Sources

Official OpenAI documentation currently lists GPT-4.1 mini, GPT-4.1, GPT-4o mini
and GPT-4o for shutdown on January 14, 2027, recommending GPT-6 Luna. Pinning an
SDK or Retort package cannot keep a retired hosted model running. A maintained
transport boundary, migration tests and deprecation monitoring are the durable
safeguards. Recheck provider documentation before deploying a migration.

- [GPT-6 Luna model and reasoning/function-calling support](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [GPT-6 migration compatibility](https://developers.openai.com/api/docs/guides/latest-model#migration-quickstart)
- [Chat Completions request contract, token limits and reasoning settings](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [Model and endpoint deprecations](https://developers.openai.com/api/docs/deprecations)
