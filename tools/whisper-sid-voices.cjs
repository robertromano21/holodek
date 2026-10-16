'use strict';
// Offline measurement only. No expected text, name hints or grammar is sent to ASR.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { evaluate, score } = require('./score-sid-voices.cjs');
const ROOT = path.resolve(__dirname, '..');
const USAGE = 'node tools/whisper-sid-voices.cjs [--manifest file] [--exe file] [--model file] [--out dir] [--threads 4] [--character name] [--line id]';

function options(args) {
  const home = process.env.WHISPER_HOME || (process.platform === 'win32' ? 'C:/tools/whisper' : './whisper');
  const out = { manifest: path.join(ROOT, 'sid/voice-auditions/manifest-corpus.json'),
    exe: process.env.WHISPER_CLI || path.join(home, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'),
    model: process.env.WHISPER_MODEL || path.join(home, 'ggml-base.en.bin'), threads: 4, timeoutMs: 120000 };
  const keys = { '--manifest': 'manifest', '--exe': 'exe', '--model': 'model', '--out': 'out', '--threads': 'threads', '--character': 'character', '--line': 'line' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') return { help: true };
    const key = keys[args[i]], value = args[++i];
    if (!key || !value || value.startsWith('--')) throw Error(USAGE);
    out[key] = value;
  }
  out.threads = Number(out.threads);
  if (!Number.isInteger(out.threads) || out.threads < 1 || out.threads > 64) throw Error('Threads must be an integer from 1 to 64.');
  return out;
}

function command(exe, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { shell: false, windowsHide: true });
    let stdout = '', stderr = '', bytes = 0, problem = null;
    const timer = setTimeout(() => { problem = Error('Whisper timed out.'); child.kill(); }, timeoutMs);
    for (const [key, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) { problem = Error('Whisper exceeded its diagnostic output limit.'); child.kill(); return; }
      if (key === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (problem) return reject(problem);
      if (code !== 0) return reject(Error(`Whisper exited ${code ?? signal}: ${stderr.slice(-2000)}`));
      resolve({ stdout, stderr });
    });
  });
}

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function readTranscript(json) {
  if (!Array.isArray(json.transcription) || json.transcription.some(s => typeof s.text !== 'string')) throw Error('Invalid Whisper transcription JSON.');
  return { text: json.transcription.map(s => s.text.trim()).filter(Boolean).join(' '),
    segments: json.transcription.map(s => ({ text: s.text.trim(), offsets: s.offsets || null,
      tokens: (s.tokens || []).map(t => ({ text: t.text, probability: t.p, offsets: t.offsets || null })) })) };
}

function sourceGaps(manifest, transcripts) {
  const pairs = [], summary = {};
  for (const c of manifest.characters) {
    const referenceFile = c.variants.reference?.file;
    if (!referenceFile || !Object.values(c.variants).every(v => typeof transcripts[v.file] === 'string')) continue;
    const expected = c.text || manifest.text, reference = score(expected, transcripts[referenceFile]);
    for (const [variant, v] of Object.entries(c.variants)) {
      if (variant === 'reference') continue;
      const sid = score(expected, transcripts[v.file]), addedErrors = sid.errors - reference.errors;
      pairs.push({ character: c.name, line: c.line, sourceHash: c.sourceHash || null, variant, file: v.file, referenceFile,
        referenceErrors: reference.errors, sidErrors: sid.errors, addedErrors, words: reference.referenceWords,
        deltaWer: sid.wer - reference.wer,
        sourceToSidEdits: score(transcripts[referenceFile], transcripts[v.file]).edits });
      const g = summary[variant] ||= { files: 0, referenceErrors: 0, sidErrors: 0, addedErrors: 0, words: 0 };
      g.files++; g.referenceErrors += reference.errors; g.sidErrors += sid.errors; g.addedErrors += addedErrors; g.words += reference.referenceWords;
    }
  }
  for (const g of Object.values(summary)) g.deltaWer = g.words ? g.addedErrors / g.words : null;
  return { summary, pairs, caveat: 'Net ASR error difference on the same source take, not a perceptual score. Negative deltas do not prove better-than-source speech. ASR timestamps are not phoneme boundaries.' };
}

function audioPath(dir, file) {
  if (typeof file !== 'string' || !/\.wav$/i.test(file)) throw Error('Manifest variants must name WAV files.');
  const absolute = path.resolve(dir, file), relative = path.relative(dir, absolute);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('Audio must stay inside the manifest directory.');
  return absolute;
}

async function run(opts, execute = command, progress = console.log) {
  const manifestPath = path.resolve(opts.manifest), manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.characters)) throw Error('Invalid audition manifest.');
  const selected = { ...manifest, characters: manifest.characters.filter(c => (!opts.character || c.name === opts.character) && (!opts.line || c.line === opts.line)) };
  if (!selected.characters.length) throw Error('No matching audition lines.');
  const files = new Map(), dir = path.dirname(manifestPath);
  for (const c of selected.characters) {
    if (!c.variants || !Object.keys(c.variants).length || !(c.text || manifest.text)) throw Error('Audition line needs variants and expected text.');
    for (const v of Object.values(c.variants)) files.set(v.file, audioPath(dir, v.file));
  }
  const exe = path.resolve(opts.exe), model = path.resolve(opts.model);
  for (const file of [exe, model, ...files.values()]) if (!fs.statSync(file).isFile()) throw Error('Not a file: ' + file);
  const version = await execute(exe, ['--version'], opts.timeoutMs);
  const out = path.resolve(opts.out || path.join(ROOT, '.retort-data/voice-evaluations', new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8)));
  fs.mkdirSync(out, { recursive: true });
  // Never reuse output: a previous success must not masquerade as a failed new run.
  if (fs.readdirSync(out).length) throw Error('Use an empty output directory: ' + out);
  const metadata = { version: 1, startedAt: new Date().toISOString(), manifestPath, manifestHash: await digest(manifestPath),
    whisper: { exe, sha256: await digest(exe), version: (version.stdout + version.stderr).trim(), model, modelHash: await digest(model),
      language: 'en', temperature: 0, temperatureFallback: false, beamSize: 5, bestOf: 5, threads: opts.threads, expectedTextPrompt: false },
    notice: 'Offline intelligibility proxy only. No game state, voice defaults or chip registers are modified. Proper names and naturalness need listening judgments.' };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(selected, null, 2));
  const transcripts = {}, clips = [], failures = [];
  const report = () => ({ ...metadata, complete: failures.length === 0 && files.size === clips.length,
    clips, failures, scores: evaluate(selected, transcripts), sourceRelative: sourceGaps(selected, transcripts) });
  const save = () => {
    fs.writeFileSync(path.join(out, 'transcripts.json'), JSON.stringify(transcripts, null, 2));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report(), null, 2));
  };
  save();
  let i = 0;
  for (const [file, input] of files) {
    const prefix = path.join(out, 'clip-' + String(++i).padStart(3, '0')), started = Date.now();
    try {
      const hash = await digest(input);
      const result = await execute(exe, ['-m', model, '-f', input, '-t', String(opts.threads), '-l', 'en', '-tp', '0', '-nf', '-bs', '5', '-bo', '5', '-ojf', '-of', prefix], opts.timeoutMs);
      fs.writeFileSync(prefix + '.log', result.stderr + '\n' + result.stdout);
      if (await digest(input) !== hash) throw Error('Audio changed during evaluation: ' + file);
      const heard = readTranscript(JSON.parse(fs.readFileSync(prefix + '.json', 'utf8')));
      transcripts[file] = heard.text;
      clips.push({ file, audioHash: hash, elapsedMs: Date.now() - started, raw: path.basename(prefix) + '.json', ...heard });
      progress(`[${i}/${files.size}] ${file}: ${heard.text || '(no speech recognized)'}`);
    } catch (error) {
      failures.push({ file, error: error.message });
      progress(`[${i}/${files.size}] FAILED ${file}: ${error.message}`);
    }
    save();
  }
  return { out, ...report() };
}

if (require.main === module) {
  (async () => {
    const opts = options(process.argv.slice(2));
    if (opts.help) return console.log(USAGE);
    const result = await run(opts);
    console.log(JSON.stringify({ report: path.join(result.out, 'report.json'), summary: result.scores.summary, sourceRelative: result.sourceRelative.summary }, null, 2));
    if (!result.complete) process.exitCode = 1;
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { options, command, readTranscript, sourceGaps, audioPath, run };
