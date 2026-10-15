'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const model = 'sentence-transformers/all-MiniLM-L6-v2', root = 'https://huggingface.co/';
const directory = path.join(__dirname, '..', 'models', 'memory');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
  return response;
}
(async () => {
  const metadata = await (await get(`${root}api/models/${model}?blobs=true`)).json();
  if (!/^[a-f0-9]{40}$/.test(metadata.sha)) throw Error('Missing immutable model revision.');
  const files = {}, downloads = [['onnx/model_quint8_avx2.onnx', 'model.onnx'], ['vocab.txt', 'vocab.txt']];
  fs.mkdirSync(directory, { recursive: true });
  for (const [source, name] of downloads) {
    const bytes = Buffer.from(await (await get(`${root}${model}/resolve/${metadata.sha}/${source}`)).arrayBuffer());
    const expected = metadata.siblings.find(row => row.rfilename === source)?.lfs?.sha256;
    if (expected && digest(bytes) !== expected) throw Error(`Downloaded checksum mismatch: ${source}`);
    fs.writeFileSync(path.join(directory, name + '.partial'), bytes);
    fs.renameSync(path.join(directory, name + '.partial'), path.join(directory, name));
    files[name] = digest(bytes); console.log(`${name}: ${bytes.length} bytes; SHA-256 verified`);
  }
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ model, revision: metadata.sha, files }, null, 2));
  console.log('Local semantic memory model installed. No API key or Python service required.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
