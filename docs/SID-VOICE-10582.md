# 10582 Speech: Identity and Articulation

## Output Contract

The 10582 is our custom emulated SID-derived chip, not a historical SID model.
Speech is generated live by a bank of 64 chips. Piper supplies analysis material
and phone timings only. Its samples are not played, streamed through digi
registers, or mixed under the synthesized voice. The server compiles a binary
register score; the browser's synthesis worker and AudioWorklet generate audio
as it plays, using the same chip code and transport as live music.

The private `.sidvoice` format (`HDKSV001`) contains tick-timed chip/register/value
writes, chip clocks, fade and gain settings. It contains no PCM or source audio.
It is not PSID, and a 64-chip voice cannot be labeled a conventional single-chip
SID file. Register changes are delta-coded; TEST resets and envelope strobes
remain explicit even when their value repeats. Parsing enforces duration, size,
timing and chip-index bounds. Caches have byte budgets as well as entry limits.

The updated client also uses small SID register scores for combat cries. The old
Web Audio oscillator renderer remains only in the explicitly offline legacy
`renderVoiceDemo` diagnostic; normal dialogue and combat do not call it.

This revision improves the driver and analysis, not the chip's register map.
It uses the existing level, mute and formant/noise-resonator extensions.

## Stable Characters

- Version 2 browser voice specs persist identity controls with the character.
- Existing version 1 identities keep their stored pitch, formant scale, rate,
  range, accent, breath and rasp. Additional detail is deterministic by name.
- The server preserves formant scales from 0.70 to 1.35, rather than squeezing
  them into 0.92 to 1.05. Pitch and expression still have explicit safety bounds.
- Warmth, brightness, pause habits, fine pitch detail and held-vowel vibrato
  survive transport. The vibrato clock that was accidentally commented out runs.
- Mood modulates character brightness and pauses instead of replacing them.
- Each browser speech POST carries its identity atomically. Prefetch timing and
  concurrent profile uploads cannot change that request's profile snapshot.
- Profile uploads include the PC, compare profile content, and retry failures.
- Saved custom audio settings and Mortacia's named voice remain supported.

## Multiresolution Analysis

The original 32 ms harmonic-envelope and pitch analysis remains unchanged. A
separate 8 ms Hann-window spectrum runs at every existing analysis hop, rather
than reusing alternate spectral frames. It measures short-window RMS and
high-frequency energy as well as a 128-bin log envelope. Noise energy is
compensated for the shorter window; stationary noise must not get louder just
because the analysis window changed.

After phone-boundary snapping, stress timing warps both tracks using identical
indices. Timed fricatives and measured stop releases select the short spectrum
with short edge crossfades. Vowels keep the harmonic path. Silence does not
generate synthetic burst events. The new spectra drive SID noise bands and the
10582's movable noise resonators; they are not an audio layer.

The detailed path finds release windows from source-analysis energy, avoiding
the legacy path's first synthesis pass used to estimate those windows. Legacy
articulation is retained for comparison. Both paths include the identity and
vibrato fixes, so "legacy" does not mean a byte-exact pre-revision build.

## Controls and Diagnostics

After restarting the game server and refreshing the browser, the audio panel
offers Voice articulation: detailed consonants or legacy comparison. Detail
defaults on for 10582. 8580 ignores the new descriptors. `SIDVOICE_DETAIL=0`
disables detail server-wide. Music and ambience composition are unaffected.

`GET/POST /voice/line.wav` remains compatible with old browser tabs. The updated
browser uses `POST /voice/line.sidvoice` with `speaker`, `text`, `profile`, `clock`,
`chip`, `notch` and `detail`. Text supports up to 2,000 characters per request,
instead of silently cutting normal long sentences at 400 characters.
`POST /voice/cry.sidvoice` supplies the SID combat vocalizations.

Detailed speech compiles without a full server-side chip render or WAV encoding.
It retains the same unscaled oscillator/filter output. A fixed voice gain and a
bounded live peak limiter replace full-sentence peak normalization, so loudness
need not be byte-identical to old WAVs. The legacy 10582 articulation comparison
still needs its original first-pass synthesis to locate burst edges; its final
playback is live. Piper inference and spectral analysis remain necessary.

One matched-take local test measured 1,781 ms for the old final SID render versus
199 ms to compile the score, with zero raw sample error on replay. Including
2,549 ms of analysis, server preparation was 4.33 versus 2.75 seconds. This is a
single-run measurement, not a promise for other machines or end-to-end startup:
network transfer, browser setup and client synthesis CPU are additional costs.
The register score can be larger than its WAV, so this is not a voice compression
claim. Run `node tools/benchmark-sid-voice.cjs` to repeat the comparison.

`GET /voice/status` reports effective registered identities and the last 20
compile/render timings and articulation summaries. Responses include `X-Voice-Articulation`
and `X-Voice-Transport`.
Rendered caches separate profile, chip, clock and articulation choice. Analysis
is reused between matched variants and bounded by 120 entries/60,000 frames;
no full PCM analysis takes are cached. Short spectra use Float32 storage.

## Auditions

Run `node tools/audition-sid-voices.cjs` to generate three matched-take pairs in
`sid/voice-auditions/`. Each character's variants use the same Piper waveform,
profile, timing and gain policy. The manifest records its source hash, effective
profile, signal measurements, articulation activity and timings. The examples
are test profiles, not changes to live adventure characters.

Open `/sid/voice-auditions/index.html` on the running game server to listen
without restarting or changing gameplay. `--4x` generates a separate 4x page.
Auditions use the same synthesis and PCM conversion policy as the game worker.

The initial six 2x files were unclipped and had no adjacent-sample steps larger
than 0.2 full scale. Detailed synthesis took approximately 1.4-2.1 seconds for
the 5-6 second examples, versus 3.1-4.3 seconds for legacy articulation on this
machine. These are signal/performance checks, not intelligibility scores or
proof of perceptual naturalness. No new ASR accuracy claim is made.

Listen for word identity, consonant harshness, fatigue, character differences
and expression. Only then add hardware features for demonstrated limitations,
such as smoother resonator transitions, better excitation or tract notches.
Do not make distinction depend on increased hiss or pitch extremes.

## Current Auditions

`node tools/audition-sid-voices.cjs --corpus --reference` renders hard words,
conversation and campaign names for three distinct identities. Each legacy/detail
pair shares one exact Piper take. The optional source reference is explicitly
non-SID and diagnostic only; it is never mixed into game speech.

Mortacia's requested base is now 205 Hz, with reduced breath/vibrato and a more
conversational pace. This is an artistic tuning, not a scientifically precise
age simulation. `--mortacia` produces a separately named page and 205 Hz clips.

## Live Replay And Native Demo

`node tools/export-sid-voice.cjs` creates a Mortacia register audition in ignored
`.retort-data/voice-scores/`. Optional arguments are speaker name and text. Open
the exported `.sidvoice` in the root SID Workshop to play it live or export WAV.
Switching the playback chip is supported; 8580 does not implement 10582 registers.

Build the isolated VSID using `tools/build-vice10582.ps1`, then run
`node tools/verify-sid-voice-vice.cjs <score.sidvoice>`. Its native 64-chip bank reads
that same register score. A silent PSID carrier supplies VSID's running machine;
it is explicitly not a 6502 speech driver. Without the score bank it records
silence. With the bank, native C++ oscillators/noise/filters generate the voice.
No WAV or source speech is read by VSID. Stock VICE remains untouched.

`tools/play-sid-voice-vice.ps1 -ShowWindow` plays the latest verified audition in
the modified VSID. The private bank is selected only by the child process's
`HOLODEK_SIDVOICE_SCORE` environment variable and model 10582. Native and browser
implementations are not bit-identical; the native demonstration is experimental.
Signal tests do not prove intelligibility or perceptual naturalness.

`node tests/run-live-sid-voice-probe.cjs` checks actual browser playback, complete
sentence scheduling, subtitles, bounded queues, cancellation and SID cries.
An optional score filename tests a real local Piper-derived take instead of the
synthetic fixture. It does not touch the running game or any save.

Piper model/config selection now stays local to each synthesis request, with
deduplicated model-loading promises. Concurrent LJ/Ryan requests cannot replace
one another's guide while awaiting phonemization.

`node tools/score-sid-voices.cjs manifest.json transcripts.json` scores externally
supplied human/ASR transcripts. It reports word edits and target-word hits,
compares only complete matched sets, and never guesses missing results. Fantasy
names also need phonetic/listener judgment. No new recognition scores for gods,
grief, ash or Lanul are claimed: Python/Whisper is not installed in this terminal.
The clips are unclipped; occasional large sample steps in a conversation take
remain a signal warning, not proof that all consonants are natural.
