'use strict';
// Global SID clock mode for every SID-rendered sound: 'stock' (real PAL SID, 985 kHz) or 'enhanced' (same emulated chip at
// 2x PAL = 1.97 MHz: oscillators reach ~7.8 kHz, filter cutoff range opens to 2x at the top). Default from SIDVOICE_CLOCK
// (stock if unset); the browser's ♫ panel switch POSTs /sid-mode and the choice is persisted in sid/sid-mode.json.
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'sid', 'sid-mode.json');
// modes: '1x' (stock PAL), '2x', '4x' clock multipliers; legacy names stock/enhanced map to 1x/2x
const norm = m => { m = String(m || '').toLowerCase(); return m === '1x' || m === 'stock' ? '1x' : m === '2x' || m === 'enhanced' ? '2x' : m === '4x' ? '4x' : null; };
const mult = (m = mode) => ({ '1x': 1, '2x': 2, '4x': 4 })[norm(m) || '1x'];
let mode = norm(process.env.SIDVOICE_CLOCK) || '2x'; // default 2x = best-scoring voice mode (see docs/SID-VOICE-RESEARCH.md)
try { const saved = norm(JSON.parse(fs.readFileSync(FILE, 'utf8')).mode); if (saved && !process.env.SIDVOICE_CLOCK) mode = saved; } catch {}
const listeners = [];
function get() { return mode; }
function set(m) { const n = norm(m); if (!n || n === mode) return mode; mode = n;
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify({ mode })); } catch {}
  for (const f of listeners) try { f(mode); } catch {} console.info('[SidMode] now', mode); return mode; }
function onChange(f) { listeners.push(f); }
module.exports = { get, set, norm, mult, onChange };
