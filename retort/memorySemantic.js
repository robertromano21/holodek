'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function passages(row) {
  const sentences = row.text.match(/[^.!?\n]+(?:[.!?]+["'\u201d\u2019]*|$)/gu) || [row.text];
  const parts = []; let text = '';
  for (const sentence of sentences) {
    if (text && text.length + sentence.length > 420) { parts.push(text); text = ''; }
    for (let n = 0; n < sentence.length; n += 420) {
      const part = sentence.slice(n, n + 420).trim();
      if (text && text.length + part.length > 420) { parts.push(text); text = ''; }
      text += (text ? ' ' : '') + part;
    }
  }
  if (text) parts.push(text);
  return parts.map(part => [row.roomName, row.speaker, part].filter(Boolean).join('\n'));
}

function createService({ modelDir = path.join(__dirname, '..', 'models', 'memory'),
  cacheDir = path.join(__dirname, '..', '.retort-data', 'memory-vectors'), embed, logger = console } = {}) {
  let worker, ready, sequence = 0, status, chain = Promise.resolve();
  const pending = new Map(), vectors = new Map();
  const manifestPath = path.join(modelDir, 'manifest.json');
  const configured = !!embed || fs.existsSync(manifestPath);
  let modelKey;
  function report(value, extra = {}) {
    if (status === value) return;
    status = value; logger.info('[SemanticMemory]', JSON.stringify({ status: value, ...extra }));
  }
  function start() {
    if (ready) return ready;
    ready = (async () => {
      if (!configured) { report('not-installed'); return; }
      if (embed) { modelKey = 'test-encoder'; return; }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const file of ['model.onnx', 'vocab.txt']) {
        if (digest(fs.readFileSync(path.join(modelDir, file))) !== manifest.files?.[file]) throw Error(`Memory model checksum mismatch: ${file}`);
      }
      modelKey = digest(JSON.stringify(manifest));
      worker = new Worker(path.join(__dirname, 'memoryEmbeddingWorker.js'), { workerData: { modelDir } });
      worker.unref();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Local memory model startup timed out.')), 30000);
        worker.on('message', message => {
          if (message.ready) { clearTimeout(timer); resolve(); return; }
          const task = pending.get(message.id);
          if (!task) return;
          pending.delete(message.id); clearTimeout(task.timer);
          message.error ? task.reject(Error(message.error)) : task.resolve(message.vectors);
          if (!pending.size) worker.unref();
        });
        worker.on('error', error => { clearTimeout(timer); reject(error); for (const task of pending.values()) { clearTimeout(task.timer); task.reject(error); } pending.clear(); });
        worker.on('exit', code => {
          clearTimeout(timer);
          const error = Error(`Local memory worker exited (${code}).`);
          reject(error);
          for (const task of pending.values()) { clearTimeout(task.timer); task.reject(error); }
          pending.clear();
        });
      });
      report('ready', { model: manifest.model, revision: manifest.revision });
    })();
    return ready;
  }
  async function encode(texts) {
    if (embed) return embed(texts);
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Local memory encoding timed out.')); }, 30000);
      pending.set(id, { resolve, reject, timer }); worker.ref(); worker.postMessage({ id, texts });
    });
  }
  async function vectorize(texts) {
    const keys = texts.map(text => digest(modelKey + text)), missing = new Map();
    for (let i = 0; i < keys.length; i++) if (!vectors.has(keys[i])) {
      const file = path.join(cacheDir, keys[i] + '.bin');
      const bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
      if (bytes?.length === 384 * 4) {
        const vector = Array.from({ length: 384 }, (_, n) => bytes.readFloatLE(n * 4));
        if (vector.every(Number.isFinite)) { vectors.set(keys[i], vector); continue; }
      }
      missing.set(keys[i], texts[i]);
    }
    const entries = [...missing];
    for (let i = 0; i < entries.length; i += 8) {
      const batch = entries.slice(i, i + 8), encoded = await encode(batch.map(([, text]) => text));
      if (encoded.length !== batch.length) throw Error('Incomplete local memory embeddings.');
      for (let j = 0; j < batch.length; j++) {
        const vector = encoded[j];
        if (vector.length !== 384 || !vector.every(Number.isFinite)) throw Error('Invalid local memory embedding.');
        const norm = Math.hypot(...vector) || 1, normalized = vector.map(value => value / norm);
        vectors.set(batch[j][0], normalized);
        const bytes = Buffer.alloc(384 * 4); normalized.forEach((value, n) => bytes.writeFloatLE(value, n * 4));
        fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(path.join(cacheDir, batch[j][0] + '.bin'), bytes);
      }
    }
    const result = keys.map(key => vectors.get(key));
    // Disk remains the disposable long-term vector cache; RAM does not grow with a campaign forever.
    while (vectors.size > 24576) vectors.delete(vectors.keys().next().value);
    return result;
  }
  function rank(query, records) {
    const work = async () => {
      const started = Date.now();
      try {
        await start();
        if (!configured || !query?.trim()) return new Map();
        const rows = records.filter(row => row.kind !== 'biography');
        const fragments = rows.flatMap(row => passages(row).map(text => ({ row, text })));
        const encoded = await vectorize([query.slice(0, 1200), ...fragments.map(part => part.text)]), target = encoded[0];
        const scores = new Map();
        fragments.forEach(({ row }, i) => {
          const score = encoded[i + 1].reduce((sum, value, d) => sum + value * target[d], 0);
          scores.set(row.id, Math.max(scores.get(row.id) ?? -1, score));
        });
        // Return a matching exchange's response too, rather than a lone question or aside.
        const episodes = new Map();
        for (const row of rows) {
          const key = `${row.runId}:${row.roomKey}:${row.turn}`;
          episodes.set(key, Math.max(episodes.get(key) ?? -1, scores.get(row.id) ?? -1));
        }
        for (const row of rows) if (row.kind === 'room-history' && row.source === 'room-turn-narrative') {
          scores.set(row.id, Math.max(scores.get(row.id) ?? -1, .98 * episodes.get(`${row.runId}:${row.roomKey}:${row.turn}`)));
        }
        const ranked = [...scores]
          .filter(([, score]) => score >= .25).sort((a, b) => b[1] - a[1]).slice(0, 24);
        logger.info('[SemanticRecall]', JSON.stringify({ query: query.slice(0, 400), records: rows.length,
          ms: Date.now() - started, matches: ranked.map(([id, similarity]) => ({ id, similarity: Math.round(similarity * 1000) / 1000 })) }));
        return new Map(ranked);
      } catch (error) {
        report('error', { error: error.message, keywordRecall: 'still-active' });
        return new Map();
      }
    };
    const result = chain.then(work); chain = result.catch(() => {}); return result;
  }
  return { rank, close: async () => { if (worker) await worker.terminate(); }, configured };
}

let service;
module.exports = { createService, passages, rank: (query, records) => (service ||= createService()).rank(query, records) };
