const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const NOTE_TO_INDEX = new Map([
  ['C', 0], ['C#', 1], ['D', 2], ['D#', 3], ['E', 4], ['F', 5],
  ['F#', 6], ['G', 7], ['G#', 8], ['A', 9], ['A#', 10], ['B', 11],
]);

function hasCommand(cmd) {
  const probe = process.platform === 'win32'
    ? spawnSync('where.exe', [cmd], { stdio: 'ignore' })
    : spawnSync('sh', ['-lc', `command -v "${cmd}" >/dev/null 2>&1`], { stdio: 'ignore' });
  return probe.status === 0;
}

function normalizeRenderedWav(outBaseNoExt) {
  const want = `${outBaseNoExt}.wav`;
  const variants = [
    want,
    `${want}.wav`,
    `${outBaseNoExt}.WAV`,
    `${outBaseNoExt}.wav.wav`,
    outBaseNoExt,
  ];
  const found = variants.find(p => fs.existsSync(p));
  if (!found) {
    throw new Error(`WAV missing after sidplayfp: tried ${variants.map(v => path.basename(v)).join(', ')}`);
  }

  if (found !== want) {
    try {
      fs.renameSync(found, want);
    } catch {
      fs.copyFileSync(found, want);
      fs.unlinkSync(found);
    }
  }
  return want;
}

function renderRoomMusic(sidPath, outBaseNoExt, seconds = 20) {
  // outBaseNoExt example: /home/.../sid/current_room  (no .wav suffix)
  // sidplayfp on some builds appends ".wav" even if you pass one.
  const sidArgs = [`-w${outBaseNoExt}`, `-t${seconds}`, sidPath];
  const run = spawnSync('sidplayfp', sidArgs, { stdio: 'inherit' });
  if (run.status !== 0) throw new Error('sidplayfp failed');
  return normalizeRenderedWav(outBaseNoExt);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function collectPattern(voice) {
  // tracker-style song: expand the order list into one flat line (mirrors the 6502 player)
  if (Array.isArray(voice?.order) && Array.isArray(voice?.patterns) && voice.order.length) {
    return voice.order.flatMap(i => Array.isArray(voice.patterns[i]) ? voice.patterns[i] : []);
  }
  if (Array.isArray(voice?.pattern) && voice.pattern.length) {
    return voice.pattern;
  }
  const sections = voice?.patternSections;
  if (!sections) return [];
  return []
    .concat(Array.isArray(sections.intro) ? sections.intro : [])
    .concat(Array.isArray(sections.development) ? sections.development : [])
    .concat(Array.isArray(sections.cadence) ? sections.cadence : []);
}

function durationToSeconds(duration, bpm) {
  const quarter = 60 / Math.max(1, Number(bpm) || 120);
  const normalized = Number(duration);
  if (normalized === 1) return quarter * 4;   // whole (held note, long-form composer)
  if (normalized === 2) return quarter * 2;   // half (held note)
  if (normalized === 4) return quarter;
  if (normalized === 16) return quarter / 4;
  return quarter / 2;
}

function noteToFrequency(note, octave) {
  const upper = String(note || '').toUpperCase();
  if (upper === 'REST') return 0;
  const idx = NOTE_TO_INDEX.get(upper);
  if (idx == null) return 0;
  const midi = 12 * ((Number(octave) || 0) + 1) + idx;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function buildVoiceSequence(voice, bpm) {
  // zero-time command steps (instrument change) carry over to the following notes, like the 6502 player
  let inst = null;
  const raw = [];
  for (const st of collectPattern(voice)) {
    if (st && st.cmd === 'inst') { inst = { waveform: st.waveform, adsr: st.adsr }; continue; }
    if (st && st.cmd) continue;   // filter commands are only approximated by the per-voice filter below
    raw.push(inst ? { ...st, _inst: inst } : st);
  }
  const sequence = raw.map(step => {
    const durationSec = durationToSeconds(step?.duration, bpm);
    const freq = noteToFrequency(step?.note, step?.octave);
    return {
      durationSec,
      freq,
      isRest: freq <= 0,
      chord: Array.isArray(step?.chord) ? step.chord : null,   // per-frame arpeggio (mirrors the 6502 player)
      wave: step?.wave || step?._inst?.waveform || null,       // e.g. NOISE drum hit or instrument change
      adsr: step?._inst?.adsr || null,
    };
  }).filter(step => step.durationSec > 0);

  if (sequence.length) return sequence;
  return [{ durationSec: durationToSeconds(8, bpm), freq: 0, isRest: true }];
}

function mapNibbleToSeconds(value, minSeconds, maxSeconds) {
  const normalized = clamp(Number(value) || 0, 0, 15) / 15;
  return minSeconds + normalized * (maxSeconds - minSeconds);
}

function envelopeForSample(adsr, elapsedSec, noteDurationSec) {
  const attack = mapNibbleToSeconds(adsr?.attack, 0.002, 0.08);
  const decay = mapNibbleToSeconds(adsr?.decay, 0.01, 0.18);
  const sustain = 0.15 + (clamp(Number(adsr?.sustain) || 0, 0, 15) / 15) * 0.85;
  const release = mapNibbleToSeconds(adsr?.release, 0.01, 0.22);
  const gateEnd = Math.max(attack, noteDurationSec - release);

  if (elapsedSec < attack) {
    return elapsedSec / attack;
  }
  if (elapsedSec < attack + decay) {
    const t = (elapsedSec - attack) / decay;
    return 1 - (1 - sustain) * t;
  }
  if (elapsedSec < gateEnd) {
    return sustain;
  }
  if (elapsedSec < noteDurationSec) {
    const releaseT = (elapsedSec - gateEnd) / Math.max(0.001, noteDurationSec - gateEnd);
    return sustain * (1 - releaseT);
  }
  return 0;
}

function sampleWaveform(waveform, phase, dutyCycle, state) {
  const kind = String(waveform || 'PULSE').toUpperCase();
  const x = phase - Math.floor(phase);
  if (kind === 'TRI') {
    return 1 - 4 * Math.abs(x - 0.5);
  }
  if (kind === 'SAW') {
    return 2 * x - 1;
  }
  if (kind === 'NOISE') {
    state.noise = (state.noise * 1664525 + 1013904223) >>> 0;
    return (state.noise / 0x7fffffff) - 1;
  }
  return x < dutyCycle ? 1 : -1;
}

function writeMono16Wav(outPath, samples, sampleRate) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const scaled = Math.round(clamp(samples[i], -1, 1) * 32767);
    buffer.writeInt16LE(scaled, 44 + i * 2);
  }

  fs.writeFileSync(outPath, buffer);
  return outPath;
}

function renderArrangementFallback(musicJson, outBaseNoExt, seconds = 20) {
  // Enhanced SID mode (retort/sidMode.js): rendered at 44.1 kHz (oscillator ceiling ~7.8 kHz instead of ~3.9 kHz, far less
  // aliasing on saw/pulse) and the filter cutoff range opens up to 2x at the top, low cutoffs unchanged (same as jsid).
  const mult = require('./sidMode').mult(), enhanced = mult > 1; // 4x: ceiling 15.6 kHz, still under the 22.05 kHz Nyquist of 44.1 kHz output
  const sampleRate = enhanced ? 44100 : 22050, fMax = 3900 * mult;
  const totalSamples = Math.max(1, Math.floor(sampleRate * Math.max(1, seconds)));
  const voices = Array.isArray(musicJson?.voices) ? musicJson.voices : [];
  const master = new Float32Array(totalSamples);

  const states = voices.slice(0, 3).map((voice, index) => {
    const sequence = buildVoiceSequence(voice, musicJson?.bpm);
    const first = sequence[0];
    return {
      voice,
      sequence,
      index: 0,
      phase: 0,
      eventStart: 0,
      eventEnd: Math.max(1, Math.floor(first.durationSec * sampleRate)),
      noise: 0x12345678 + index * 97,
      gain: [0.32, 0.26, 0.22][index] || 0.22,
      dutyCycle: clamp(((Number(voice?.pulseWidth) || 2048) / 4095), 0.08, 0.92),
      // optional SID-style extras (absent on old songs -> old behaviour)
      pwmRate: (Number(voice?.pwmSpeed) || 0) * 50 / 3072,  // duty units per second (matches SID engine sweep)
      pwmDir: 1,
      vibrato: Number(voice?.vibrato) || 0,
      lp: 0,
      lpCoef: (() => {
        const t = String(voice?.filter?.type || 'NONE').toUpperCase();
        if (!t.includes('LP') && !t.includes('BP')) return 1;
        const c = clamp(Number(voice?.filter?.cutoff) || 1024, 0, 2047), fc = Math.min(sampleRate * 0.45, (200 + (c / 2047) * 5800) * (1 + (mult - 1) * c / 2047));
        return clamp(1 - Math.exp(-2 * Math.PI * fc / sampleRate), 0.02, 1);
      })(),
    };
  });

  for (let i = 0; i < totalSamples; i++) {
    let mix = 0;

    for (const state of states) {
      while (i >= state.eventEnd) {
        state.eventStart = state.eventEnd;
        state.index = (state.index + 1) % state.sequence.length;
        const nextDuration = Math.max(1, Math.floor(state.sequence[state.index].durationSec * sampleRate));
        state.eventEnd += nextDuration;
      }

      const event = state.sequence[state.index];
      if (event.isRest) continue;

      const elapsedSamples = i - state.eventStart;
      const elapsedSec = elapsedSamples / sampleRate;
      // 20ms gate gap before the next note (hard-restart feel, keeps repeated notes articulated)
      const gated = Math.max(0.01, event.durationSec - 0.02);
      const env = elapsedSec < gated ? envelopeForSample(event.adsr || state.voice?.adsr, elapsedSec, gated) : 0;
      if (state.pwmRate) {
        state.dutyCycle += state.pwmDir * state.pwmRate / sampleRate;
        if (state.dutyCycle > 0.86) state.pwmDir = -1;
        if (state.dutyCycle < 0.14) state.pwmDir = 1;
      }
      let f = event.freq;
      if (event.chord) f *= Math.pow(2, (event.chord[Math.floor(elapsedSec * 50) % 3] || 0) / 12);
      if (state.vibrato && event.durationSec >= 0.24 && elapsedSec > 0.15) {
        f *= 1 + 0.006 * state.vibrato * Math.sin(2 * Math.PI * 5.5 * elapsedSec); // delayed vibrato on held notes
      }
      if (f > fMax) f = fMax; // SID oscillator ceiling at this clock
      state.phase = (state.phase + (f / sampleRate)) % 1;
      const raw = sampleWaveform(event.wave || state.voice?.waveform, state.phase, state.dutyCycle, state);
      state.lp += state.lpCoef * (raw - state.lp);
      mix += state.lp * env * state.gain;
    }

    master[i] = Math.tanh(mix * 0.9);
  }

  return writeMono16Wav(`${outBaseNoExt}.wav`, master, sampleRate);
}

// Exact loop length of a tracker-style song, so the looping WAV in the browser wraps cleanly.
function songLoopSeconds(musicJson, mode) {
  const v = Array.isArray(musicJson?.voices) ? musicJson.voices[0] : null;
  if (!v || !Array.isArray(v.order) || !Array.isArray(v.patterns)) return null;
  const units = collectPattern(v).filter(st => !st?.cmd).reduce((acc, st) => acc + ({ 16: 1, 8: 2, 4: 4, 2: 8, 1: 16 }[Number(st?.duration)] || 2), 0);
  const bpm = Math.max(1, Number(musicJson.bpm) || 120);
  if (mode === 'sid') { // same tick maths as the 6502 player (50 Hz frames)
    const tpb = Math.max(1, Math.round((50 * 60) / bpm));
    const t16 = Math.max(2, Math.round(tpb / 4));
    return (units * t16) / 50;
  }
  return units * (60 / bpm) / 4;
}

// Movement boundaries = order positions where all three voices start a command-only pattern.
// They match the PSID subtunes written by renderSid_poke.js (subtune 1 = whole song).
function sidChunks(musicJson) {
  const voices = Array.isArray(musicJson?.voices) ? musicJson.voices : [];
  if (voices.length !== 3 || !voices.every(v => Array.isArray(v.order) && Array.isArray(v.patterns))) return null;
  const cmdOnly = (v, pos) => { const pat = v.patterns[v.order[pos]]; return Array.isArray(pat) && pat.length > 0 && pat.every(ev => ev && ev.cmd); };
  const starts = [0];
  for (let pos = 1; pos < voices[0].order.length && starts.length < 32; pos++) {
    if (voices.every(v => pos < v.order.length && cmdOnly(v, pos))) starts.push(pos);
  }
  const bpm = Math.max(1, Number(musicJson.bpm) || 120);
  const t16 = Math.max(2, Math.round(Math.max(1, Math.round((50 * 60) / bpm)) / 4));
  const v0 = voices[0];
  const unitsAt = (a, b) => v0.order.slice(a, b).flatMap(i => v0.patterns[i] || []).filter(st => !st?.cmd)
    .reduce((acc, st) => acc + ({ 16: 1, 8: 2, 4: 4, 2: 8, 1: 16 }[Number(st?.duration)] || 2), 0);
  return starts.map((st, k) => ({ track: k + 1, seconds: unitsAt(st, k + 1 < starts.length ? starts[k + 1] : v0.order.length) * t16 / 50 }))
    .map((c, k) => (k === 0 && starts.length > 1) ? { ...c, track: 1 } : c);
}

// Long songs: record each movement with its own sidplayfp process in parallel, then join (10 min in ~1/4 the time).
function renderSidParallel(musicJson, sidOut, outBaseNoExt) {
  const chunks = sidChunks(musicJson);
  if (!chunks || chunks.length < 2) return null;
  const want = `${outBaseNoExt}.wav`;
  const jobPath = `${outBaseNoExt}.render-job.json`;
  fs.writeFileSync(jobPath, JSON.stringify({ sid: sidOut, out: want, freq: 44100, chunks }), 'utf8');
  const t0 = Date.now();
  const run = spawnSync(process.execPath, [path.join(__dirname, 'sidParallelRender.js'), jobPath], { stdio: 'inherit' });
  try { fs.unlinkSync(jobPath); } catch {}
  if (run.status !== 0 || !fs.existsSync(want)) { console.warn('Parallel SID render failed; rendering in one pass.'); return null; }
  console.log(`SID rendered in ${chunks.length} parallel movements, ${chunks.reduce((a, c) => a + c.seconds, 0).toFixed(1)}s of music in ${Date.now() - t0}ms`);
  return want;
}

function renderArrangementToWav(musicJson, options = {}) {
  const {
    jsonPath,
    asmOut,
    sidOut,
    outBaseNoExt,
    seconds = 20,
    renderJsPath,
    cwd = process.cwd(),
  } = options;

  if (!outBaseNoExt) {
    throw new Error('outBaseNoExt is required');
  }

  fs.mkdirSync(path.dirname(outBaseNoExt), { recursive: true });

  if (jsonPath) {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(musicJson, null, 2), 'utf8');
  }

  if (renderJsPath && jsonPath && asmOut && sidOut) {
    const build = spawnSync('node', [renderJsPath, jsonPath, asmOut], { cwd, stdio: 'inherit' });

    if (build.error) {
      console.warn(`Music renderer launch failed (${build.error.message}); using JS WAV fallback.`);
    } else if (build.status !== 0) {
      console.warn(`Music renderer exited with status ${build.status}; using JS WAV fallback.`);
    } else if (!fs.existsSync(sidOut)) {
      console.warn('SID output not produced; using JS WAV fallback.');
    } else if (require('./sidMode').mult() > 1) {
      console.warn(require('./sidMode').get() + ' SID clock: sidplayfp/reSIDfp only emulate stock clocks; using the enhanced JS renderer.');
    } else if (!hasCommand('sidplayfp')) {
      console.warn('sidplayfp not found in PATH; using JS WAV fallback.');
    } else {
      return {
        wavPath: renderSidParallel(musicJson, sidOut, outBaseNoExt)
          || renderRoomMusic(sidOut, outBaseNoExt, songLoopSeconds(musicJson, 'sid') ? songLoopSeconds(musicJson, 'sid').toFixed(3) : seconds),
        sidOut,
        renderer: 'sid',
      };
    }
  }

  return {
    wavPath: renderArrangementFallback(musicJson, outBaseNoExt, songLoopSeconds(musicJson, 'js') || seconds),
    sidOut: sidOut && fs.existsSync(sidOut) ? sidOut : null,
    renderer: 'js-fallback',
  };
}

module.exports = { sidChunks, songLoopSeconds, hasCommand, renderRoomMusic, renderArrangementToWav };
