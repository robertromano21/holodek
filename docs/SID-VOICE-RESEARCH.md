# Speech-naturalness cheat sheet (for the 64-SID voice)

## Source-filter and formant synthesis
- **Source-filter theory.** Speech = glottal source × vocal-tract transfer × lip radiation. Formants are the tract resonances. Fant, *Acoustic Theory of Speech Production* (Mouton, 1960).
- **Klatt 1980, cascade/parallel formant synthesizer.**
  - Klatt, D. H. (1980), "Software for a cascade/parallel formant synthesizer", JASA 67(3), 971–995.
  - Cascade F1–F5 for vowels; parallel branches with their own amplitudes for fricatives/bursts.
  - Update every 5 ms. Bandwidths matter as much as frequencies.
  - Voicing, aspiration and frication are separate sources that are mixed together.
- **Holmes parallel synthesizer.** A carefully controlled parallel bank can be as natural as cascade and handles consonants better. Holmes, J. N. (1983), "Formant synthesizers: cascade or parallel?", Speech Communication 2(4), 251–273.
  - → Our harmonic and noise SID banks are a parallel design.
- **KlattGrid.** Praat's implementation of Klatt-style synthesis: Boersma, P. & Weenink, D., *Praat: doing phonetics by computer* (software).
- **Voice quality.** Klatt & Klatt (1990), "Analysis, synthesis, and perception of voice quality variations among female and male talkers", JASA 87(2), 820–857.
  - Breathiness = aspiration noise mixed into voicing + weaker high harmonics + stronger H1.
  - Female voices are breathier, with a steeper spectral tilt.
- **LF glottal model.** Fant, Liljencrants & Lin (1985), "A four-parameter model of glottal flow", STL-QPSR 26(4), 1–13.
  - The glottal pulse shape sets the spectral tilt (about −12 dB/oct source).
  - A sharp closure gives bright, pressed voice; a gradual one gives soft, breathy voice.
  - → Use a per-harmonic tilt, not one fixed waveform.

## Prosody and durations
- **MITalk / Klatt duration rules.**
  - Allen, Hunnicutt & Klatt (1987), *From Text to Speech: The MITalk System*, Cambridge UP.
  - Klatt (1979), "Synthesis by rule of segmental durations in English sentences", in Lindblom & Öhman (eds.), *Frontiers of Speech Communication Research*.
  - Phrase-final lengthening; stressed vowels are longer; vowels are shorter before voiceless consonants; consonant clusters are compressed.
- **Fujisaki F0 model.** F0 = phrase commands (slow declination) + accent commands (local humps), both critically damped. Fujisaki & Hirose (1984), J. Acoust. Soc. Jpn (E) 5(4), 233–242.
- **ToBI.** Pitch accents (H*, L+H*) and boundary tones (L-L%, H-H%) describe English intonation. Silverman et al. (1992), "ToBI: a standard for labeling English prosody", Proc. ICSLP.

## Coarticulation
- **Stop place and formant transitions.** Stop place is cued by F2/F3 transitions toward a "locus". Delattre, Liberman & Cooper (1955), "Acoustic loci and transitional cues for consonants", JASA 27(4), 769–773.
- **Locus equations.** F2 at onset = k·F2 of the vowel + c, linear for each place of articulation. Sussman, McCaffrey & Matthews (1991), JASA 90(3), 1309–1325.
  - → b/d/g need fast (≤5 ms) F2/F3 transitions and the matching burst spectrum: labial = low and diffuse, alveolar = high, velar = a compact mid peak.

## What neural TTS says matters
- **Prosody comes from the acoustic model, not the vocoder.**
  - Tacotron 2: Shen et al. (2018), "Natural TTS synthesis by conditioning WaveNet on mel spectrogram predictions", ICASSP.
  - FastSpeech 2: Ren et al. (2021), ICLR. Explicit duration, pitch and energy predictors are its main quality gain.
  - VITS: Kim, Kong & Son (2021), ICML. Stochastic duration predictor; natural rhythm variation.
- **Smooth trajectories and phase coherence are the vocoder's job.**
  - WaveNet: van den Oord et al. (2016), arXiv:1609.03499.
  - HiFi-GAN: Kong, Kim & Bae (2020), NeurIPS. Periodic structure + multi-period discrimination, i.e. harmonic phase coherence.
  - LPCNet: Valin & Skoglund (2019), ICASSP. Spectral envelope by LPC, with the excitation modelled separately.
- **Aperiodicity bands.** Classic vocoders sound buzzy unless band aperiodicity is modelled.
  - WORLD: Morise, Yokomori & Ozawa (2016), IEICE Trans. Inf. & Syst. E99-D(7), 1877–1884.
  - STRAIGHT: Kawahara, Masuda-Katsuse & de Cheveigné (1999), Speech Communication 27(3–4), 187–207.
- **Harmonic plus noise and sinusoidal models.**
  - Harmonic plus noise: Stylianou (2001), IEEE Trans. Speech Audio Proc. 9(1), 21–29.
  - Sinusoidal: McAulay & Quatieri (1986), IEEE TASSP 34(4), 744–754.
  - Harmonics at k·f0 with envelope amplitudes and phase coherence, plus noise shaped by aperiodicity above a maximum voiced frequency.
- **Jitter and shimmer.** A small amount (~0.5–1% jitter, ~3% shimmer) removes the "machine" sound; much more sounds pathological.

## Data and tools
- **Corpora.**
  - LJ Speech: Ito & Johnson (2017), keithito.com/LJ-Speech-Dataset, public domain.
  - CMU ARCTIC: Kominek & Black (2004), ISCA SSW5.
- **Parselmouth** (Praat in Python): Jadoul, Thompson & de Boer (2018), Journal of Phonetics 71, 1–15.
- **Praat pitch.** Boersma (1993), "Accurate short-term analysis of the fundamental frequency and the harmonics-to-noise ratio of a sampled sound", IFA Proceedings 17, 97–110.

## Applied in v2 (64-SID vocoder, `sid/voc64.js` + `voc/analyze.py`)
1. **Data-driven prosody, durations and spectra (biggest win).**
   - Text → Piper (VITS-based) TTS with the public-domain LJ Speech voice → Praat F0 (2.5 ms) + harmonic-peak envelope + 13-band aperiodicity.
   - This track drives the SIDs. The neural audio itself is never played; it is only analysed.
2. **Harmonic plus noise on SID.**
   - 44 phase-coherent triangle harmonics (all chips start together at phase 0, frequency registers written in the same tick), so they act as one glottal pulse train.
   - 13 LFSR noise bands through the SID band-pass filter, levels set by aperiodicity. This covers breathiness, aspiration and frication.
3. **Above the 3.85 kHz oscillator limit.** 6 saw oscillators at about bf/2, a true harmonic of f0. The SID band-pass picks their 2nd partial at 4.2–8.2 kHz, giving coherent F4/F5 energy.
4. **Smooth amplitude.**
   - Each chip stacks its 3 voices at the same frequency and phase: 0–3 voices gated × 4-bit volume gives 45 levels.
   - Gating uses the SID ADSR (2 ms attack, 6 ms release).
   - Volume slew ≤4 steps per 2.5 ms tick; silent chips keep their frequency and volume so release tails never jump.
5. **Registers at 400 Hz** (2.5 ms) instead of 160 Hz, so stops and bursts get proper transitions, as the Klatt 5 ms rule requires.
6. **Characters.**
   - F0 shifted to the character's median and range scaled (Fujisaki-style contour kept).
   - Formant warp α (male 0.84 × character fs).
   - Breath adds aperiodicity, as Klatt & Klatt describe; rasp drives a sub-octave chip.
   - Jitter 0.4% and shimmer 3%; per-character tempo through Piper's length_scale.

## Results (16 lines: 6 demo + 10 held-out; Whisper small.en / base.en)
| | v1 rule-based 64SID | v2 SID vocoder |
|---|---|---|
| Neutral (Narrator) | 47% / 42% | 78% / 68% (demo 6: 83% small) |
| Characters | 36% / 38% | 75% / 69% |
| Click detector, chars / neutral | 94 / 134 | 44 / 52 |
| CPU, Node, s per audio s | 0.015 | 0.12–0.15 |

- Piper source audio (the ceiling): 94% small.en.
- Whisper varies about ±7% between parameter tweaks.

## In-game integration (holodek-1)
- **Server:** `retort/sidVoice/` (worker thread). Piper runs through `onnxruntime-node` with the `phonemizer` espeak-ng WASM, then a JS analysis (`analyse.js`), then the 64-SID render (`voc64.js` + `jsid.js`), then a WAV for each sentence, cached in memory.
- **Synthesis starts when dialogue is created:** `broadcast(character_dialogue)` and the turn responses call `SidVoice.prefetch`. The Piper model is warmed at server start.
- **Profiles are sent on room entry:** the client posts `/voice/profiles` with each actor's voice mapping (pitch, formant shift, breath, rasp, range, speed).
- **Client:** `sfx.js` `speakLine` plays each sentence gaplessly through the stereo panner (speaker position), with ducking, the Effects slider and mute. `dungeonLifeUi.js` holds each subtitle until its speech has finished.
- **Model:** `models/piper/en_US-ljspeech-high.onnx` (+ `.json`), from huggingface.co/rhasspy/piper-voices. LJ Speech data is public domain; Piper is MIT. `HOLODEK_PIPER_MODEL` overrides the path.
- **Licences:** onnxruntime-node is MIT. phonemizer (npm) is Apache-2.0 and bundles espeak-ng compiled to WASM; espeak-ng itself is GPL-3.0.
- **Status:** `GET /voice/status`.

## Enhanced SID mode (non-stock clock) - optional, off by default

**Honest label: this is not a stock C64.** A real PAL SID is clocked at 985,248 Hz. With 16-bit frequency registers, that puts the oscillator ceiling at about 3.9 kHz, so the stock layout can only place true harmonics below about 3.84 kHz. "Enhanced" is the same emulated chip clocked at 2x PAL (1,970,496 Hz). The waveforms, 23-bit noise LFSR, ADSR, filter and register map are unchanged.
- Oscillators reach about 7.8 kHz (the same 16-bit registers, each step is twice as many Hz).
- The filter cutoff curve is unchanged at low register values, and its top end opens linearly up to 2x: `Hz = cutHz(reg) * (1 + reg/2047)`.
- Enhanced renders at 44.1 kHz so the extra range is not aliased. Stock renders at 22.05 kHz.
- Overclocked SIDs exist only as a hardware mod. reSIDfp/sidplayfp only emulate stock PAL/NTSC clocks, so enhanced audio is produced by the project's own `jsid` emulator.

**Switch.** The ♫ panel has a "SID chip: Stock (1 MHz) / Enhanced (2 MHz)" control. It is saved in localStorage, sent with POST `/sid-mode`, and stored server-side in `sid/sid-mode.json`. The `SIDVOICE_CLOCK=stock|enhanced` environment variable sets the server default and overrides the saved file. One mode covers all SID sound: voices, music renders, ambience and effects.

**Voices (enhanced layout).**
- Chips 2-45 play harmonics 1..44 up to 7.68 kHz. A female or high voice now has real harmonics all the way to about 7.7 kHz.
- Chips 46-51 fill any harmonics above 44*f0 for low voices. Each one is a pitch-locked true harmonic, re-chosen only on large pitch moves (pass-4 stability rules), and stands in for its neighbours (power-scaled).
- The upper noise bands are halved (gain 3 instead of 6), because voiced high frequencies now come from harmonics rather than noise. Unvoiced sibilants still use the noise LFSR bands, as in real speech.
- The voice cache key includes the mode.

**Measured (16 lab lines, Whisper small.en; Piper is the reference):**

| | Piper | Stock | Enhanced |
|---|---|---|---|
| Intelligibility | - | 75% | 75% |
| Energy 4-10 kHz | -9.6 dB | -19.1 dB | -16.3 dB |
| Spectral tilt (dB/oct) | -5.6 | -6.8 | -5.8 |
| Peakiness 4-10 kHz | 13.7 dB | 10.8 dB | 11.6 dB |
| Clicks | - | 25 | 9 |
| Dropouts per s | 0.39 | 0.27 | 0.50 |
| Render cost (s per audio s) | - | 0.13 | 0.29 |

**Music.** sidplayfp cannot run an overclocked chip, so enhanced music always uses the JS renderer.
- The JS renderer runs at 44.1 kHz with a 7.8 kHz oscillator ceiling, and the filter top opens up to 2x.
- The WAV is twice the size of a stock render.
- Room slots remember their mode, so a song rendered in the other mode is re-rendered instead of reused.

**Effects/ambience.** `tools/sfx-build` with `SFX_CLOCK=enhanced` renders the same register-dump designs through `jsid` at 2x clock and 44.1 kHz into `assets/sfx-enh/`. Each file is loudness-matched to its stock counterpart. jsid gained hard sync and ring modulation for this. The stock set remains the reSIDfp 6581 recordings, so part of the audible difference is the emulator (no 6581 filter distortion) rather than the clock.

### 4x clock (3.94 MHz) and harmonic phase dispersion (also non-stock)

The modes are now `1x` (stock), `2x` and `4x`. The legacy names `stock` and `enhanced` still work and map to 1x and 2x, both in `SIDVOICE_CLOCK` and in `sid/sid-mode.json`.

**4x clock.**
- Oscillators reach about 15.6 kHz. Renders are 44.1 kHz, so the Nyquist limit is 22.05 kHz.
- Filter cutoffs above the stock range open up to 4x at the top, capped at 0.3 x the sample rate for the emulator's filter stability.
- Voices: Piper's source audio is 22.05 kHz, so speech has no content above about 11 kHz. The 4x voice harmonic ceiling is therefore 10.5 kHz. Chips 46-51 fill the harmonics between 44*f0 and that ceiling.
- Effects and ambience: the 4x set lives in `assets/sfx-4x/`, built with `SFX_CLOCK=4x`.

**Fix for every mode.** The harmonic chips all started at the same oscillator phase, so the 44 harmonics summed into a sharp pulse train. On low voices this read as flutter and dropouts, the "bad cell connection" sound.
- Each chip now idles at its own frequency before the first voiced sound, which spreads the starting phases.
- From then on each chip stays exactly locked to k*f0, so pitch remains coherent.
- Harmonics also fade over the top 15% below the ceiling, instead of switching off when they cross it.
- Unvoiced gaps of up to 40 ms are bridged.

**Measured (16 lines, Whisper small.en):**

| | Piper | 1x | 2x | 4x |
|---|---|---|---|---|
| Intelligibility | - | 79% | 73% | 76% |
| Energy 4-10 kHz | -9.8 dB | -19.1 dB | -16.2 dB | -15.7 dB |
| Dropouts per s | 0.40 | 0.06 | 0.04 | 0.08 |
| Clicks | - | 20 | 3 | 6 |

## Articulation pass + SID "digi" layer (Oct 2026, cache VERSION 14)

> **Status (cache VERSION 15): the digi layer is experimental, OFF and not used.** Digi plays the recorded Piper waveform through the SID
> rather than synthesizing the voice, which was rejected: in-game voices must be SID-synthesized. `index.js` hard-wires `DIGI = null`
> (`SIDVOICE_DIGI` is ignored) and `voc64.render` strips any digi/audio input, so neither `full` nor `hybrid` can reach the output.
> Verified: renders requested with full/hybrid are bit-identical to the pure 64-SID vocoder and never load `digi.js`.
> The vocoder fixes below (zap, bass, articulation) remain active. `digi.js` is kept only as reference code.

### Fixes in the 64-SID vocoder
- **Buzz between words / "zap"**: the room tail (a decaying max-hold on harmonic-chip levels) kept harmonics sounding through
  voiceless consonants: 13.8% of frames where Piper is voiceless (s, t, k, f) still carried SID harmonics (Piper: 0%). The tail
  now only rings into real silence; an audible voiceless consonant cuts it (`roomCut`). Leakage 13.8% -> ~4.5% (2x/4x).
- **Gap bridging** of F0 now only fills pitch-tracker dropouts (<=10 ms, or periodic gaps), not real consonants.
- **Voicing edges** refined at 10 ms (low band must dominate), against the 40 ms tracker window bleeding into consonants.
- **Bass**: below 300 Hz no per-harmonic flutter (x0.15), shimmer mostly removed, ~12 ms level smoothing, gentle low shelf (-0.7 dB).

### Digi layer (`retort/sidVoice/digi.js`, emulated on `jsid.js`)
Real C64 sample playback techniques, modelled at register level on one emulated chip:
- **Triangle + TEST-bit sample-and-hold (default, `tri`)**, on a voice (no $D418 cross-modulation). Per sample, cycle-exact:
  $D400/01 = F, $D404 = TEST|TRI|GATE (oscillator reset), $D404 = TRI|GATE (ramp), and exactly Cw cycles later $D404 = 0:
  with no waveform selected the waveform DAC holds the reached level (jsid models the floating-DAC hold: slow decay, 8580 0.8 s,
  6581 0.05 s). Level = F*Cw/2048 on the 12-bit triangle DAC; envelope AD=$00 SR=$FF (writing 0 also drops GATE).
  The sample rate equals the output rate so the per-sample reset/ramp glitch repeats identically (folds to DC, no whine):
  1x 22.05 kHz = 44.7 cycles/sample (Cw 32, 1024 levels) - honestly at/over the edge of what a real 6510 NMI loop sustains;
  2x 44.1 kHz (1024 levels), 4x 44.1 kHz (89 cycles, 2048 levels). 8-bit source samples. In-band SNR 47-51 dB.
- **Pulse-width digi (`pwm8`)**: TEST resets the pulse oscillator each sample, PW sets the duty (box-filtered pulse in jsid). ~same SNR.
- **$D418 4-bit volume (`d418`)**: $D418 = 8 + round(7*s) (mid-range +8 offset). 6581: mixer DC bias is what volume modulates;
  8580: almost no bias, so a digifix voice (voice 3, pulse PW 0, gate on) supplies it. In-band SNR 17-23 dB (grainy).
- Timing is zero-jitter: writes at an exact integer divisor of the output rate (cycle-exact NMI/CIA player, no badlines).
- Clean path: 8580 model, no Pin-26 hum or injected buzz.
- What it is, honestly: the digi layer streams the Piper waveform itself through the emulated SID DAC. In `full` mode the
  character's SID pitch/speaking-scale/formant shaping does NOT apply (only Piper's tempo, noise, pauses from mood/confidence);
  the voice is Piper's LJ Speech voice played as a C64 digi. `hybrid` keeps the 64-SID vocoder for voiced sound (character
  pitch, scales, mood) and uses the triangle digi only for voiceless consonants/transients.

### Comparison (16 lab lines, same Piper take; buzz score = excess over Piper of 1-4 kHz roughness + bass AM + crest, dB)
| variant | buzz | intelligibility |
|---|---|---|
| Piper | 0 (ref) | 78% |
| A: triangle digi, single stock SID, 1x | **0.00** | **78%** |
| B: 64 SIDs 1x + triangle digi (hybrid) | 2.12 | 70% |
| C: 64 SIDs 2x + triangle digi (hybrid) | 2.37 | 73% |
| D: 64 SIDs 4x + triangle digi (hybrid) | 2.41 | 75% |

Previously installed default `SIDVOICE_DIGI=full` (A) was withdrawn in VERSION 15; the voice is now the pure 64-SID vocoder only
(1x/2x/4x panel switch still selects the clock). The table is kept as a lab record.
## Triangle vocoder + male-voice pass (Oct 2026, cache VERSION 16) - pure SID, no digi
- Harmonic chips 1-44 were already triangle (one pitch-locked harmonic per chip, LP at 1.5x the harmonic), so "rebuild on triangle"
  changed the remaining parts: in 2x/4x the 6 upper chips (45-50) were one "stand-in" harmonic each (for a 100 Hz male at 4x one
  chip stood in for ~10 harmonics). Now each of those chips runs 3 voices on 3 *different* triangle harmonics (`tri3`), so 18
  harmonics above H44 are individually pitch-locked (dynamic budget follows F0: low F0 -> more harmonics covered individually).
- Low-F0 buzz: sub-octave triangle "rasp" chip faded out below 160 Hz F0; for F0 < 140 Hz harmonics are dispersed from H3 up
  (detune x2.5, per-cycle phase variation x3.2), so the 1-4 kHz band no longer pulses as one hard glottal spike per period.
- "Render female, then lower pitch" trick (male lines synthesized at 2x F0 with formants pre-scaled, then octave-down
  pitch shift keeping tempo) was tested in the lab only: in the parameter domain alone it is mathematically the same as a direct
  render, so it needs an output pitch-shifter (rubberband). That lowered roughness a further ~1.5 dB but cost 5-28 points of
  intelligibility (phase-vocoder smearing) and is not a SID technique, so it is NOT installed.
- Results (16 lab lines, Whisper small.en, temp 0, single thread; rough = 1-4 kHz envelope modulation at 30-150 Hz, dB, lower
  is less buzz; Piper male -13.2 / female -13.9):

| variant | male rough 1x/2x/4x | male intel 1x/2x/4x | female rough 2x | female intel 1x/2x/4x |
|---|---|---|---|---|
| previous (v15) | -9.4 / -9.2 / -8.8 | 78 / 78 / 79 | -14.1 | 66 / 70 / 75 |
| triangle pass (v16, installed) | -10.5 / -9.6 / -9.7 | 78 / 78 / 79 | -14.3 | 63 / 71 / 75 |
| + female-render trick (lab) | -10.7 / -11.1 / -11.7 | 51 / 73 / 54 | (unchanged) | (unchanged) |

  Honest gap: male voices are still ~3 dB rougher than Piper's male take; female voices already match Piper.

## Male analysis guide (Piper Ryan) + SID-filter formant path (Oct 2026, cache VERSION 17) - pure SID output
- Piper is analysis only (pitch, envelope, timing feed the 64-SID vocoder; no Piper audio reaches the output).
- Characters with base F0 < 150 Hz (Grishnak, Azrakthul, Old Tobin, Snikkit) are now analysed from Piper's male voice
  `models/piper/en_US-ryan-high.onnx` (falls back to LJ if missing; `SIDVOICE_GUIDE=lj` forces LJ). Their formants are no
  longer LJ's female formants shifted down by 0.84; they are real male formants. Tempo, mood, confidence, pauses, scales unchanged.
- Formant path (`SIDVOICE_FORM`, default 0 = off): chips 42-44 play a saw glottal source at f0 through their SID SVF in band-pass,
  with cutoff following F2/F3/F4 picked from the analysed envelope (smoothed at register rate) and resonance as formant
  sharpness; harmonic chips above 1.1 kHz are cross-faded into them (parallel-formant, Klatt/Holmes style). Lab result: no buzz
  gain and 5-13 points less intelligibility, so it ships switched off.
- Results (16 lab lines, Whisper small.en temp 0, single thread; rough = 1-4 kHz modulation at 30-150 Hz, dB, lower = less buzz):

| variant | male rough 1x/2x/4x | male intel 1x/2x/4x | female intel 1x/2x/4x |
|---|---|---|---|
| Piper reference (Ryan male / LJ female) | -8.1 | 93 | 84 |
| v16 (LJ-guided males) | -10.5 / -9.6 / -9.7 | 78 / 78 / 79 | 63 / 71 / 75 |
| v17 Ryan-guided (installed) | -9.3 / -8.3 / -8.3 | 88 / 88 / 88 | 60 / 63 / 67 |
| v17 Ryan + formant filters (off) | -9.5 / -8.3 / -8.3 | 84 / 83 / 75 | 53 / 58 / 58 |

  Notes: Ryan's own voice is naturally rougher (-8.1 dB) than LJ (-13.2 for LJ male-shifted lines), so absolute male "rough"
  rises; relative to its own guide the SID render adds ~0 dB of buzz (v16 added ~3.6 dB over LJ). Female code is identical in
  v16 and v17; the female spread is take-to-take Piper variation (each Piper synthesis differs), not a regression.

## FOF cycle taper + sync/ring formant layer (Oct 2026, cache VERSION 18) - tested, OFF by default
- **FOF taper (`SIDVOICE_FOF`, 0..1)**: per glottal cycle the harmonic chips' volume registers follow a soft attack (12% of the
  cycle) and exponential decay to a floor, normalised to unit mean (pitch-synchronous SID volume shaping). Needs a register rate
  well above F0 (`SIDVOICE_HZ=2400`; at 800 Hz a female cycle is only 3-4 register updates). Tunables via `SIDVOICE_K`:
  fofA, fofT, fofF.
- **Sync/ring formants (`SIDVOICE_SYNC`, 0..1)**: chips 42-44 each run voice 1 as a silent triangle at F0 (sync master) and
  voice 2 as a saw at F2/F3/F4 hard-synced to it (`sRing:1` = triangle ring-modulated instead), through the chip's SID filter
  (BP by default, `sMode:96` = BP+HP). Harmonics above 1.1 kHz are cross-faded into the layer. Pure SID.
- Results (same 16 lines and same Piper takes as v17; rough = 1-4 kHz modulation at 30-150 Hz in dB, lower = less buzz;
  intel = Whisper small.en, temp 0):

| variant | male rough 1x/2x/4x | male intel | female rough 1x/2x/4x | female intel |
|---|---|---|---|---|
| v17 (installed default) | -9.3 / -8.3 / -8.3 | 88 / 88 / 88 | -13.8 / -14.8 / -14.3 | 60 / 63 / 67 |
| v17 at 2400 Hz register rate (2x only) | -7.7 | 91 | -13.6 | 72 |
| FOF 0.4 (@2400 Hz) | -8.3 / -7.6 / -7.4 | 83 / 93 / 91 | -14.0 / -13.6 / -13.4 | 61 / 75 / 75 |
| sync 0.4 | -9.3 / -8.0 / -8.2 | 88 / 84 / 88 | -13.2 / -13.2 / -13.2 | 63 / 70 / 69 |
| FOF + sync | -9.1 / -7.8 / -8.1 | 84 / 90 / 91 | -13.4 / -13.0 / -12.9 | 60 / 69 / 71 |

- Verdict: neither idea lowers buzz (both add 0.3-1.4 dB of 30-150 Hz roughness, which is the pitch-period pulsing the
  metric measures; FOF by design deepens it). They ship off; default output is bit-identical to v17. Side finding: the
  higher register rate (2400 Hz) itself lifts clarity at 2x/4x (male ~+3, female ~+5-9 points; FOF adds ~+2) at ~+0.6 dB
  roughness and ~3x render CPU. Not enabled; a candidate if clarity is preferred over buzz.

## True FOF / VOSIM on SID (after J. O. Smith, PASP "Formant Synthesis Models") (Oct 2026, cache VERSION 19) - OFF by default
- `SIDVOICE_TFOF` (0..1; 1 = replaces the voiced harmonic vocoder, <1 = blend; noise chips unchanged). Needs `SIDVOICE_HZ=2400`.
- Per formant F1-F5 one chip (40-44): voice 1 = silent triangle at F0 (sync master; TEST-reset at voicing onset so the SID
  period lines up with the software glottal clock), voice 2 = TRIANGLE at Fi hard-synced to it (phase restarts every period),
  LP at 1.6 Fi. The grain envelope is either the volume register written at register rate (half-sine attack `tfA`, decay
  exp(-pi*BW*t); `tfV` = VOSIM trim) or (`tfE` = rate nibble) the SID ADSR retriggered every period (gate held `tfGate` s,
  then exponential release) - the ADSR gives 8-bit envelope resolution where the volume register only has 4 bits.
- Formants/bandwidths: peak picking on the analysed envelope in constrained ranges with a continuity prior (high-F0 female
  ambiguity), -3 dB width -> bandwidth, smoothed per tick. Grain level scaled by alpha/f0 to match the envelope.
- Tuning: grid search on gain / bandwidth scale / taper / ADSR rate minimising a mel log-spectral distance to the Piper take
  (5 lines). Best FOF-only distance 11.6 dB vs v17 7.5 dB and v17@2400 10.6 dB: 4-bit volume quantisation and coarse
  register-rate gating limit how well a SID grain matches a real formant.
- Results (16 lines, same Piper takes; rough dB lower = less buzz; intel = Whisper small.en temp 0):

| variant | male rough 1x/2x/4x | male intel | female rough 1x/2x/4x | female intel |
|---|---|---|---|---|
| v17 (default) | -9.3 / -8.3 / -8.3 | 88 / 88 / 88 | -13.8 / -14.8 / -14.3 | 60 / 63 / 67 |
| v17 @2400 Hz | -8.4 / -7.7 / -7.5 | 81 / 91 / 91 | -14.0 / -13.6 / -13.4 | 61 / 72 / 68 |
| true FOF (replace, ADSR grains) | -11.4 / -10.8 / -10.8 | 66 / 76 / 75 | -12.5 / -13.7 / -13.9 | 36 / 47 / 52 |
| true FOF blend 0.25 (@2400) | -9.5 / -8.4 / -8.1 | 85 / 93 / 91 | -13.5 / -13.7 / -13.6 | 52 / 70 / 72 |

- Verdict: FOF-only removes ~2.5 dB of male buzz (smoothest male voice so far) but costs 12-22 points of male and 13-24 of
  female clarity. The 0.25 blend gives male clarity +3-5 at 2x/4x with buzz about equal to v17, but female 1x loses 8 points
  and female buzz rises ~1 dB. Neither meets "lower buzz without hurting clarity", so both ship off; default output is
  bit-identical to v17.

## In-game default "best known config" (Oct 2026, cache VERSION 20)
- Default ♫ SID mode is now **2x** (server `retort/sidMode.js` and client `assets/sfx.js` when no preference is saved; a saved
  choice still wins). 2x scored best overall: male clarity 93 (4x 91), female 63 (4x 67), lower buzz than 4x for both, half the CPU.
- Male (Ryan-guided) voices at 2x/4x: true-FOF blend 0.25 at a 2400 Hz register rate (built into `voc64.js` `BEST`, not env).
  Female voices and 1x: plain triangle vocoder at 800 Hz (v17). `SIDVOICE_BEST=0` (or an explicit `SIDVOICE_HZ`) disables it.
- All proven layers stay: Ryan/LJ analysis guides, triangle harmonics + tri3, zap fix, bass flatten, articulation, speaking
  scales, mood/confidence/cadence, punctuation pauses, anti-dropout phase spread. No digi; Piper is analysis only.
- Both Piper models (LJ + Ryan) load and warm at server start (~3 s in the background).
- Verified: male 2x render is bit-identical to the lab FOF-blend render, female 2x and male 1x bit-identical to v17.
  Render time on the box (4-6 s lines): 1x ~0.9 s, 2x/4x ~2.0-2.5 s per line, male FOF lines no slower than female.

## Accents, sing-y melody, emphasis (Oct 2026, cache VERSION 21) - default ON (`SIDVOICE_ACCENT=0` disables)
- `retort/sidVoice/accent.js`. Accents are phoneme-level rewrites of espeak IPA before Piper (analysis only; output stays SID):
  orc (Grishnak: th -> d/t), elf (Velyra: tapped r, long stressed vowels), northern (Azrakthul: monophthong o:/e:),
  rural (Old Tobin: dropped h, -in'), regal (Mortacia: broad a:, non-rhotic, long stressed vowels), hiss (Snikkit: long
  sibilants). Others map by name/kind/race keywords. Heavier rewrites were tried and dropped for clarity: trilled r
  (ring -> "king", trust -> "test"), orc i -> e, northern u/a shifts, rural ar/ai -> ah (male clarity fell to 63-76%).
- Prosodic accent traits per profile: pitch range x1.1-1.45, scale pull 0.5-0.65 (stronger snapping to scale notes), accent
  spread x1.2-1.5, tempo x0.92-1.06, phrase-level melodic arch 1-2.2 semitones. Pitch-range cap raised 1.4 -> 1.9.
- Emphasis: focus words (CAPS/*asterisk*/_italic_, names, negations, intensifiers, last content word of each clause, mood
  boost; about 1 in 6 words) get primary stress + a lengthened stressed vowel in Piper's input (more duration, pitch and energy
  in the analysis), and the SID melody lifts lengthened stretches by up to 3.3 semitones.
- Results (16 lines; rough dB lower = less buzz; Whisper small.en temp 0; Piper takes differ run to run by about +/-5 points):

| | male rough 1x/2x/4x | male intel 1x/2x/4x | female rough 1x/2x/4x | female intel 1x/2x/4x |
|---|---|---|---|---|
| v20 (before) | -9.3 / -8.4 / -8.1 | 88 / 93 / 91 | -13.8 / -14.8 / -14.3 | 60 / 65 / 67 |
| v21 accents + sing-y + emphasis | -10.5 / -9.2 / -9.2 | 80 / 82 / 82 | -13.7 / -15.6 / -15.6 | 58 / 67 / 73 |
| ablation: no phoneme accent (2x) | - / -8.9 / - | - / 89 / - | - / -15.4 / - | - / 69 / - |

  Trade-off, honestly: male clarity drops ~8-11 points (mostly the accents themselves; melody + emphasis alone cost ~3),
  female clarity holds or improves, and buzz is ~1 dB lower for both.

## Crisp stops + Mid-Atlantic Mortacia (Oct 2026, cache VERSION 22)
- Cause of skipped t's: espeak en-us flaps medial t/d (Tartarus -> tˈɑːɹɾɑːɹɹəs, water -> wˈɔːɾɚ), so Piper - and the SID
  render analysed from it - produced a soft tap that the vocoder smoothed away. Also in the vocoder: the 10-units/tick slew on
  noise chips smeared bursts, and F0 gap bridging + room tail let harmonics ring through stop closures.
- Fixes: (1) `accent.js` `unflap`: flaps become t where the spelling has t (d where it only has d); unaligned fallback -> t.
  (2) `voc64.js`: noise chips (51-63) may jump to full level in one tick (`slewN`), and near-silent frames (< `clos` of
  the line peak) force all harmonic/high chips to 0 instantly (clean closure before the burst, room tail cleared).
- Mortacia: new `midatl` profile (Mid-Atlantic/Transatlantic) replaces `regal` for her: phonemes from espeak RP
  (`en-gb-x-rp`: crisp unflapped t, non-rhotic, broad 'ah' in bath words like after/dance, rounded 'aw'), measured tempo x0.9,
  range x1.3, melodic arch 1.8 st. `regal` stays for other regal characters.
- Test (2x, Whisper small.en): test words "Tartarus, water, better, matter, little, after" 17% -> 50% (before: "Taurus, war,
  feather, mark, wheel"); Mortacia lines 86/89% -> 95/100%; Grishnak t-line 67 -> 89%; Old Tobin 80 -> 90%; avg 68 -> 85%.
  Full 16-line set at 2x unchanged within noise (male 82 -> 80, female 67 -> 67).
