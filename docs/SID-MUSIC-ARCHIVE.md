# SID Music Archive

`sid-to-wav.html` in the project root is a tracked, self-contained music player
and WAV exporter. Open it directly, or use Menu > SID Player / WAV Export
after restarting the server and refreshing the game. It runs offline without
uploading files. Play SID executes the music driver and synthesizes sound live,
without first generating a WAV. Pause resumes the same chip state; seeking
replays the driver off the audio thread to reconstruct that state. Looping,
subtunes, the full selected duration, and a separate full-WAV export are supported.

Loading a file selects 8580 for a classic export or 10582 for an enhanced/native
export. The Playback chip selector can override that choice in either direction;
switching preserves the playback position and paused state. WAV export uses the
selected chip too. Choosing 10582 for a classic score does not invent additional
register instructions or arrangement parts.

Accepted room compositions are archived before playback. Older room scores are
archived when revisited or loaded from a save. Room entry, revisits, chip switching
and save restoration now prepare small SID files instead of rendering room WAVs.
Permanent exports live in `.retort-data/music-archive/`, already
covered by `.gitignore`. No automatic cache cleanup traverses this directory.

Each distinct score has a title/hash directory containing:

- `8580.sid`: the portable three-voice PSID arrangement.
- `10582.sid`: that arrangement plus versioned private 10582 palette metadata.
- `score.json`: complete arranged score and available AI provenance.
- `song.asm` and `song_sid.asm`: generated assembly sources.
- `manifest.json` and `README.txt`: duration, checksums and compatibility notes.

Only successful, validated AI plans are labeled AI compositions. The offline
arranger studies are labeled as studies. No WAVs are retained in this archive
unless the player downloads one. Sharing a SID does not share the save game;
sharing score.json can include room prose and composition context.

## Compatibility

10582 is a custom software extension, not a real historical SID model or a
standard PSID chip designation. Its small, versioned JSON descriptor occupies
unused payload RAM after the generated player's tables. It never changes the
PSID header size or entry points. Conventional players play the three-voice
core only. Our live player and exporter recognize the descriptor and drive the existing
10582 companion register layer. A renamed duplicate without that metadata
would not reproduce the extension.

The native arrangement uses PAL 50 Hz, frame-quantized durations. Native exports
can differ in duration and timbre from the game's earlier nominal-tempo software
WAV. The game and workshop now use the same native driver. The two SID variants
share native timing. Export duration is carried
in the header's text credit, and also in 10582 metadata. Other SID files default
to ten minutes, with editable duration and subtune selection.

The worker reuses the existing bounded CPU/register tracer and SID emulator.
It supports this game's PSID files, not arbitrary C64 software. RSID, CIA timing,
ROM-dependent drivers, multiple chips and unsupported instructions fail
explicitly. The bundled assembler supports the generated player's strict
6502 subset when xa is absent; it does not generate a replacement composition.
The [HVSC SID format specification](https://www.hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt)
describes the standard PSID fields; the 10582 descriptor remains private.

The live player uses at most twelve 2048-sample queued/in-flight blocks (about
half a second at common device sample rates), not a ten-minute PCM buffer.
A direct MessageChannel connects the synthesis worker to an AudioWorklet so
main-thread scene construction cannot block buffer refill. The current device
sample rate is honored, including 48 kHz. Music retains its volume, ducking,
stereo controls, room crossfades, movement transport, chip selector and save
position. Autoplay still requires a user gesture where the browser enforces it.
Unsupported live audio fails visibly; it does not silently render a room WAV.

The normal enhanced archive path is a conventional
three-voice SID core plus a separately emulated 10582 companion chip instance,
controlled through custom registers. Neither path plays recorded speech or
sampled instruments. Web Audio receives synthesized PCM buffers, which is the
normal output of a software chip emulator, not a prerecorded WAV layer.
Speech now uses private 64-chip `.sidvoice` register scores through the same live
worker; these are not PSID files. The workshop can open and export them too.
Ambience and effects use private `.sidregs` register scores too, preserving their
original design functions and optional 10582 companion. Old recordings remain
available to legacy tools, but the new game does not fetch them for playback.
Previously generated room WAVs are not deleted automatically.

There is also a separate [experimental native VSID build](../native/vice10582/README.md).
Its `10582-native.sid` files contain executable 6502 register controllers, not
the earlier JSON companion recipe. The workshop recognizes their `HDK10582N`
credit tag and executes writes through `$d43f` in its 10582 chip, without an
additional companion instance. These files require the modified VSID's 10582
model to reproduce the extensions; stock VICE is unchanged.

## Tools

`node tools/build-sid-workshop.cjs` rebuilds the tracked HTML from
`assets/sid-to-wav.html` and the current renderer modules. Commit that HTML along
with its sources; generated music stays ignored. The old archived HTML location
redirects to the root file.

`node tools/archive-room-music.cjs --save 1` imports a checkpoint's music without
loading or modifying the checkpoint. Alternatively pass score JSON filenames.

Tests cover binary assembly, native playback, both variants, archive identity,
worker bundling, offline browser file loading, full-duration playback controls,
WAV creation and cancellation. The offline browser probe does not touch the
running adventure or require an API key. Run `node tests/run-sid-export-probe.cjs`
for offline live playback/export, or `node tests/run-live-room-music-probe.cjs`
for the actual game audio manager against an isolated test server. The latter
also checks playback progress during a blocked main thread and the absence of
room-WAV requests.
