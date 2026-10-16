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
grief, ash or Lanul should be claimed without actual transcripts and matched takes.
The clips are unclipped; occasional large sample steps in a conversation take
remain a signal warning, not proof that all consonants are natural.

## Local Whisper Measurements

`node tools/whisper-sid-voices.cjs` transcribes the existing three-character corpus
with the local whisper.cpp CLI. On Windows it defaults to
`C:/tools/whisper/whisper-cli.exe` and `ggml-base.en.bin` in that directory.
`--exe`, `--model`, `WHISPER_CLI`, `WHISPER_MODEL` and `WHISPER_HOME` override these
paths. No network service or API is used. `--manifest` selects another audition,
and `--character` / `--line` restrict the run. Recognition is sequential and uses
four CPU threads by default (`--threads` overrides this).

Each WAV runs in a fresh process with English, temperature zero, fixed beam/best-of
settings and temperature fallback disabled. No expected sentence, fantasy-name
prompt or constrained grammar is given to the recognizer: those would bias the
measurement toward the answer. A process/JSON failure is reported explicitly and
excluded from matched-set summaries, never substituted with a guessed transcript.

Reports are written to a unique ignored `.retort-data/voice-evaluations/` directory.
They retain the manifest, transcripts, word edits, raw ASR segments/tokens, logs,
CLI version, model/executable/WAV hashes, and per-variant differences from the
Piper reference for the same character/line/take. Explicit `--out` directories
must be empty to prevent stale results. Never pool transcripts from independently
generated takes, even if their character and sentence labels match. Older
manifests do not contain WAV hashes, so current hashes establish future provenance,
not proof that a clip has never been replaced since its original generation.

The `sourceRelative` error delta is SID errors minus Piper errors on matched sets.
It is a useful regression target, not a naturalness score or proof of information
loss at a particular stage. ASR can miss a clearly pronounced fantasy name, make
different spelling choices, or recognize one word better after resynthesis. Token
probabilities and ASR timestamps are not phoneme confidences or exact release
boundaries. A dictionary entry is not proven wrong merely because ASR misspells it.

For isolated experiments, `tools/audition-sid-voices.cjs` accepts `--out-dir` (an
empty directory) and `--character`. For example:

```powershell
node tools/audition-sid-voices.cjs --corpus --reference --character "Vessa Reedwake" --out-dir sid/voice-auditions/vessa-check
node tools/whisper-sid-voices.cjs --manifest sid/voice-auditions/vessa-check/manifest-corpus.json
```

Keep the current game and published auditions unchanged while measuring candidate
phonology, timing and consonant changes. Repeat across several source takes and
unseen conversational lines before promoting an experiment. Listen blind for
expression, identity, fatigue and pronunciation as well as scoring word clarity.
The production voice remains entirely SID-generated; Whisper is a test instrument,
not a speech layer, automatic replacement voice, or runtime dependency.

## Smoother Harmonic Driver Experiment

The 10582 fine-level registers were previously fed rounded 45-step harmonic
levels. Crossing a voice-count threshold also retriggered ADSR gates. An opt-in
`k.smoothLevels: true` driver keeps the harmonic gates open, controls silence with
zero level, and distributes unrounded amplitude over three 8-bit level registers
(765 summed increments). It does not introduce a new register, PCM/digi playback,
post-processing filter, altered pitch, or different character profile. Stock
8580 rendering and the explicit Original style remain unchanged.

This removes a specific stepping/retrigger mechanism, not every possible source
of vocoder buzz. The noise/consonant driver is unchanged. Male FOF grains remain
as before, including their own gates; the stable-level treatment applies to the
harmonic chips, not to those grains. Existing `/l/` mutes still apply.

```powershell
node tools/audition-sid-voices.cjs --corpus --reference --smooth --live --save-takes --out-dir sid/voice-auditions/smoothing-check
node tools/whisper-sid-voices.cjs --manifest sid/voice-auditions/smoothing-check/manifest-corpus.json
```

The new candidates are `continuous` (fine levels only) and `soft` (continuous
plus linear harmonic contrast and a slightly steeper voiced high-frequency tilt).
Both share the exact Piper take, identity, noise analysis and timing with `detail`.
Candidates are RMS-matched to `detail`, with a 0.9 peak ceiling; the manifest
reports any mismatch, gain, clipping and large sample steps. RMS matching is not
perceptual loudness matching. It may raise the unchanged consonants relative to
the softened body, so do not mistake fewer high harmonics for a universally better
voice or ignore increased transient steps. Neither candidate is promoted simply
because it scores well on Whisper or has fewer register transitions.

`--save-takes` stores diagnostic-only unquantized Piper analysis takes in the
ignored audition directory, including phone/syllable metadata and the source hash.
`--from-manifest <manifest>` reuses those exact takes instead of running stochastic
Piper again. It requires a new `--out-dir`; use the same `--corpus` / character
selection for a full replay. Source hashes are checked before analysis. The stored
audio is not put in the SID register score or used by game playback.

Phase/excitation and harmonic/noise balance are additional avenues if this
experiment does not address what listeners hear. Research supports investigating
those separately, rather than assuming that a blanket low-pass filter will solve
vocoder buzz: [harmonic/noise excitation](https://www.isca-archive.org/interspeech_2011/wen11_interspeech.html),
[phase randomness](https://www.isca-archive.org/interspeech_2014/degottex14b_interspeech.html).
These papers motivate hypotheses, not a claim that this SID experiment implements
their methods or has demonstrated their listening-test results.

## Listening-Selected Production Style

After the owner preferred Soft in live listening, Soft became the default 10582
voice style. The sound panel has Soft, Continuous levels and Original choices;
articulation remains an independent control. The style persists in browser audio
preferences and new save checkpoints, without changing character identities.
8580 ignores it, while retaining the preference for switching back to 10582.

Production and auditions share `retort/sidVoice/timbre.js`. Live speech uses fixed
gain compensation of 1.3 for Soft and 1.03 for Continuous, approximating the
matched audition levels without an extra full server render. This is not exact
per-sentence RMS matching; existing output limiting remains active. The legacy
WAV endpoint retains its peak-normalization policy. No source audio is mixed in.

Each request carries its style snapshot. Both caches include the effective style;
prefetch uses the selected default, unsupported styles fail explicitly, and
`X-Voice-Timbre` plus `/voice/status` report what was applied. Combat cries are
unchanged. `SIDVOICE_TIMBRE=original|continuous|soft` sets the server preference;
the browser's selection still takes precedence for its requests.

The listening choice is not an ASR victory: one nine-line matched batch had word
error rates of 23.6% for Piper, 30.9% for detail/Original, 29.3% for Continuous,
and 33.3% for Soft. Results are limited to that batch and recognizer. Future
articulation changes must target the gap to the same Piper take while preserving
the preferred timbre and checking unseen speech. Do not force ASR to the expected
sentence or equate fantasy-name spelling with pronunciation accuracy.

## Frozen-Source Clarity Experiments

`tools/experiment-sid-voices.cjs` separates three hypotheses while keeping Soft,
the 10582 register map, character profile, Piper samples, phone data, analysis,
pitch and timing policies fixed. Each candidate runs in its own worker so its
environment knobs cannot leak into another render:

- `release_bed`: reduce attenuation of the fixed high-frequency noise bed from
  11 to 7 dB inside measured stop-release windows. This tests release balance,
  not a new release detector or trigger timing.
- `transition_gaps`: disable both short and low-aperiodicity F0 gap bridging.
  This tests preserving measured unvoiced gaps, not every coarticulation cue.
- `noise_less` / `noise_more`: change noise-path gain from 0.45 to 0.36 / 0.54,
  leaving the harmonic driver and measured release windows unchanged.

All candidates share exact saved sources. WAV comparisons are RMS-matched to
Soft with a 0.9 peak ceiling; each manifest records any mismatch, sample steps,
clipping, profile, source hash, renderer hashes and the changed knobs. The paired
`.sidvoice` files replay the same SID register programs. These offline settings
do not modify game defaults or the running adventure.

```powershell
node tools/experiment-sid-voices.cjs --manifest sid/voice-auditions/smoothing-check/manifest-corpus.json --out sid/voice-auditions/clarity-check
node tools/whisper-sid-voices.cjs --manifest sid/voice-auditions/clarity-check/manifest.json
node tools/audition-sid-voices.cjs --holdout --sources-only --save-takes --reference --out-dir sid/voice-auditions/holdout-check
node tools/experiment-sid-voices.cjs --manifest sid/voice-auditions/holdout-check/manifest-corpus.json --out sid/voice-auditions/holdout-result --variants soft,noise_more
node tools/whisper-sid-voices.cjs --manifest sid/voice-auditions/holdout-result/manifest.json
```

The example candidate `noise_more` is not a recommendation. Select one factor
using the first corpus, then score that frozen candidate against Soft on the
three previously unused holdout sentences across all three identities. Do not
tune on the holdout, change the source take between candidates, or combine
factors to disguise a regression. Keep the same independent Whisper settings
and measure the Piper reference too. Small sets and one recognizer cannot prove
population-wide improvement or naturalness; blind listening remains required.

The first transition experiment exposed `SIDVOICE_GAP=0` being replaced by the
default through JavaScript's `||`. That configuration bug is fixed and covered
by a test; default behavior is unchanged. Use the corrected `clarity-r2-20261015`
batch, not the superseded `clarity-20261015` batch, for zero-gap conclusions.

### October 15 Measurement

The corrected development batch has nine frozen takes: three sentences across
Mortacia, Vessa and Orro (123 words). The holdout has three different sentences
across those same identities (114 words). It uses independently frozen sources,
identical renderer hashes and the same local Whisper base.en settings. No source
sentences or source hashes overlap. `holdout-selection.json` in the development
directory records the two independent candidates before holdout scoring; no
parameters were tuned or combined after that selection.

| Variant | Development Errors / WER | Holdout Errors / WER |
| --- | --- | --- |
| Piper reference | 29 / 23.6% | 16 / 14.0% |
| Soft baseline | 41 / 33.3% | 40 / 35.1% |
| Stronger release bed | 39 / 31.7% | Not selected |
| Preserve unvoiced gaps | 38 / 30.9% | 33 / 28.9% |
| Less noise | 45 / 36.6% | Not selected |
| More noise | 36 / 29.3% | 38 / 33.3% |

Preserved gaps are the strongest holdout candidate, not demonstrated Piper
parity: their net error gap to Piper is still 17 words. Holdout errors by identity
were Mortacia 6 -> 6, Vessa 23 -> 20, Orro 11 -> 7 versus Soft. The release-focused
holdout sentence did not improve (13 -> 14 errors); the transition and balance
sentences improved (19 -> 15 and 8 -> 4). There is no universal consonant fix.
On the original target line, preserved gaps recovered Mortacia's "grief", but
Vessa's "ash" regressed in ASR. Fantasy names remain unreliable even on Piper.

More noise has a small aggregate holdout benefit but worsens Mortacia from 6 to
10 errors. At matched RMS it also increases >0.2-amplitude sample steps from 52
to 114 on development and 1 to 2 on holdout. Preserved gaps reduce those counts
to 39 and 0. All tested SID clips are unclipped, have identical duration to their
corresponding baseline, and match RMS within 0.00001 dB. These step counts are
signal warnings, not a listening diagnosis of clicks or naturalness.

At scoring time no acoustic candidate was promoted automatically; the Soft
control still used existing gap bridging. Listen to the pure-SID buttons at
`/sid/voice-auditions/clarity-r2-20261015/index.html` and
`/sid/voice-auditions/clarity-holdout-20261015/index.html`. Reports, including
unbiased transcripts, provenance and word edits, are in ignored directories:

- Development: `.retort-data/voice-evaluations/2026-10-16T01-04-08-625Z-ec80dd5d/`.
- Holdout: `.retort-data/voice-evaluations/2026-10-16T01-06-30-366Z-f2209b09/`.

The UTC directory dates are October 16; the local run was October 15. This small
test motivates a listening comparison of preserved gaps, then a fresh validation
corpus if more tuning is needed, not repeated tuning on these holdout sentences.

### Selected Production Gap Policy

After the owner selected preserved gaps, the default 10582 Soft style adopted
`gapMin: 0, gapMax: 0`. Its harmonic softness, pitch, identity, noise gain, release
balance and gain compensation are unchanged. This preserves the analysis's
unvoiced gaps instead of bridging them; it does not add silence or rewrite phone
timing. Original and Continuous remain available with the previous bridging.
8580 rendering and combat cries remain unchanged.

The policy is passed per request through shared `timbre.js` controls, not by
mutating process environment variables. Production register compilation, legacy
WAV rendering and new auditions use the same controls. The voice renderer cache
version is bumped; restart the server and refresh the page when convenient to
use the updated defaults. No save data or character voice profile needs editing.

The experiment harness intentionally retains the pre-promotion Soft control,
records its baseline recipe, and still exposes `transition_gaps` as the winning
candidate. Existing static audition pages and measurement reports are unchanged.
New production Soft scores were checked against all 18 winning frozen scores
across both batches: the register programs match exactly after removing the
audition-only gain normalization. This confirms promotion fidelity, not new ASR
scores or Piper parity. Holdout WER remains 28.9% versus Piper's 14.0%.
