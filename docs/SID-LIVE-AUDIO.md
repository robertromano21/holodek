# Live SID Audio

The updated game plays SID-generated music, dialogue, combat cries, ambience and
sound effects. Music, speech and ambience synthesize as they play. Short one-shot
effects are synthesized ahead from their SID registers into a browser-memory
cache for immediate triggering. Web Audio mixes, spatializes and limits the
output; no hidden prerecorded asset or non-SID voice layer is supplied.

- Music executes the archived PSID driver; existing enhanced music retains its
  explicitly documented companion controller.
- Dialogue compiles Piper analysis into a 64-chip `.sidvoice` register score.
  Piper samples are analysis only. Detailed speech avoids a final server render.
- Combat cries compile small three-chip SID register scores.
- Effects and ambience compile the existing `tools/sfx-build` design functions
  into `.sidregs` register scores, with one classic chip or two enhanced chips.
  The second chip uses the existing 10582 companion's register controller.

Short effects (up to eight seconds, one/two chips) are generated once by a shared
worker at the device sample rate. The cache holds at most 12 MiB / 64 mono buffers,
is keyed by clock/chip/name, and is cleared on clock/composition changes and load.
Footsteps are prepared first. Each trigger uses a lightweight AudioBufferSource,
not a fresh SID worker/worklet. These buffers are SID output frames in RAM, not
WAV files or downloaded recordings. The worker applies the same gain, clipping
and fades as streaming playback; tests check exact sample equality. Longer or
looping sounds retain the streaming path. A cache failure reports an error rather
than falling back to a recording.

Movement is checked each animation frame rather than at 100 ms intervals. The
first movement after standing still triggers a footstep, then distance controls
the cadence. Teleports and room changes reset that distance; footsteps delayed
more than 120 ms by cold preparation are discarded, not played after movement
has stopped. `HolodekSfx.effectsLog()` records preparation-to-scheduling latency
without printing every step to the console. This excludes device output latency.

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

Live players explicitly send `close` to their AudioWorklet before disconnecting.
The processor then returns `false`, releases its queued samples and closes the
synthesis port. Disconnecting alone previously left processors returning `true`,
so finished voices/effects could accumulate on the audio-render thread.
Worker failures use the same permanent shutdown path. Pause/seek remain resumable.

`HolodekSidPlayer.stats()` and `HolodekSfx.state().sid` expose active players,
opened/disposed/retired counts, queue depth, estimated buffered milliseconds,
underrun episodes, missing-audio time and the last processor update age. These
measure audio starvation separately from ordinary JavaScript heap usage; they
do not send audio or character speech to a remote service.

`node tools/audition-sid-voices.cjs --live` produces an audition page and paired
legacy/detailed voice register files in ignored `sid/voice-auditions/`. Open
`/sid/voice-auditions/index.html` and use Play SID/Pause/Stop for live playback.
The embedded audio controls remain explicitly labeled WAV comparisons. The page
embeds its current worker and player, so it does not require restarting a running
server merely to try these static auditions. Voice gain was not boosted.

`node tests/run-sid-effects-probe.cjs` checks cached SID effects, keyed ambience,
pitch automation, looping, independent gain controls and audition buttons. It
rejects any WAV/OGG request during these live tests. The separate voice/music
browser probes and unit tests check their corresponding paths. All probes use
isolated servers and browser profiles, without opening player saves.

The modified-VSID voice demonstration is documented in
[SID-VOICE-10582.md](SID-VOICE-10582.md). It is a private native 64-chip register
player, not stock-VICE support or a conventional 6502 PSID speech driver.
