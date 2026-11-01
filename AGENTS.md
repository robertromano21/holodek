# Agents working on Holodek

## Release Handoff
- Finish every implementation pass by updating the PowerShell/helper updater for the exact verified release, then provide its command so the user can test promptly.
- Updaters must reject changed or unverified source, coordinate all three website helpers, and leave PC server restarts to the user unless explicitly authorized. Leave gameServer2 untouched unless specifically requested.

## world1 features
- Flags off by default (`retort/worldFlags.js`). Never change live (port 3000, `holodek-1`) without backups, MD5 re-checks, `node --check` and the full test suite.
- Test copy: `holodek-1-world1-test`, pm2 `gameServer-world1-test`, port 3001. A visible test window needs the user's approval through the native dialog.
- Children of the Grave content (names, premades Mortacia/Suzerain, lore, the Grave Master name) stays in the CotG campaign. Homebrew and Campaign
  Builder worlds use their own bible, master prompt, generated classes and races, and GM name; `settingLayer` is the single routing point.
- Option 4 must never fall back to CotG. A failure along picker → prompt → master → instructions → creation → Start → first room is an explicit error.
- Docs: `tools/playtest/README.md`, `TESTING.md`, `docs/retort-call-map.md`.
