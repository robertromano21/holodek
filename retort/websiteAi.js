'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), net = require('node:net');
const { spawn } = require('node:child_process');
const { AsyncLocalStorage } = require('node:async_hooks');
const DEFAULTS = Object.freeze({ enabled: false, host: '', sshPort: 22, username: 'holodek-agent',
  fingerprint: '', background: false, useForGameModels: false, remoteBuild: false });
const MAX_BYTES = 4 * 1024 * 1024;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const shellQuote = value => "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
const problem = message => Object.assign(Error(message), { status: 400 });
function normalize(raw = {}) {
  const c = { ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).filter(k => Object.hasOwn(raw, k)).map(k => [k, raw[k]])) };
  for (const key of ['enabled', 'background', 'useForGameModels', 'remoteBuild']) if (typeof c[key] !== 'boolean') throw problem('Connection switches must be true or false.');
  c.host = String(c.host).trim(); c.username = String(c.username).trim(); c.fingerprint = String(c.fingerprint).trim();
  if (c.host && !(net.isIP(c.host) || c.host.length <= 253 && c.host.split('.').every(s => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(s)))) throw problem('Enter an IP address or hostname, not a URL or command.');
  if (!Number.isInteger(c.sshPort) || c.sshPort < 1 || c.sshPort > 65535) throw problem('SSH port must be between 1 and 65535.');
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(c.username)) throw problem('Enter a valid non-root Linux username.');
  if (c.username === 'root') throw problem('Use a dedicated non-root SSH account.');
  if (c.fingerprint && !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(c.fingerprint)) throw problem('Enter the SHA256 SSH host fingerprint from the server terminal.');
  if (c.enabled && (!c.host || !c.fingerprint)) throw problem('A server address and verified host fingerprint are required.');
  return c;
}
function trustedHost(scan, fingerprint) {
  for (const line of String(scan).split(/\r?\n/)) {
    const p = line.trim().split(/\s+/); if (p[1] !== 'ssh-ed25519' || !/^[A-Za-z0-9+/]+={0,2}$/.test(p[2] || '')) continue;
    const actual = 'SHA256:' + crypto.createHash('sha256').update(Buffer.from(p[2], 'base64')).digest('base64').replace(/=+$/, '');
    if (actual === fingerprint.replace(/=+$/, '')) return 'holodek-website-ai ssh-ed25519 ' + p[2] + '\n';
  }
  throw problem('SSH host fingerprint did not match. No credentials were sent.');
}
function localRequest(req) {
  const address = req.socket?.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
  try {
    const host = req.headers?.host || '', base = new URL('http://' + host);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) return false;
    if (req.headers.origin && new URL(req.headers.origin).host !== base.host) return false;
    return req.headers['sec-fetch-site'] !== 'cross-site';
  } catch { return false; }
}
function launch(executable, args, { input = '', timeout = 20000, signal, onLine, maxBytes = MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '', size = 0, failure, pending = '';
    const decoder = new (require('node:string_decoder').StringDecoder)('utf8');
    const abort = () => { failure = Error('Website worker request cancelled.'); child.kill(); };
    const timer = setTimeout(() => { failure = Error('Website worker timed out.'); child.kill(); }, timeout);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { failure = Error('Website worker response is too large.'); child.kill(); return; }
      if (!onLine) { output += chunk; return; }
      pending += decoder.write(chunk);
      let at;
      while ((at = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        if (line.trim()) try { onLine(line); } catch (error) { failure = error; child.kill(); return; }
      }
    });
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8192); });
    child.on('error', () => { failure = Error('OpenSSH could not be started. Install the OpenSSH client.'); });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (onLine && (pending += decoder.end()).trim() && !failure) try { onLine(pending); } catch (error) { failure = error; }
      if (failure) return reject(failure);
      if (code !== 0 && !output.trim().startsWith('{')) return reject(Error(/Permission denied/i.test(diagnostics) ?
        'SSH login rejected. Install the displayed public key for this non-root account.' : /REMOTE HOST IDENTIFICATION|Host key verification/.test(diagnostics) ?
        'SSH host verification failed. Recheck the server fingerprint.' : 'The website SSH command failed; check the account, address and SSH port.'));
      resolve(output);
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
function createService({ directory = process.env.HOLODEK_WEBSITE_AI_DIR || path.join(__dirname, '../.retort-data/website-ai'),
  run = launch, env = process.env, source = path.join(__dirname, '../tools/website-worker/worker.cjs'),
  engineRoot = path.join(__dirname, '..'), engineSupportRoot, connectionWaitMs = 120000,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, logger = console } = {}) {
  if (!Number.isFinite(connectionWaitMs) || connectionWaitMs < 0 || connectionWaitMs > 300000) throw Error('Invalid bounded website connection wait.');
  const configFile = path.join(directory, 'connection.json');
  const actions = new AsyncLocalStorage();
  let config = { ...DEFAULTS }, identityFile = path.join(directory, 'identity_ed25519'), revision = 0, connection = null, connecting = false, reconnecting = null, connectionProgress = null, verifiedConnection = null;
  const connectionIdentity = value => digest(JSON.stringify([value?.version,value?.port,value?.bundleHash,value?.engineHash,value?.roomWorkers,
    value?.pool?.map(node=>[node.slot,node.node,node.bundleHash,node.engineHash])]));
  if (fs.existsSync(configFile)) {
    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8')); config = normalize(saved);
    if (typeof saved.identityFile === 'string' && path.isAbsolute(saved.identityFile)) identityFile = saved.identityFile;
  }
  const exe = name => process.platform === 'win32' ? path.join(env.WINDIR || 'C:/Windows', 'System32/OpenSSH', name + '.exe') : name;
  function privateWrite(file, content) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, content, { mode: 0o600 }); fs.renameSync(temporary, file);
  }
  async function publicKey() {
    if (fs.existsSync(identityFile) !== fs.existsSync(identityFile + '.pub')) throw problem('Incomplete SSH key pair; existing keys were not overwritten.');
    if (!fs.existsSync(identityFile)) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      await run(exe('ssh-keygen'), ['-q', '-t', 'ed25519', '-f', identityFile, '-N', '', '-C', 'holodek-website-worker']);
    }
    return fs.readFileSync(identityFile + '.pub', 'utf8').trim();
  }
  const hostFile = c => path.join(directory, 'host-' + digest(JSON.stringify([c.host, c.sshPort, c.fingerprint])).slice(0, 16));
  function sshArgs(c, command) {
    return ['-T', '-i', identityFile, '-p', String(c.sshPort), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=yes', '-o', 'HostKeyAlias=holodek-website-ai', '-o', 'UserKnownHostsFile=' + hostFile(c),
      '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', c.username + '@' + c.host, command];
  }
  async function request(c, packet, options = {}) {
    if (!c.host || !fs.existsSync(identityFile) || !fs.existsSync(hostFile(c))) throw problem('Connect and verify Website AI before sending jobs.');
    const output = await run(exe('ssh'), sshArgs(c, 'if [ -x "$HOME/.holodek-worker/node" ]; then exec "$HOME/.holodek-worker/node" "$HOME/.holodek-worker/worker.cjs" --rpc; else exec node "$HOME/.holodek-worker/worker.cjs" --rpc; fi'), {
      input: JSON.stringify(packet), timeout: 615000, ...options });
    let parsed; try { parsed = JSON.parse(output); } catch { throw Error('Website worker returned an invalid response.'); }
    if (parsed.error) throw require('../tools/website-worker/worker.cjs').failureFrom(parsed); return parsed.value;
  }
  async function runRoomStage(job, snapshot, { signal, background = true, onCheckpoint } = {}) {
    await ensureConnected();
    if (!remoteBuildEnabled()) throw Error('The website room engine is not ready.');
    require('./roomEngineCompatibility').assertCompatible(connection, require('./websiteEngineBundle').build(engineRoot, { supportRoot: engineSupportRoot }).hash);
    const beforeRevision = revision, profile = require('./gameModels').profile(job.model), pcModel = job.model === 'holodek-1';
    const provider = pcModel || profile.local ? 'ollama' : profile.provider || 'openai', key = credential(provider);
    if (provider !== 'ollama' && !key) throw Error('The selected provider needs a key configured on this PC.');
    const flags = Object.fromEntries(Object.entries(require('./worldFlags').snapshot()).map(([name, on]) => ['HOLODEK_' + name, on ? '1' : '0']));
    const Wire = require('../tools/website-worker/roomWire.cjs');
    const packet = { operation: 'room-stage', engineHash: connection.engineHash, background,
      ...(pcModel ? { pcModel: 'holodek-1' } : {}),
      payload: Wire.pack({ job, snapshot, flags, provider, ...(pcModel ? { pcModel: 'holodek-1' } : {}), ...(key ? { credential: key } : {}) }) };
    const controller = new AbortController(), requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const replies = new Set(), requests = new Set();
    let complete = false, checkpoints = 0, relayFailure;
    async function answer(message) {
      let result, error;
      try { result = await require('./pcModelHost').complete(message.body, { signal: requestSignal, background }); }
      catch (failure) { relayFailure ||= failure; error = String(failure.message).slice(0, 500); }
      if (requestSignal.aborted) return;
      await request(config, { operation: 'pc-model-response', session: message.session, id: message.id,
        ...(error ? { error } : { result }) }, { signal: requestSignal, timeout: 30000 });
    }
    try {
      await run(exe('ssh'), sshArgs(config, '"$HOME/.holodek-worker/node" "$HOME/.holodek-worker/worker.cjs" --stream'), {
        input: JSON.stringify(packet), timeout: 1215000, signal: requestSignal, maxBytes: 64 * 1024 * 1024,
        onLine: line => {
          if (revision !== beforeRevision || !config.enabled || !config.remoteBuild) throw Error('Website connection changed during room build.');
          const message = JSON.parse(line);
          if (message.error || message.type === 'failed') throw require('../tools/website-worker/worker.cjs').failureFrom({ ...message,error:message.error || message.reason || 'Remote room stage failed.' });
          if (message.type === 'pc-model-request') {
            if (!pcModel || !/^[a-f0-9]{48}$/.test(message.session || '') || !/^[a-f0-9]{24}$/.test(message.id || '') ||
                message.body?.model !== 'holodek-1' || requests.has(message.id) || requests.size >= 1024 || replies.size >= 8)
              throw Error('Invalid PC model request from room worker.');
            requests.add(message.id);
            const reply = answer(message).catch(error => { relayFailure = error; controller.abort(); }).finally(() => replies.delete(reply));
            replies.add(reply);
          } else if (message.type === 'checkpoint') { const result = Wire.unpack(message.value); checkpoints++; onCheckpoint?.(result); }
          else if (message.type === 'done') complete = true;
          else throw Error('Unknown remote room message.');
        }
      });
      await Promise.all(replies);
      if (relayFailure) throw relayFailure;
      if (!complete || checkpoints !== 1) throw Error('Remote room stage returned an incomplete result.');
    } catch (error) { controller.abort(); error = relayFailure || error; if (key) error.message = error.message.split(key).join('[redacted]'); throw error; }
  }
  const view = () => ({ ...config, revision, connecting, connectionProgress, connected: !!connection,
    worker: connection, storage: '.retort-data/website-ai/connection.json', credentials: 'PC environment / keys; sent through SSH in memory only' });
  async function connect(raw, { deploy = false } = {}) {
    if (connecting) throw problem('A connection check is already running.');
    const candidate = normalize(raw);
    if (!candidate.host || !candidate.fingerprint) throw problem('A server address and verified host fingerprint are required.');
    const startRevision = revision; connecting = true;
    try {
      await publicKey();
      const scan = await run(exe('ssh-keyscan'), ['-T', '5', '-p', String(candidate.sshPort), '-t', 'ed25519', candidate.host]);
      privateWrite(hostFile(candidate), trustedHost(scan, candidate.fingerprint));
      let value, expectedEngineHash, expectedWorkerHash;
      if (deploy) {
        const code = fs.readFileSync(source, 'utf8');
        const files = Object.fromEntries(['workerPool.cjs', 'roomWire.cjs', 'roomTask.cjs'].map(name => [name, fs.readFileSync(path.join(path.dirname(source), name), 'utf8')]));
        const allFiles = { 'worker.cjs': code, ...files };
        expectedWorkerHash = digest(['worker.cjs', 'workerPool.cjs', 'roomTask.cjs', 'roomWire.cjs'].map(name => name + '\n' + allFiles[name]).join('\n'));
        let bundle;
        const remoteNode = 'if [ -x "$HOME/.holodek-worker/node" ]; then "$HOME/.holodek-worker/node"';
        if (candidate.remoteBuild) {
          const Engine = require('./websiteEngineBundle');
          bundle = Engine.build(engineRoot, { supportRoot: engineSupportRoot });
          expectedEngineHash = bundle.hash;
        }
        const compatible = status => status?.version === 1 && status.bundleHash === expectedWorkerHash &&
          Number.isInteger(status.port) && status.port > 0 && status.port <= 65535 &&
          (!candidate.remoteBuild || status.roomWorkers === 3 && status.engineHash === expectedEngineHash &&
            status.pool?.length === 3 && status.pool.every(node => node.engineHash === expectedEngineHash && node.bundleHash === expectedWorkerHash &&
              Number(String(node.node).replace(/^v/, '').split('.')[0]) >= 22));
        const busy = status => [status,...(Array.isArray(status?.pool) ? status.pool : [])].some(node =>
          ['active','queued','computeActive','computeQueued'].some(field => Number(node?.[field]) > 0));
        const started = now(); let waits = 0;
        const waitForIdle = async () => {
          if (revision !== startRevision) throw Object.assign(Error('Website connection changed during setup.'), { code:'WEBSITE_CONNECTION_STALE', recoverable:false });
          const elapsedMs = now() - started;
          if (elapsedMs >= connectionWaitMs || waits >= Math.ceil(connectionWaitMs / 1000))
            throw Object.assign(Error('Website helpers are still busy; deployment was deferred without interrupting their jobs. Try again after they finish.'), { code:'WEBSITE_DEPLOY_BUSY', recoverable:false });
          connectionProgress = { phase:'waiting-idle', elapsedMs };
          if (waits++ % 15 === 0) logger.info('[WebsiteConnection]', JSON.stringify(connectionProgress));
          await delay(Math.min(1000, connectionWaitMs - elapsedMs));
        };
        while (!value) {
          if (revision !== startRevision) throw Object.assign(Error('Website connection changed during setup.'), { code:'WEBSITE_CONNECTION_STALE', recoverable:false });
          let current; try { current = await request(candidate, { operation:'status' }, { timeout:15000 }); } catch { /* First installation has no worker yet. */ }
          if (compatible(current)) { value = current; logger.info('[WebsiteConnection]', JSON.stringify({ phase:'reused-compatible' })); break; }
          if (busy(current)) { await waitForIdle(); continue; }
          connectionProgress = { phase:'deploying', elapsedMs:now() - started };
          try {
            if (bundle) {
              const Engine = require('./websiteEngineBundle');
              const installer = shellQuote(Engine.installerSource());
              const installed = await run(exe('ssh'), sshArgs(candidate, remoteNode + ' -e ' + installer + '; else node -e ' + installer + '; fi'), {
                input: JSON.stringify({ hash: bundle.hash, archive: bundle.bytes.toString('base64') }), timeout: 360000 });
              let report; try { report = JSON.parse(installed); } catch { throw Error('Room engine installation returned an invalid response.'); }
              if (report.error || !report.value?.ready || report.value.hash !== bundle.hash) throw Error(report.error || 'Room engine preflight failed.');
            }
            const bootstrap = shellQuote(require('./websiteWorkerBootstrap').source());
            const output = await run(exe('ssh'), sshArgs(candidate, remoteNode + ' -e ' + bootstrap + '; else node -e ' + bootstrap + '; fi'), {
              input: JSON.stringify({ code, hash: digest(code), files, hashes: Object.fromEntries(Object.entries(allFiles).map(([name, content]) => [name, digest(content)])), ...(bundle ? { engineHash: bundle.hash } : {}) }), timeout: 105000 });
            let result; try { result = JSON.parse(output); } catch { throw Error('Website worker setup returned an invalid response.'); }
            if (result.error) throw Error(result.error); value = result.value;
          } catch (error) {
            if (!/Worker deployment deferred until current jobs finish\./.test(error.message)) throw error;
            await waitForIdle();
          }
        }
        if (candidate.remoteBuild && !compatible(value)) throw Error('Website engine, Node runtime or worker source checksum mismatch.');
      } else value = await request(candidate, { operation: 'status' });
      if (value?.version !== 1 || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw Error('Website worker protocol or port could not be verified.');
      if (candidate.remoteBuild && (value.roomWorkers !== 3 || !/^[a-f0-9]{64}$/.test(value.engineHash || ''))) throw Error('The three website room workers are not ready.');
      if (candidate.remoteBuild && deploy && (value.engineHash !== expectedEngineHash || value.bundleHash !== expectedWorkerHash ||
          value.pool?.some(node => node.engineHash !== expectedEngineHash || node.bundleHash !== expectedWorkerHash ||
            !(Number(String(node.node).replace(/^v/, '').split('.')[0]) >= 22)))) throw Error('Website engine, Node runtime or worker source checksum mismatch.');
      if (revision !== startRevision) throw problem('Website connection changed during setup; connect again.');
      if (JSON.stringify(config) !== JSON.stringify(candidate)) revision++;
      config = candidate; connection = value; verifiedConnection = deploy ? connectionIdentity(value) : null;
      privateWrite(configFile, JSON.stringify({ ...config, identityFile }, null, 2) + '\n'); return view();
    } finally { connecting = false; connectionProgress = null; }
  }
  function disable() {
    config = { ...config, enabled: false, background: false, useForGameModels: false, remoteBuild: false }; connection = null; verifiedConnection = null; revision++;
    privateWrite(configFile, JSON.stringify({ ...config, identityFile }, null, 2) + '\n'); return view();
  }
  async function status() {
    if (!config.host) return view();
    try {
      const value = await request(config, { operation: 'status' });
      if (value?.version !== 1 || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
          config.remoteBuild && (value.roomWorkers !== 3 || !/^[a-f0-9]{64}$/.test(value.engineHash || '')))
        throw Error('Website worker status is incomplete or outdated.');
      connection = value;
    }
    catch { connection = null; } return view();
  }
  function credential(provider) {
    const name = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'xai' ? 'XAI_API_KEY' : provider === 'groq' ? 'GROQ_API_KEY' : null;
    if (!name) return undefined;
    if (env[name]) return env[name];
    const file = path.join(env.HOLODEK_KEY_DIR || path.join(__dirname, '../keys'), provider + '.key');
    try { return fs.readFileSync(file, 'utf8').trim(); } catch { return undefined; }
  }
  async function ensureConnected() {
    if (reconnecting) return reconnecting;
    if (connection && connectionIdentity(connection) === verifiedConnection) return;
    if (connection) {
      if (config.remoteBuild) require('./roomEngineCompatibility').assertCompatible(connection,
        require('./websiteEngineBundle').build(engineRoot, { supportRoot:engineSupportRoot }).hash);
      const names = ['worker.cjs','workerPool.cjs','roomTask.cjs','roomWire.cjs'];
      const hash = digest(names.map(name=>name+'\n'+fs.readFileSync(path.join(path.dirname(source),name),'utf8')).join('\n'));
      if (connection.bundleHash !== hash || config.remoteBuild && (connection.pool?.length !== 3 || connection.pool.some(node=>node.bundleHash!==hash || !(Number(String(node.node).replace(/^v/,'').split('.')[0])>=22))))
        throw Object.assign(Error('Website worker sources do not match this game. Reconnect Website AI when the helpers are idle.'),{code:'WEBSITE_WORKER_MISMATCH',recoverable:false});
      verifiedConnection = connectionIdentity(connection); return;
    }
    const work = reconnecting = connect(config, { deploy: true });
    try { await work; } finally { if (reconnecting === work) reconnecting = null; }
  }
  async function generate({ provider, body, signal, expectedRevision, background = actions.getStore()?.background === true }) {
    if (!config.enabled) throw Error('Website AI is disabled.');
    await ensureConnected();
    if ((expectedRevision ?? actions.getStore()?.revision ?? revision) !== revision) throw Error('Website connection changed; retry this action.');
    if (!['openai', 'xai', 'groq', 'ollama'].includes(provider)) throw Error('Unsupported website provider.');
    if (provider === 'ollama' && body?.model === 'holodek-1' && process.env.HOLODEK_REMOTE_ENGINE !== '1')
      return require('./pcModelHost').complete(body, { signal, background });
    const key = credential(provider);
    if (provider !== 'ollama' && !key) throw Error('The selected provider needs a key configured on this PC.');
    const c = { ...config };
    try {
      if (provider === 'ollama') return await request(c, { operation: 'generate', provider, body, background }, { signal });
      return await require('../tools/website-worker/worker.cjs').pollModelJob({ provider, body, background, ...(key ? { credential: key } : {}) }, {
        signal, call: (packet, options) => request(c, packet, { timeout: 15000, ...options })
      });
    }
    catch (e) { if (key) e.message = e.message.split(key).join('[redacted]'); throw e; }
  }
  const withSnapshot = callback => actions.getStore() ? callback() : actions.run({ revision,
    useForGameModels: config.enabled && config.useForGameModels }, callback);
  const withBackground = callback => actions.run({ ...actions.getStore(), revision,
    background: true, useForGameModels: true }, callback);
  const remoteBuildEnabled = () => config.enabled && config.remoteBuild && !!connection?.engineHash && connection.roomWorkers === 3;
  const spawnBuild = (job, snapshot, options) => require('./websiteRoomBuild').spawnBuild(job, snapshot, { runStage: runRoomStage, ...options });
  return { view, publicKey, connect, disable, status, generate, ensureConnected, withSnapshot, withBackground, backgroundEnabled: () => config.enabled && config.background,
    runRoomStage, remoteBuildEnabled, spawnBuild, capacity: () => remoteBuildEnabled() ? 3 : 1,
    useForGameModels: () => actions.getStore()?.useForGameModels ?? (config.enabled && config.useForGameModels) };
}

// Retort accepts an SDK-shaped client, including streamed tool-call deltas.
function modelClient(website = service(), provider = 'ollama') {
  return { chat: { completions: { create: async (body, options = {}) => {
    const result = await website.generate({ provider, body, signal: options.signal });
    if (!body.stream) return result;
    return (async function* () {
      for (const choice of result.choices || []) {
        const message = choice.message || {};
        yield { choices: [{ index: choice.index || 0, delta: { ...message,
          ...(message.tool_calls ? { tool_calls: message.tool_calls.map((call, index) => ({ ...call, index })) } : {}) },
          finish_reason: choice.finish_reason }], usage: result.usage };
      }
    })();
  } } } };
}
let singleton;
const service = () => singleton ||= createService();
function useRemoteTransport(transport) {
  if (process.env.HOLODEK_REMOTE_ENGINE !== '1' || require('node:worker_threads').isMainThread) throw Error('Remote transport is restricted to isolated room workers.');
  singleton = { useForGameModels: () => true, backgroundEnabled: () => false, remoteBuildEnabled: () => false,
    withSnapshot: callback => callback(), withBackground: callback => callback(), ensureConnected: async () => {},
    view: () => ({ enabled: true, revision: 0 }),
    generate: async ({ provider, ...packet }) => {
      const key = provider === 'openai' ? process.env.OPENAI_API_KEY : provider === 'xai' ? process.env.XAI_API_KEY : provider === 'groq' ? process.env.GROQ_API_KEY : null;
      return transport({ operation: 'generate', provider, ...packet, ...(key ? { credential: key } : {}) });
    } };
}
function install(app, { onChange = () => {} } = {}) {
  if (service().view().enabled) service().ensureConnected().then(() => console.info('[WebsiteAI] verified worker ready'))
    .catch(() => console.warn('[WebsiteAI] connection unavailable; check Menu > Website AI.'));
  const guard = (req, res, next) => { res.setHeader('Cache-Control', 'no-store');
    if (!localRequest(req)) return res.status(403).json({ error: 'Manage Website AI from this PC using localhost.' }); next(); };
  app.get('/website-ai', guard, (req, res) => res.json(service().view()));
  app.post('/website-ai/key', guard, async (req, res) => {
    try { res.json({ publicKey: await service().publicKey() }); } catch (e) { res.status(400).json({ error: require('./privateDiagnostics').clean(e.message) }); }
  });
  app.post('/website-ai/connect', guard, async (req, res) => {
    try { const result = await service().connect(req.body, { deploy: req.body?.deploy === true }); onChange(); res.json(result); }
    catch (e) { res.status(400).json({ error: require('./privateDiagnostics').clean(e.message) }); }
  });
  app.post('/website-ai/disconnect', guard, (req, res) => { const value = service().disable(); onChange(); res.json(value); });
  app.post('/website-ai/status', guard, async (req, res) => res.json(await service().status()));
}
module.exports = { DEFAULTS, normalize, trustedHost, localRequest, shellQuote, launch, createService, modelClient, service, useRemoteTransport, install };
