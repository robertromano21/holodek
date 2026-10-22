# Agent-answer mode: answerer instructions

Server: pm2 `gameServer-world1-test`, port 3001, started with `start-pm2.ps1 -Mode agent` (HOLODEK_MODEL_MODE=agent). No API key is used.

## Queue
`C:\Users\rober\Documents\holodek\holodek-1-world1-test\playtest-run\agent-queue\`

For each model call the server writes `<id>.req.json`, where id is zero-padded like `0007`:
```json
{ "id": 7, "hash": "...", "component": "pass | text | tool:<name> | inhabitants | book-cover | book-chapter | ...",
  "stream": true, "tool": null | { "name": "...", "parameters": { JSON schema } }, "validator": true|false,
  "messages": [ { "role": "system|user|assistant", "content": "..." } ] }
```
It then waits up to 10 min (`HOLODEK_AGENT_TIMEOUT_MS`) for `<id>.res.json`:
- Narrative/text calls (`tool` is null): `{ "content": "your reply text" }`
- Tool/contract calls (`tool` set): `{ "arguments": { ...object matching tool.parameters } }`

The outcome files the server writes:
- `<id>.done`: accepted.
- `<id>.err.json`: `{ "error": "..." }`. The real validator rejected the reply. The server renamed your file to `<id>.rejected-<ts>.json` and is still waiting, so fix the reply and write `<id>.res.json` again.
- `<id>.timeout`: no reply in time. The local mock answered instead.

Write the reply to `<id>.res.json.tmp` first, then rename it to `<id>.res.json`, so the server never reads a half-written file.

## Pre-check (parse only; the server runs the real validator)
```powershell
node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if(!('content' in j)&&!('arguments' in j)) throw Error('need content or arguments'); console.log('ok')" <id>.res.json.tmp
```

## Contract notes (keep it light and fast; retort was built for small models)
- Answer only the LAST user message, using the system and earlier messages as context. Use short, in-character, second-person prose.
- `pass` (main retort turn, streamed): plain narrative text, 2-5 sentences. Keep the console's own lines intact if the prompt asks for them, e.g. "Objects in Room:", "Exits:" or "Inventory:" lists. Never invent exits that aren't in the prompt.
- Tool calls: fill EVERY required property with the exact types, enums and lengths from `tool.parameters`. Common rejections:
  - inhabitants: exactly one row per slot (slot 0..max), `dialogue` = exactly 3 non-empty remarks of 24 words or fewer, `history` of 55 words or fewer.
  - campaign-atlas: `regions` must have exactly the number of rows requested, in the supplied order.
  - book-cover: no real-world authors or titles. Use "Anonymous" unless the prompt names a known in-world author.
- Setting: Children of the Grave (Tartarus to Hades, yellow-sky ash wastes; Mortacia, Suzerain). No real-world names (composers, artists, bands, game titles).
- Mechanical calls are answered locally and never reach the queue: retrieval/facts, campaign-atlas, campaign-cities, environment-intent, classify, colors, art/illustration/surface-art/puzzle, sid/music, sprite. Override the list with HOLODEK_AGENT_LOCAL (a regex).
- Every pair is logged to `playtest-run\model-calls.jsonl` (source "handwritten" means an agent reply).
