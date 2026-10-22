# Coordinated Website Room Builds

The PC remains the authoritative game server. Three private website worker
processes bind OS-assigned loopback ports; the existing SSH connection transports
work orders and compressed, checksum-verified results. These are cooperating
workers, not four copies of the same model request or distributed model weights.

## First-Room Dependencies

`retortWithUserInput` still establishes campaign/quest context and accepted room
facts first: description/classification, objects, exits, inhabitants, and puzzles.
Those authoring steps retain their existing dependencies. Once population is
accepted, `websiteRoomPipeline` starts three independent website branches:

```text
PC: accepted room facts and population
                 |
        +--------+---------+
        |        |         |
    geometry   music   illustration
    textures   score   modern/retro PNG
    murals     SID
        |        |         |
        +--- validated join --- PC cache
```

The PC may continue its normal narrative while those branches run. Each consumer
waits for its own dependency rather than rebuilding it. Geometry, voxel dressing,
surface-art textures, room illustration rasterization, and SID compilation execute
on the website. Interactive rendering, player input, and ordinary narrative stay
on the PC. This does not yet parallelize every call inside population authoring.

## Scheduling And State

Only an acknowledged, visited room can queue its direct exit coordinates. Up to
three complete neighboring-room jobs run concurrently. Finishing one does not
queue a second ring. Existing, visited and ready coordinates are reused; entering
an unfinished room joins its existing job.

Each neighbor first authors population, then uses the same three asset branches.
Atomic private-listener reservations prevent simultaneous dispatches from all
choosing the first idle port. Each listener has one room-stage slot. Cloud model
requests have four slots across the pool, with at most three background slots;
foreground requests take priority. Ollama requests remain serialized through one
gateway on this CPU-only website. More ports do not accelerate a single inference.

`holodek-1` is the exception to website inference placement: it always uses the
model registered as `holodek-1` in the PC's Ollama. Registering its GGUF from a
local model folder is an Ollama installation step, not a website filesystem path.
The picker verifies the PC installation even when Website AI is enabled.
Website room stages send bounded model work orders back over their existing
verified SSH stream; the PC returns completions over authenticated SSH requests.
No public Ollama listener, reverse tunnel, copied model weights or website model
substitution is needed. PC inference is serialized, with foreground priority.
Luna and other cloud-model routing remain unchanged.

Run, restore, quest, model, connection and source-version fences reject stale work.
Three-way merges preserve player discoveries and reject conflicting room names,
city namespaces and routes. Workers cannot import player HP, inventory, turns,
party membership or quest progress. A room is ready only after geometry,
population, illustration, score and verified SID files have been installed.

## Installation And Monitoring

Website AI settings expose **Offload room construction to three website workers**.
Installation uploads an allowlisted, hashed engine generation and a minimal
locked dependency set. Native canvas is tested before activation. Node 22+ is
required; a private helper runtime can coexist with the website's system Node.
Provider credentials travel in verified SSH requests and worker memory, never in
the source bundle, command line, saved connection or PM2 environment.

From the helper account, inspect all three worker logs:

```sh
PM2_HOME="$HOME/.holodek-pm2" pm2 list
PM2_HOME="$HOME/.holodek-pm2" pm2 logs holodek-adjacent-worker
PM2_HOME="$HOME/.holodek-pm2" pm2 logs holodek-adjacent-worker-2
PM2_HOME="$HOME/.holodek-pm2" pm2 logs holodek-adjacent-worker-3
```

The PC logs `[WebsiteRoomChain]` stages and `[AdjacentRoomBuild]` coordinate jobs.
Website status reports private ports and per-listener queue counts. CPU work,
model inference and network transfer still take time; measure fresh first-room
builds before claiming an end-to-end speedup. Extra concurrency may encounter API
rate limits and pre-generating rooms can spend tokens on rooms never entered.

## Long-Running Model Jobs

Website model calls use an idempotent submit ticket and authenticated polling,
not a single long-lived SSH response. The existing browser task polling is
unchanged. Healthy polled cloud jobs are not cut off by the former 120-second
Retort deadline. Polls renew a liveness lease; a lost PC or explicit cancellation
aborts abandoned work. Completed answers are retained briefly in bounded worker
memory, never as provider credentials on disk. Network errors, provider failures
and restarts still fail explicitly rather than inventing fallback content.
