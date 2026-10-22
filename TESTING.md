# Testing

- Unit and integration: `node --test tests/` (Node 22+). The world1 features have their own runner: `node tests/world1-genres.test.cjs`
  (genre kits, lights, portals, ranged weapons and ammo, resource labels, multi-genre bibles, master prompt, GM persona, instructions,
  libraries, the CotG premade gate, world rosters, seeded variety, and the option-4 server-side path).
- Baseline: compare failures with a clean checkout. Pre-existing failures are listed in the world1 test log; any new failure blocks a deploy.
- Playtests: `tools/playtest/README.md` (mock by default, zero API calls; a native permission dialog before any session; port 3001 only).
- Feature flags (`retort/worldFlags.js`, env `HOLODEK_<FLAG>=1`): every world1 feature is off by default, and live turns a flag on only after its tests pass.
- Denylist: `retort/campaignBuilder.js` `COTG_TERMS` / `lint()`. Homebrew worlds lint bibles, master prompts, rosters and outgoing model requests,
  and log `[homebrew] ERROR` on any leak.
- Call map: `docs/retort-call-map.md`.
