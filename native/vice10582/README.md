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

## License

VICE and the accompanying native model/patch are GPL-2.0-or-later. The baseline
archive contains its COPYING license and original copyright notices. Keep these
notices, the patch and corresponding buildable source available if distributing
the modified binary. The separate native build is not linked into the Node or
browser game. See the [VICE source project](https://vice-emu.sourceforge.io/).
