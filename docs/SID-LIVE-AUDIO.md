# Live SID Audio

The updated game synthesizes music, dialogue, combat cries, ambience and sound
effects as they play. Web Audio still mixes, spatializes and limits the output;
it is not supplying a hidden prerecorded audio layer.

- Music executes the archived PSID driver; existing enhanced music retains its
  explicitly documented companion controller.
- Dialogue compiles Piper analysis into a 64-chip `.sidvoice` register score.
  Piper samples are analysis only. Detailed speech avoids a final server render.
- Combat cries compile small three-chip SID register scores.
- Effects and ambience compile the existing `tools/sfx-build` design functions
  into `.sidregs` register scores, with one classic chip or two enhanced chips.
  The second chip uses the existing 10582 companion's register controller.

`.sidvoice` (`HDKSV001`) and `.sidregs` (`HDKRG001`) are private register formats,
not conventional PSID files. The root SID Workshop accepts either for live
playback or optional WAV export. They contain no sampled instruments or speech.
No claim is made that register dumps compress arbitrary recordings efficiently.

All live sources use a synthesis worker connected directly to an AudioWorklet
with a bounded queue. Playback-rate automation keeps keyed drones, scheduled
drips/howls and slight room pitch variations working. Ambience loop restarts
retain oscillator/envelope/filter state instead of repeating the initial attack.
Volume controls, stereo placement, music ducking and transition fades remain.

Effects are served by `/audio/registers/:name.sidregs?chip=8580|10582&clock=1x|2x|4x`.
Library gains are calibrated offline in `retort/sidEffectsGains.json`; runtime
requests compile registers only. Run `node tools/calibrate-live-sid-effects.cjs`
after changing a preset. The preset functions are preserved, but the live JS
emulator is not guaranteed to sound byte-identical to the earlier reSIDfp/OGG
recordings. Listening remains necessary to judge the result.

Older WAV/OGG assets and explicit legacy render endpoints are retained for
compatibility, not silently used when a new live source fails. There is no
prerecorded fallback for the new effects path.

Saved games retain composition data, ambience choices, character identities and
audio preferences. Restart the updated server and refresh the browser before
loading: scores are reconstructed from that data and the current preset library,
not dependent on old WAV files. Only the current room needs reconstruction.
Existing saves are not rewritten by this migration.

## Auditions And Tests

`node tools/audition-sid-voices.cjs --live` produces an audition page and paired
legacy/detailed voice register files in ignored `sid/voice-auditions/`. Open
`/sid/voice-auditions/index.html` and use Play SID/Pause/Stop for live playback.
The embedded audio controls remain explicitly labeled WAV comparisons. The page
embeds its current worker and player, so it does not require restarting a running
server merely to try these static auditions. Voice gain was not boosted.

`node tests/run-sid-effects-probe.cjs` checks actual live effects, keyed ambience,
pitch automation, looping, independent gain controls and audition buttons. It
rejects any WAV/OGG request during these live tests. The separate voice/music
browser probes and unit tests check their corresponding paths. All probes use
isolated servers and browser profiles, without opening player saves.

The modified-VSID voice demonstration is documented in
[SID-VOICE-10582.md](SID-VOICE-10582.md). It is a private native 64-chip register
player, not stock-VICE support or a conventional 6502 PSID speech driver.
