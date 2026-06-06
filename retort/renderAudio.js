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
  const raw = collectPattern(voice);
  const sequence = raw.map(step => {
    const durationSec = durationToSeconds(step?.duration, bpm);
    const freq = noteToFrequency(step?.note, step?.octave);
    return {
      durationSec,
      freq,
      isRest: freq <= 0,
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
  const sampleRate = 22050;
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
      const env = envelopeForSample(state.voice?.adsr, elapsedSec, event.durationSec);
      state.phase = (state.phase + (event.freq / sampleRate)) % 1;
      mix += sampleWaveform(state.voice?.waveform, state.phase, state.dutyCycle, state) * env * state.gain;
    }

    master[i] = clamp(mix * 0.7, -1, 1);
  }

  return writeMono16Wav(`${outBaseNoExt}.wav`, master, sampleRate);
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
    } else if (!hasCommand('sidplayfp')) {
      console.warn('sidplayfp not found in PATH; using JS WAV fallback.');
    } else {
      return {
        wavPath: renderRoomMusic(sidOut, outBaseNoExt, seconds),
        sidOut,
        renderer: 'sid',
      };
    }
  }

  return {
    wavPath: renderArrangementFallback(musicJson, outBaseNoExt, seconds),
    sidOut: sidOut && fs.existsSync(sidOut) ? sidOut : null,
    renderer: 'js-fallback',
  };
}

module.exports = { hasCommand, renderRoomMusic, renderArrangementToWav };
