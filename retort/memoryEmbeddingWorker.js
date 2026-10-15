'use strict';
const fs = require('node:fs');

function tokenizer(vocabulary, maxLength = 256) {
  const vocab = new Map(vocabulary.trimEnd().split(/\r?\n/).map((word, i) => [word, i]));
  const unk = vocab.get('[UNK]'), cls = vocab.get('[CLS]'), sep = vocab.get('[SEP]');
  if (![unk, cls, sep, vocab.get('[PAD]')].every(Number.isInteger)) throw Error('Invalid BERT vocabulary.');
  return text => {
    const ids = [cls];
    const words = String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[\p{Cc}\p{Cf}]/gu, ' ').match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || [];
    for (const word of words) {
      const parts = []; let start = 0;
      if (word.length > 100) parts.push(unk);
      else while (start < word.length) {
        let end = word.length, id;
        while (end > start) {
          id = vocab.get((start ? '##' : '') + word.slice(start, end));
          if (id !== undefined) break;
          end--;
        }
        if (id === undefined) { parts.length = 0; parts.push(unk); break; }
        parts.push(id); start = end;
      }
      ids.push(...parts.slice(0, maxLength - 1 - ids.length));
      if (ids.length >= maxLength - 1) break;
    }
    ids.push(sep); return ids;
  };
}

function pool(data, dims, mask) {
  const [batch, length, width] = dims, vectors = [];
  for (let b = 0; b < batch; b++) {
    const vector = new Float32Array(width); let count = 0;
    for (let t = 0; t < length; t++) if (mask[b * length + t]) {
      count++;
      for (let d = 0; d < width; d++) vector[d] += data[(b * length + t) * width + d];
    }
    let norm = 0;
    for (let d = 0; d < width; d++) { vector[d] /= Math.max(1, count); norm += vector[d] ** 2; }
    norm = Math.sqrt(norm) || 1;
    vectors.push(Array.from(vector, value => value / norm));
  }
  return vectors;
}

async function serve(parentPort, modelDir) {
  const path = require('node:path'), ort = require('onnxruntime-node');
  const encode = tokenizer(fs.readFileSync(path.join(modelDir, 'vocab.txt'), 'utf8'));
  const session = await ort.InferenceSession.create(path.join(modelDir, 'model.onnx'), {
    executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1
  });
  parentPort.on('message', async ({ id, texts }) => {
    try {
      const rows = texts.map(encode), length = Math.max(...rows.map(row => row.length));
      const ids = new BigInt64Array(rows.length * length), mask = new BigInt64Array(ids.length);
      rows.forEach((row, b) => row.forEach((value, t) => { ids[b * length + t] = BigInt(value); mask[b * length + t] = 1n; }));
      const shape = [rows.length, length];
      const feeds = { input_ids: new ort.Tensor('int64', ids, shape), attention_mask: new ort.Tensor('int64', mask, shape) };
      if (session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(ids.length), shape);
      const outputs = await session.run(feeds), tokens = Object.values(outputs).find(value => value.dims.length === 3);
      if (!tokens || tokens.dims[2] !== 384) throw Error('Expected MiniLM token embeddings.');
      parentPort.postMessage({ id, vectors: pool(tokens.data, tokens.dims, mask) });
    } catch (error) { parentPort.postMessage({ id, error: error.message }); }
  });
  parentPort.postMessage({ ready: true });
}

module.exports = { tokenizer, pool };
const { isMainThread, parentPort, workerData } = require('node:worker_threads');
if (!isMainThread) serve(parentPort, workerData.modelDir).catch(error => { throw error; });
