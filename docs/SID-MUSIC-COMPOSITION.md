# Room SID Composition

## Scope And Ownership

New rooms use `roomMusicComposer.js` -> `sidComposition.js` -> the version-3 path
in `sidMusicTheory.js`. Existing cached arrangements stay cached. New songs use
the normal two-slot WAV/ASM publishing path. Reference recordings are preserved
separately before a recovery replaces a live slot; campaign data and speech code
are not replaced. Speech now defaults to 10582, without changing voice identities
or overriding an explicitly saved 8580 selection.

The model composes the room motif, rhythmic cells, mode/key, tempo, instrument
palette, compatible harmonic paths, phrase template, movement selection,
development operations and orchestration arc. The arranger derives and voices
the musical material, supplies cadences, compiles patterns, and enforces the
common timing grid. This is AI composition with algorithmic arrangement, not
an assertion that the model wrote every note or the playback driver.

Development is an executable enum, never prose:
`transpose_up`, `transpose_down`, `invert`, `retrograde`,
`fragment_sequence`, `tail_answer`. A separate ordered `developmentPath` selects
successive developments of the original motif. Rationale and style labels are
descriptive metadata; they are not parsed into musical instructions.

## Reference Audit

Run `node tools/analyze-room-music.cjs` for a read-only WAV/ASM/JSON audit.
The reference examined on October 15, 2026 was **Names Before Judgment**:

| Measurement | Reference |
| --- | --- |
| Key / mode / nominal tempo | G# minor / 104 BPM |
| Form / duration | 264 bars / 609.23 seconds in the WAV |
| WAV | Mono PCM16, 44.1 kHz; RMS 0.1980; peak 0.6091; no clipped samples |
| Musical lengths | 4,224 sixteenth units in each voice |
| ASM lengths | 29,568 frames in each voice; event durations 7, 14, 28 frames |
| Unique patterns | Lead 154; bass 42; third voice 60; 256 globally |
| Third voice | 346 chord-shape events; 88 noise events |

The shared grid, recognizable cells, strong-beat chord anchoring, bounded voice
ranges, gate gap, delayed vibrato and chord/percussion sharing are strengths.
The primary room motif and the dedicated Mortacia movement both used the fixed
Mortacia contour. The old normalizer also probabilistically replaced valid AI
key, tempo and progression choices, and every room had the same movement order.
Those are concrete sources of sameness, not evidence that SID itself is narrow.

Reference SHA-256:

```text
WAV  004a0c4e16a03c4a60a7e93d88250e37d960e482360120f939fc54d9429e4ab1
ASM  bf335832a0533be888ba0c374d305b0060c0f25495cd132987119eae9ccb4d68
```

These are numerical and structural observations, not a claim of having listened
to the files or a guarantee of musical quality.

## Composition Research

SID has no single compositional formula. Rob Hubbard describes *Delta* as short
riffs and phrases requiring a specialized driver. The useful inference for this
game is to develop a small identity over a larger form rather than ask for a
long unrelated stream of notes. [Hubbard interview](https://www.karsmakers.nl/metal-e-zine/robb.htm)

Jeroen Tel describes classical training, electronic music and funk/slap bass
among his influences. His explanation of fitting multiple perceived instruments
into three channels underlines that orchestration and rhythmic role-sharing
matter alongside melody. That does not mean every track needs the same busy
accompaniment. [Tel interview](https://www.gamesart.de/gamesart-interview-jeroen-tel/),
[Tel on three-channel arranging](https://blog.de.playstation.com/?p=4937)

Martin Galway discusses combining different SID sounds for texture. Timbre is a
compositional resource, not a substitute for phrase development.
[Galway interview](https://remix64.com/interviews/interview-martin-galway.html)

Musical sentences use presentation, continuation and cadence; repetition,
fragmentation, sequences and changes of surface/harmonic rhythm help give a
phrase direction. Our `sentence`, `period` and `arch` enums are tracker templates
inspired by formal functions, not implementations of a complete classical theory.
[University of Puget Sound theory text](https://musictheory.pugetsound.edu/mt21c/SentenceStructure.html),
[Open Music Theory on phrase-level harmony](https://openmusictheory.github.io/harmonicAnalysis.html)

GoatTracker's original manual documents independent orders/patterns, ADSR,
wave/pitch tables, pulse and filter tables, vibrato, gate timing and hard restart.
These provide a concrete engineering benchmark: score structure, timbral
automation and articulation are distinct layers. Our player supports a smaller
subset; we should not expose nonexistent effects to the model.
[GoatTracker manual](https://github.com/leafo/goattracker2/blob/master/readme.txt)

## Ten-Minute Development

The supported movement forms include a single developed theme, room/reflection,
room/threat, alternative reflection/threat orderings and a pilgrimage form.
Movements get explicit motifs and modal choices, shared instruments, two-bar
prepared transitions, and a recognizable room-theme return.

`gradual_reveal`, `ebb_and_flow` and `long_journey` define different large-scale
orchestration paths: thinned foreground, clear full statement, counterpoint,
higher-register crest, space, and return. Quiet stages remove some lead bars,
thin the arpeggio, use a pedal bass and omit percussion; their rests still occupy
the same grid. Counterpoint stages re-anchor delayed imitation to the current
chord rather than copy dissonant strong beats blindly. A crest is register and
density, not the addition of unauthorized fourth/fifth voices.

## Validation And Logs

Retort supplies strict typed enums and numeric arrays. The acceptance checks
cover complete fields, mode/progression compatibility, exact bar sums, contour
shape, explicit executable operations, permitted textures/percussion, required
movement roles, final realized motif shape, range, equal voice durations, and
tracker memory limits. Recent raw and realized motif identities are checked
without treating a new key/title as a new composition. Rejected plans get a
bounded repair attempt and diagnostic; exhausted repairs fail visibly rather
than silently substitute a procedural song labeled as AI composition.

These are engineering heuristics for this arranger, not universal laws of good
music. They cannot prove beauty, originality across all music, or appropriate
emotional response. Human listening and contrasting reference comparisons remain
required, especially before claiming no quality regression.

Stepwise motifs do not require a large leap. Ambience levels accept the full
0..1 range, including quiet layers such as 0.1; browser playback preserves them.
The original logged plan for **The Leaving Threshold** is a regression fixture:
it must compile without changing its melody or substituting another song.

Accepted plans, actual form/analysis, motif/score hashes and read-only room/quest
context go to `logs/music/<run-and-room-hash>.json`. The compact server summary
uses `[SidComposition]`. Cached songs need not be regenerated to inspect new ones.

## Independent Audio Layers

The three-voice song stands alone; environmental ambience is a separate palette,
not a required missing musical part. Music and ambience retain independent
volume controls. With music playing, pitched ambience follows each movement's
key/mode and ambient events follow the shared bar grid. Version-3 scores use
`plan.themes` and its bar positions, including incoming-key transition bridges;
legacy cached scores retain their text-form reader. With music paused or its
volume off, ambience continues with organic, free-running timing. Turning off
ambience does not pause or alter the song. Existing user volume settings and
ambient sound assets are unchanged.

## Traditional / Extended Comparison

The sound-settings panel has an independent **Composition** selector:
`8580: traditional SID` or `10582: extended registers`. Voice chip defaults to
10582 and remains separately selectable. Existing volume and clock settings are
preserved. Both music variants are prepared in a worker from the SAME score,
not from two unrelated model calls. Selecting a variant preserves the current
playback time and pause state; the old track remains until the next is playable.
Late room/run/clock results are discarded. Music and effect workers are separate
so preparing a long song does not queue short sound effects behind it.

The initial extended implementation is deliberately additive: the proven dry
three-voice arrangement is retained, with a companion program driving the actual
local `sidVoice/jsid.js` 10582 core. It uses per-voice level/mute ($19-$1C),
fast burst envelopes ($1D-$1E), formant resonance ($1F-$23), and a notch on the
companion output ($24-$29). A 20 Hz DC blocker removes resonator bias. No external
reverb/EQ preset is being passed off as a new chip register. This is a custom
SOFTWARE chip, not a claim that a stock C64/PSID supports these registers.

New Retort plans select exact profile, motion, depth and transient enums. Profiles
are `reed_resonance`, `spectral_choir`, `glass_halo`, `ember_air`. Drumless scores
must choose transient `off`. Archived scores can audition a deterministic
patch-derived palette labelled `legacy-patch-translation`, never falsely labelled
as an AI-authored new choice. Melody, harmony, timing and score are unchanged.

Ambience and effects keep their existing recorded dry assets. The browser adds
a register-rendered companion from the original effect/stem designs; pitched
stems remain in A and follow the existing key/grid transposition. Old ambience
continues while new buffers load. Speech keeps its own separate chip choice.
Render failures retain the old/dry sound with an explicit panel/console warning.

Paired WAVs and bounded register-trace previews are cached under `sid/palettes`.
Cache identity includes the full score, run/room, clock, and renderer version;
traditional and extended buffers cannot collide. The cache retains eight music
pairs and 96 effect companions (busy files may remain until a later cleanup).
The traditional ASM remains stock-compatible; the 10582 companion is software
rendered and described by its `.10582.json` register trace, not a new native PSID
driver. Native export of an extended player is not implemented.

The first full comparison of **The Leaving Threshold** is 590.769 seconds in
both variants at 44.1 kHz, with no clipped PCM samples. The traditional variant
is byte-identical to the restored room WAV. The extended variant has an RMS
difference of 0.01203 (full-scale units), with the same negligible DC offset.
These measurements establish a real, bounded signal change, not an auditory
judgment of whether the extension sounds better.

## ASM Findings And Next Synthesis Work

The audit found two concrete compiler defects, corrected for newly emitted ASM:
the cutoff split was reversed (`$D415` needs the low THREE bits and `$D416` the
high EIGHT), and filter commands prematurely forced full volume during the
startup ramp. New version-3 scores also retain their actual cutoff instead of
the old arranger's extra quantization. Preserved reference files were not changed.
The [original memory-map reference](https://www.cubic.org/~doj/c64/mapping128.pdf)
documents the filter split.

Remaining limitations, deliberately not disguised as implemented features:

- The one-frame gate-off gap is not a complete configurable ADSR hard-restart
  protocol. True restart, legato and release policies need separate instrument
  contracts and hardware/emulator comparisons.
- Native tempo uses whole PAL frames per sixteenth, so nominal 104 BPM is about
  107.14 BPM and the reference native duration is 591.36 seconds, unlike the
  nominal-tempo WAV. Fractional tempo scheduling is a later, isolated player task.
- The enhanced browser WAV path is an oscillator-based JS renderer, not execution
  of the emitted 6502 player. Its filters/envelopes and instrument-command behavior
  are approximations. PCM analysis does not validate the native SID acoustics.
- The custom 10582 extends music/ambience/effects through the opt-in software
  companion described above. Its stock-register oscillator/filter behavior matches
  the 8580 core apart from configured mixer DC bias in the tested cases. Native
  extended ASM/PSID export and replacement of the dry oscillator renderer remain
  separate work; the original dry sound is intentionally preserved.
- Per-movement instrument commands carry ADSR and waveform, not a complete new
  PWM/filter automation program. Version 3 intentionally keeps the instrument
  palette shared across movements. General wave tables, pitch slides, expressive
  gate policies, ring/sync and instrument-role rotation are future synthesis work.
- Native assembly/binary execution and listening comparisons still need a real
  assembler and SID player; neither was installed in this environment. Tests emit
  and inspect ASM while stubbing only the external assembler invocation.

The order of further work should be listening/trace comparisons, instrument
automation with renderer parity, fractional timing, then more elaborate textures.
Keep each step independently auditionable against preserved references.

## Offline Verification

```powershell
node --test tests/sid-composition.test.cjs tests/sid-chip-compatibility.test.cjs tests/sid-reference-analysis.test.cjs tests/room-music-ui.test.cjs tests/room-music-ambience.test.cjs tests/sid-extended-palette.test.cjs
node tools/analyze-room-music.cjs
```

Tests exercise all phrase/texture choices, progression/mode pairs, keys, suite
forms, development/arcs, strict Retort schema conversion, rejection/retry,
reproducibility, legacy byte-identical scores, non-silent unclipped PCM previews,
ASM cutoff packing, chip compatibility and bounded reference tracing. They do
not make paid model calls or replace live game music.
