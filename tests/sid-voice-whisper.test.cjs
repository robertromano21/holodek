'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { options, command, readTranscript, sourceGaps, audioPath, run } = require('../tools/whisper-sid-voices.cjs');

test('Whisper options reject unknown flags, missing values and invalid CPU budgets', () => {
  assert.equal(options(['--help']).help, true);
  assert.equal(options(['--threads', '2', '--character', 'Vessa Reedwake']).threads, 2);
  for (const args of [['--prompt', 'The gods'], ['--manifest'], ['--threads', '0'], ['--threads', '2.5']]) assert.throws(() => options(args));
});

test('Whisper segments retain ASR timings without treating special tokens as heard text', () => {
  const r = readTranscript({ transcription: [{ text: ' The gods ', offsets: { from: 0, to: 1500 }, tokens: [{ text: ' gods', p: .7 }] }, { text: ' know grief.' }] });
  assert.equal(r.text, 'The gods know grief.');
  assert.equal(r.segments[0].tokens[0].probability, .7);
  assert.deepEqual(r.segments[0].offsets, { from: 0, to: 1500 });
  assert.equal(readTranscript({ transcription: [] }).text, '');
  assert.throws(() => readTranscript({}), /Invalid Whisper/);
  assert.throws(() => readTranscript({ transcription: [{ nope: 'not text' }] }), /Invalid Whisper/);
});

test('source deltas use only complete matched sets, not another character or take', () => {
  const m = { text: 'The gods know grief.', characters: [
    { name: 'A', line: 'one', sourceHash: 'source-a', variants: { reference: { file: 'r.wav' }, legacy: { file: 'l.wav' }, detail: { file: 'd.wav' } } },
    { name: 'B', line: 'one', sourceHash: 'source-b', variants: { reference: { file: 'br.wav' }, detail: { file: 'bd.wav' } } }
  ] };
  const tr = { 'r.wav': 'The gods know grief.', 'l.wav': 'The dogs know grief.', 'd.wav': 'The gods know grief.', 'bd.wav': 'The dogs know grief.' };
  const result = sourceGaps(m, tr);
  assert.equal(result.pairs.length, 2);
  assert.equal(result.summary.legacy.addedErrors, 1);
  assert.equal(result.summary.detail.deltaWer, 0);
  assert.equal(result.pairs[0].sourceHash, 'source-a');
  assert.deepEqual(result.pairs[0].sourceToSidEdits[0], { type: 'substitution', expected: 'gods', heard: 'dogs', referenceIndex: 1, hypothesisIndex: 1 });
  assert.equal(sourceGaps(m, { ...tr, 'd.wav': undefined }).pairs.length, 0);
});

test('manifest audio paths cannot escape the audition directory', () => {
  const dir = path.resolve('sid/voice-auditions');
  assert.equal(audioPath(dir, 'clip.wav'), path.join(dir, 'clip.wav'));
  assert.throws(() => audioPath(dir, '../outside.wav'), /inside/);
  assert.throws(() => audioPath(dir, 'clip.sidvoice'), /WAV/);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sid-whisper-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifest = path.join(dir, 'manifest.json'), model = path.join(dir, 'model.bin');
  fs.writeFileSync(model, 'fake ASR model - tests never use it for recognition');
  for (const file of ['source & guide.wav', 'legacy.wav', 'detail.wav']) fs.writeFileSync(path.join(dir, file), 'fixture audio');
  fs.writeFileSync(manifest, JSON.stringify({ text: 'The gods know grief.', characters: [{ name: 'Test', line: 'hard-words', sourceHash: 'take-1', variants: {
    reference: { file: 'source & guide.wav' }, legacy: { file: 'legacy.wav' }, detail: { file: 'detail.wav' }
  } }] }));
  const opts = { manifest, exe: process.execPath, model, out: path.join(dir, 'results'), threads: 2, timeoutMs: 5000 };
  const calls = [];
  const execute = async (exe, args) => {
    calls.push(args);
    if (args[0] === '--version') return { stdout: 'fixture only', stderr: '' };
    const input = args[args.indexOf('-f') + 1], prefix = args[args.indexOf('-of') + 1];
    const text = input.endsWith('legacy.wav') ? 'The dogs know grief.' : 'The gods know grief.';
    fs.writeFileSync(prefix + '.json', JSON.stringify({ transcription: [{ text }] }));
    return { stdout: '', stderr: 'fixture only' };
  };
  return { opts, calls, execute };
}

test('local runner records provenance, keeps each clip independent, and never supplies expected text', async t => {
  const f = fixture(t), result = await run(f.opts, f.execute, () => {});
  assert.equal(result.complete, true);
  assert.equal(result.clips.length, 3);
  assert.match(result.clips[0].audioHash, /^[0-9a-f]{64}$/);
  assert.equal(result.scores.summary.legacy.wer, .25);
  assert.equal(result.sourceRelative.summary.legacy.addedErrors, 1);
  assert.equal(result.whisper.expectedTextPrompt, false);
  for (const args of f.calls.slice(1)) {
    assert.ok(args.includes('-nf'));
    assert.ok(args.includes('-ojf'));
    assert.ok(!args.includes('--prompt'));
    assert.ok(!args.includes('--grammar'));
    assert.equal(args.filter(x => x.endsWith('.wav')).length, 1);
    assert.ok(!args.includes('The gods know grief.'));
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.out, 'transcripts.json')))['legacy.wav'], 'The dogs know grief.');
  await assert.rejects(run(f.opts, f.execute, () => {}), /empty output/);
});

test('process failure cannot use stale output or contribute an unmatched success to summary', async t => {
  const f = fixture(t), execute = async (exe, args) => {
    if (args.includes(path.join(path.dirname(f.opts.manifest), 'legacy.wav'))) throw Error('fixture recognition failure');
    return f.execute(exe, args);
  };
  const result = await run(f.opts, execute, () => {});
  assert.equal(result.complete, false);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /recognition failure/);
  assert.deepEqual(result.scores.summary, {});
  assert.deepEqual(result.scores.missing, ['legacy.wav']);
  assert.deepEqual(result.sourceRelative.pairs, []);
});

test('process wrapper reports nonzero exits and terminates timed-out children', async () => {
  await assert.rejects(command(process.execPath, ['-e', 'process.exit(7)'], 5000), /exited 7/);
  await assert.rejects(command(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], 150), /timed out/);
});
