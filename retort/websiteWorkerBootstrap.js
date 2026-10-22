'use strict';
function bootstrap() {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; if (input.length > 1024 * 1024) process.exit(1); });
  process.stdin.on('end', async () => {
    try {
      const packet = JSON.parse(input), directory = path.join(os.homedir(), '.holodek-worker'), main = path.join(directory, 'worker.cjs');
      const files = { 'worker.cjs': packet.code, ...(packet.files || {}) };
      if (Object.keys(files).some(file => !['worker.cjs', 'workerPool.cjs', 'roomWire.cjs', 'roomTask.cjs'].includes(file)) ||
          crypto.createHash('sha256').update(packet.code).digest('hex') !== packet.hash) throw Error('Worker bundle checksum mismatch.');
      for (const [name, content] of Object.entries(files)) if (typeof content !== 'string' ||
        crypto.createHash('sha256').update(content).digest('hex') !== packet.hashes?.[name]) throw Error('Worker source checksum mismatch.');
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (fs.lstatSync(directory).isSymbolicLink()) throw Error('Unsafe worker directory.');
      if (packet.engineHash) {
        if (!/^[a-f0-9]{64}$/.test(packet.engineHash)) throw Error('Invalid room engine version.');
        const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'engines', packet.engineHash, '.installed.json'), 'utf8'));
        if (receipt.hash !== packet.engineHash || !receipt.ready) throw Error('Room engine preflight did not pass.');
      }
      if (fs.existsSync(main)) {
        if (!/HOLODEK_WEBSITE_WORKER_V[12]/.test(fs.readFileSync(main, 'utf8'))) throw Error('Destination belongs to another application.');
        const state = await require(main).rpc({ operation: 'status' });
        // An exact healthy release can be reused without touching its active jobs.
        const expectedBundle = crypto.createHash('sha256').update(['worker.cjs', 'workerPool.cjs', 'roomTask.cjs', 'roomWire.cjs']
          .map(name => name + '\n' + files[name]).join('\n')).digest('hex');
        const runtimeReady = node => node && Number.isInteger(node.port) && node.port > 0 && node.port <= 65535 &&
          node.bundleHash === expectedBundle &&
          Number(String(node.node).replace(/^v/, '').split('.')[0]) >= 22 &&
          (!packet.engineHash || node.engineHash === packet.engineHash);
        const sourcesMatch = Object.keys(files).length === 4 && Object.entries(files).every(([name]) => {
          const target = path.join(directory, name);
          return fs.existsSync(target) && !fs.lstatSync(target).isSymbolicLink() &&
            crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') === packet.hashes[name];
        });
        const compatible = sourcesMatch && state.version === 1 && Number.isInteger(state.port) && state.port > 0 && state.port <= 65535 &&
          runtimeReady(state) && state.roomWorkers === 3 && Array.isArray(state.pool) && state.pool.length === 3 &&
          new Set(state.pool.map(node => node.port)).size === 3 && state.pool.every(runtimeReady);
        if (compatible) { process.stdout.write(JSON.stringify({ value: state })); return; }
        if (state.active || state.queued || state.computeActive || state.computeQueued) throw Error('Worker deployment deferred until current jobs finish.');
      }
      const backup = path.join(directory, 'backups', String(Date.now()));
      fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
      for (const file of [...Object.keys(files), 'active-engine.json', 'pool.json']) {
        const target = path.join(directory, file);
        if (fs.existsSync(target)) {
          if (fs.lstatSync(target).isSymbolicLink()) throw Error('Unsafe worker file.');
          fs.copyFileSync(target, path.join(backup, file));
          const digest = value => crypto.createHash('sha256').update(fs.readFileSync(value)).digest('hex');
          if (digest(target) !== digest(path.join(backup, file))) throw Error('Worker backup checksum mismatch.');
        }
      }
      for (const [name, code] of Object.entries(files)) {
        if (typeof code !== 'string' || code.length > 250000) throw Error('Invalid worker source.');
        new (require('node:vm').Script)(code, { filename: name });
        const target = path.join(directory, name), temporary = target + '.tmp';
        fs.writeFileSync(temporary, code, { mode: 0o600 }); fs.renameSync(temporary, target);
      }
      if (packet.engineHash) {
        const target = path.join(directory, 'active-engine.json');
        fs.writeFileSync(target + '.tmp', JSON.stringify({ hash: packet.engineHash }), { mode: 0o600 }); fs.renameSync(target + '.tmp', target);
      }
      const result = require('node:child_process').spawnSync(process.execPath, [main, '--start'], { encoding: 'utf8', timeout: 90000 });
      process.stdout.write(result.stdout || JSON.stringify({ error: 'Worker pool setup failed.' })); process.exitCode = result.status || 0;
    } catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); process.exitCode = 1; }
  });
}
module.exports = { source: () => '(' + bootstrap.toString() + ')();' };
