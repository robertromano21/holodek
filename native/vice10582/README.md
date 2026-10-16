# Experimental VICE 10582

This is a separate native VSID build, not a replacement for installed VICE.
The baseline is the VICE 3.1 source archive already on this machine. Its SHA256 is
`3eb8159633816095006dec36c5c3edd055a87fd8bda193a1194a6801685d1240`.
The source/binaries/test recordings stay under ignored `.retort-data/vice10582`.
The reproducible patch, native model and build tools belong in Git.

## Build

Visual Studio 2022 Community with C++ tools and Windows SDK is required.
From the project root, run:

```powershell
.\tools\prepare-vice10582.ps1
```

Use `-Archive <path>` for a different location of that exact 3.1 source archive.
Preparation compiles the old project generator from source using the modern
compiler. It creates the output directory before running the generator; it
does not run the bundled obsolete executable that crashed on a missing folder.
`tools/build-vice10582.ps1` rebuilds an already-prepared source tree.

## Export And Verify

```powershell
node tools/export-native-10582.cjs
node tools/verify-vice10582.cjs .retort-data/vice10582/auditions/the-ashen-lullaby-6a0f67dcc72885a5 625
```

The exporter also accepts an existing music-archive score directory. It produces
an experimental `10582-native.sid`, assembly, and a register-only proof SID.
The verifier runs the actual VSID executable in warp mode, recording diagnostics.
The proof's sustained output is silent on model 257 (8580), audible on model 261
(10582). The room test executes the whole score, not just the first movement.
Verification JSON and diagnostic WAVs are retained in that audition directory.

To listen directly in the new VSID, launch the separately built executable with
`-keepenv -sidenginemodel 10582 <10582-native.sid>`. Do not pass `-warp` for
listening. The workshop HTML also recognizes native exports and executes their
register writes in its 10582 emulator.

The helper launches the isolated build with the exported audition score:

```powershell
.\tools\play-native-10582.ps1 -ShowWindow
```

## What This Demonstrates

The `.sid` contains a real 6502 init/play driver, patterns and instrument data.
Its 6502 instructions write the custom register bank during playback. No audio
samples, JavaScript score controller or JSON recipe is read by VSID. The extra
formant voice, levels/mutes, fast envelopes and output notch are native C++
emulator logic. Stock 8580 mode still uses the original reSID implementation.

This is evidence for an executable custom SID extension, not a historical
Commodore chip, stock-VICE support, or upstream acceptance. The native controller
currently implements the selected room palette with a lead-following formant
and gate-driven level. It is not a bit-identical port of the earlier 100 Hz
JavaScript companion's motion/transient automation. Existing archived 10582
files still use that compatibility path; they are not silently rewritten.

The native chip port is experimental/sample-stepped, not a cycle-exact analog
hardware model. Broad third-party SID compatibility has not been established.
VSID is the tested target; the generic C64 GUI emulator is not built or tested
with the expanded I/O map. VICE snapshots in 10582 mode fail explicitly; game
saves remain supported through the separate game's score/state reconstruction.

## Voice Bank Demo

`holodek10582bank.h` adds a separate, opt-in player for `HDKSV001` `.sidvoice`
register scores. It instantiates 64 native chips and applies their timed writes,
with no sampled-speech input. This is not a standard PSID speech export or a
6502 speech driver. The verifier runs a silent carrier both without and with
the bank, checking that only the native bank produces sound.

```powershell
node tools/export-sid-voice.cjs
node tools/verify-sid-voice-vice.cjs <score.sidvoice>
.\tools\play-sid-voice-vice.ps1 -ShowWindow
```

The helper sets `HOLODEK_SIDVOICE_SCORE` only for its isolated VSID child and uses
the score's sample rate. There is no change to installed VICE or the game server.
Audio quality and intelligibility still require listening tests; browser/native
synthesis is not guaranteed bit-identical. See [speech documentation](../../docs/SID-VOICE-10582.md).

## Potential Fabrication

If it were fabricated, the 10582 is an 8580-compatible SID with a second register page and four additive blocks that only affect the speech path. Music written to the classic 32 registers plays unchanged.
Base

Three voices, same as the 8580: 24-bit phase accumulator, pulse/saw/triangle/noise, ADSR, hard-restart gate, global filter, 4-bit master volume.
Register file is 64 bytes instead of 32. Addresses $00–$1F are the classic SID. $20–$3F are the extensions. A model bit selects the 6-bit address mask; on an 8580 the upper page is ignored.
Clock is the standard ~1 MHz (or 2×/4× for the higher-rate modes already used in the player). Output is the chip’s own sample stream, not a resampled WAV.

Extended registers (per chip)

Range, Block and What it does

$19–$1B	Level	
Per-voice 8-bit amplitude (LVL).    
Scales the voice after the waveform, before the mixer.

$1C	Mute	    
Per-voice hard mute.               
 Zeros that voice’s contribution without touching the envelope.

$1D–$1E	        
Fast envelope	                    
Attack/decay times for a burst envelope that can replace the ADSR on a voice (FENV). Used for stop releases.

$1F	            
Formant enable / source	
Enables a 2-pole resonator, picks its excitation (voice-1 wrap as a glottal pulse, and/or noise), and sets a divider.

$20–$23	        
Formant	Center frequency (16-bit Hz), bandwidth, level. 
The resonator sits on the noise or the pulse and tracks the short-window spectral peak.

$24–$29	
Output notch	
A peaking biquad on the chip’s final sum. Center, width, and depth. Wet/dry ramps in ~1 ms. This is the antiformant path; it never touches the dry music signal.

RangeBlockWhat it does$19–$1BLevelPer-voice 8-bit amplitude (LVL). Scales the voice after the waveform, before the mixer.$1CMutePer-voice hard mute. Zeros that voice’s contribution without touching the envelope.$1D–$1EFast envelopeAttack/decay times for a burst envelope that can replace the ADSR on a voice (FENV). Used for stop releases.$1FFormant enable / sourceEnables a 2-pole resonator, picks its excitation (voice-1 wrap as a glottal pulse, and/or noise), and sets a divider.$20–$23FormantCenter frequency (16-bit Hz), bandwidth, level. The resonator sits on the noise or the pulse and tracks the short-window spectral peak.$24–$29Output notchA peaking biquad on the chip’s final sum. Center, width, and depth. Wet/dry ramps in ~1 ms. This is the antiformant path; it never touches the dry music signal.
Architecture constraints that matter for silicon

The notch is after the mixer, not inside a voice. It carves the summed spectrum regardless of phase, which is why it was preferred over an inverted resonator.
The formant voice is additive. It does not replace the classic oscillator; it adds a shaped component. Music that never writes $1F–$23 is bit-identical to an 8580.
Noise and tone still cannot be mixed on one classic voice. The formant block is the workaround: a separate resonator excited by noise or by the pulse edge.
A speech line uses a bank of these chips (64 in the current emulator), each handling a slice of the spectrum or a phone. A single 10582 is not a full vocoder; it is one voice-group with the extra blocks. A fabricated part would either be one chip plus an external bank controller, or a multi-core die with N copies of the voice group sharing the notch.

What was deliberately left out

No PCM/digi path. The chip does not play samples.
No change to the classic waveform set or the filter topology. The extensions are additive registers, not a new oscillator core.
The multi-resolution analysis (8 ms vs 32 ms) is a driver feature, not a chip feature. The chip only sees the register writes the driver produces.

That is the fabrication target: an 8580 with a 32-byte extension page containing per-voice level and mute, a fast burst envelope, one tracking formant resonator, and one output-path notch, all of which stay silent unless written.

## License

VICE and the accompanying native model/patch are GPL-2.0-or-later. The baseline
archive contains its COPYING license and original copyright notices. Keep these
notices, the patch and corresponding buildable source available if distributing
the modified binary. The separate native build is not linked into the Node or
browser game. See the [VICE source project](https://vice-emu.sourceforge.io/).
