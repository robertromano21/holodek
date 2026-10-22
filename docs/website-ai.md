# Website AI Worker

Menu > Website AI configures a dedicated non-root SSH worker. It starts disabled
on a fresh installation. Your server address, host pin and SSH identity live only
in `.retort-data/website-ai/`, which Git ignores. Never commit connection settings,
private keys, provider keys or PM2 environment dumps.

## Setup

The website needs Node 18+ (Node 22+ recommended), OpenSSH and PM2. Create a
dedicated account using the website's administrative terminal. Do not enable root
SSH or give the worker sudo access. Install PM2 for that account if necessary:

```sh
npm install --prefix "$HOME/.local" pm2
```

On the PC, select **Show / Create SSH Public Key**. Install that PUBLIC key in
the dedicated account's `~/.ssh/authorized_keys`, with these restrictions:

```text
no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 YOUR_PUBLIC_KEY holodek-website-worker
```

The account's `.ssh` directory must be mode 700 and `authorized_keys` mode 600,
both owned by that account. The key needs ordinary non-interactive shell access;
a forced `/bin/false` command or Ollama-only forwarding key cannot run this worker.

Read the website's host fingerprint from its trusted administrative terminal:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Enter the website IP/hostname, SSH port, dedicated username and this SHA256 pin.
Select **Install / Connect Worker**. Do not accept an unexpected changed pin.
Connection controls are accessible only through the PC's literal localhost URL.

## Routing And Work Order

- **Current-room generation** sends the selected model's existing Retort requests
  through the SSH worker, including the first-room build. Luna remains Luna via
  its API; xAI uses its API; self-hosted models use the website's own Ollama.
- **Adjacent preparation** begins only after the client has rendered the active
  room. It prepares descriptions for named, undescribed neighbors, including
  diagonal links and registered portals. Objects, actors, quests and geometry
  remain in the normal authoritative room-entry pipeline; this is not full-room
  pre-generation.
- The worker permits two simultaneous model jobs, at most one Ollama job.
  Waiting foreground work precedes waiting speculative work. Extra ports do not
  accelerate an individual model response or the PC's renderer.
- A model or connection change never silently substitutes a different model.
  Changing a connection during a generation action requires retrying that action.
  Disable Website AI to return foreground calls to the PC's normal provider path.

Provider keys come from the PC's existing environment or ignored `keys` directory.
They are transmitted through pinned SSH on stdin, held in remote memory for the
request, and used only with fixed provider HTTPS endpoints. They are not placed in
remote files, PM2 environment variables, command arguments or worker logs. Paid
API jobs still cost money. No public worker HTTP port is opened.

Installing stock `gpt-oss:20b` does not install the `holodek-1` fine-tune. Import its
own supplied GGUF/Modelfile into website Ollama under the exact name `holodek-1`
before selecting it there. Keep Ollama bound to loopback; never expose an
unauthenticated port 11434 to the internet.

## Monitoring

From the website terminal, switch to the dedicated worker account and run these
commands separately. The worker has its own PM2 namespace, not the default one:

```sh
su - holodek-agent
PM2_HOME="$HOME/.holodek-pm2" pm2 logs holodek-adjacent-worker --lines 30
```

`[WebsiteJob]` records show the provider, exact model, foreground/background
priority, phase and elapsed milliseconds. They never contain prompts, responses
or provider keys. Luna requests use the OpenAI API and are not listed among the
website's installed Ollama models. An idle worker is normal between requests.
For active-job counts and the last 32 completed/failed requests, use:

```sh
watch -n 2 'printf "%s\n" "{\"operation\":\"status\"}" | node "$HOME/.holodek-worker/worker.cjs"'
```

The PC logs `[RoomPrefetch]` when a displayed room is accepted or rejected. With
website background preparation enabled, `preparation: complete-rooms` starts
`[AdjacentRoomBuild]` jobs for its directly connected X/Y/Z coordinates. Only an
acknowledged, currently displayed room is marked visited and can enqueue work;
building an unvisited neighbor never queues another ring. Multiple exits to the
same coordinate reuse one database record and one job per adventure. Visited,
completed and hand-built rooms are not recreated.

One isolated PC worker orchestrates the existing room passes, with every model
request sent through the website using the selected model and background
priority. The website executes API calls (or its installed local model); it does
not combine VRAM with the PC. Geometry and procedural assets are built in the
isolated PC worker rather than blocking the live game-server event loop.

`checkpoint` stages are `population` (description, objects, residents, puzzle),
`geometry` (layout, textures, scenery, resident placement), and `music` (validated
score plus compiled SID archives). `ready` followed by `complete` means room art
is also saved. Art is still drawn procedurally, not through an image API. The
current party, inventory, turns and quest state are never imported from the worker.
Checked merges preserve independent player changes and reject conflicting world
edits. Model, quest, run or website changes cancel stale work. Saved checkpoints
include the prepared rooms; they are not an expiring description cache.

Entry logs `joined` when it waits for an existing build, then `used` when its
prepared state is projected into the active console. Valid geometry is reused,
not rebuilt. A failed job retains accepted checkpoints; normal entry resumes the
missing passes, without substituting another model, inventing a fallback song or
automatically repeating paid work indefinitely. Completed room state remains in
the database even after the bounded in-memory job history is trimmed.

Read-only progress on the PC:

```powershell
Invoke-RestMethod http://localhost:3000/room-build-status | ConvertTo-Json -Depth 5
```

Legacy explicitly configured Ollama description-only prefetch still reports
`[AdjacentRooms]`; those records do not mean complete room construction.

## Process Safety And Recovery

The dedicated worker uses `$HOME/.holodek-worker/worker.cjs`, a private runtime
registry and an OS-assigned free loopback port. It uses an isolated PM2 namespace
at `$HOME/.holodek-pm2` and owns only `holodek-adjacent-worker`. Existing websites,
ports and PM2 processes are not stopped or renamed. A same-name process with a
different script or working directory is an explicit error, not taken over.

The PC verifies and reconnects its saved worker on game-server startup and before
the first generation after reconnecting. PM2 saves this worker's list; independent
website reboot startup requires your administrator's normal PM2/systemd setup.
The PC reconnect can also start it after a website reboot.

Read-only status and explicit deployment commands from the repository:

```powershell
node tools/website-worker/connect.cjs status
node tools/website-worker/connect.cjs connect
node tools/website-worker/connect.cjs deploy
```

`deploy` verifies and installs the bundle without changing the saved switches.
`activate` additionally enables current-room routing and adjacent preparation;
use it only when intentionally enabling website work. Source updates back up the
old worker and restart only the owned process, refusing an update while jobs run.
