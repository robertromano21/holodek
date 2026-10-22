# Connecting your coding assistant through a dev-bridge folder

This is development tooling only. Nothing here is game content and nothing here ships.

## Pattern
1. Create a share folder, ideally OUTSIDE the game folder (e.g. `../agent-share/`).
   If you must keep it inside the repo, use one of the names already in `.gitignore`:
   `agent-share/`, `.agent-bridge/`, `dev-bridge/` (or any `*.agent-status.md` file).
2. Put these files in it:
   - `PROGRESS.md` - append-only log. First line: `Last updated: <date time> <zone>`. One entry per finished step:
     what changed, which copy (live or test port), backup file names (`<file>.bak-<timestamp>`), test result.
   - `STATUS.md` - current state of any long-running job (fixed fields at the top, then latest status).
   - `diffs/<date>-<name>.diff` - one unified diff per applied change.
3. Your assistants read and write only that folder to coordinate; they never commit it.

## Rules that keep it safe
- Back up every changed file as `<file>.bak-<timestamp>` and run `node --check` on changed JS.
- Never write API keys or other secrets into the share folder.
- Prefer the test server copy; touch the live copy only on explicit request.
- Re-read a shared file right before appending; never overwrite another writer's entries.
