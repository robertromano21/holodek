// Two-slot room music files (sid/room_A.wav, sid/room_B.wav). The next room's song is rendered into the slot the
// browser is NOT playing, so the current song keeps playing until the browser switches (when the new room is on
// screen). The browser reports the slot it plays via POST /music/now-playing. At most two song WAVs exist on disk.
// Each slot remembers which room it holds, so returning to a room whose song is still in a slot needs no render.
'use strict';
const fs = require('fs'), path = require('path');
const SID_DIR = path.join(__dirname, '..', 'sid');
const state = { playing: null, last: null, lastUrl: null, lastCoords: null, holds: { A: null, B: null }, urls: { A: null, B: null }, modes: { A: null, B: null } };
const SidMode = require('./sidMode');
// The old single file is no longer used; remove it so only the two slots remain.
try { fs.unlinkSync(path.join(SID_DIR, 'current_room.wav')); } catch {}
function nextSlot() {
  if (state.playing === 'A' || state.playing === 'B') return state.playing === 'A' ? 'B' : 'A';
  return state.last === 'A' ? 'B' : 'A';
}
const base = slot => path.join(SID_DIR, `room_${slot}`);
function rendered(slot, coords) {
  state.holds[slot] = coords || null; state.modes[slot] = SidMode.get(); // a slot rendered in the other SID mode is not reused
  state.urls[slot] = `/sid/room_${slot}.wav?ts=${Date.now()}`;
  return use(slot);
}
// A slot still holding this room's song (file present): reuse it instead of rendering again.
function find(coords) {
  if (!coords) return null;
  for (const s of ['A', 'B']) if (state.holds[s] === coords && state.modes[s] === SidMode.get() && state.urls[s] && fs.existsSync(base(s) + '.wav')) return s;
  return null;
}
function use(slot) { // mark a slot as the newest song (for /music/latest) and return its stable URL
  state.last = slot; state.lastCoords = state.holds[slot]; state.lastUrl = state.urls[slot];
  return state.lastUrl;
}
function setPlaying(slot) { if (slot === 'A' || slot === 'B') state.playing = slot; }
function latest() { return { url: state.lastUrl, slot: state.last, coords: state.lastCoords, playing: state.playing, holds: state.holds }; }
function reset() { state.last = state.lastUrl = state.lastCoords = null;
  for (const slot of ['A', 'B']) state.holds[slot] = state.urls[slot] = state.modes[slot] = null; }
module.exports = { nextSlot, base, rendered, find, use, setPlaying, latest, state, reset };
