'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

// Kept self-contained so the same verifier/extractor can run over SSH without npm.
function installationRuntime() {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const crypto = require('node:crypto'), zlib = require('node:zlib');
  const LIMITS = Object.freeze({ files: 512, fileBytes: 2 * 1024 * 1024,
    sourceBytes: 16 * 1024 * 1024, jsonBytes: 24 * 1024 * 1024, archiveBytes: 8 * 1024 * 1024 });
  const DEPENDENCIES = Object.freeze({ canvas: '3.2.0', openai: '4.52.3', 'retort-js': '0.0.4' });
  const FORMAT = 'holodek-engine-json-gzip-v1';
  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function relative(file) {
    if (typeof file !== 'string' || file.length > 200 || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(file) ||
        file.split('/').some(s => s === '.' || s === '..' || s.startsWith('.') && file !== '.installed.json' || s.endsWith('.') ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) throw Error('Unsafe engine path.');
    return file;
  }
  function allowed(file) {
    relative(file);
    if (file.split('/').some(s => /^(?:node_modules|keys|secrets|credentials|private|saves|logs|models|builder-worlds)$/i.test(s))) return false;
    return /^(?:sharedState|saveGameState|saveGameAssets|dungeonDiagnostics)\.js$/.test(file) ||
      /^(?:retort|assets)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.js$/.test(file) ||
      file === 'retort/sidEffectsGains.json' || file === 'assets/sid-to-wav.html' ||
      /^prompts\/grave-master-local(?:-holodek1)?\.md$/.test(file) ||
      file === 'tools/analyze-sid-reference.cjs' || /^tools\/sfx-build\/[a-zA-Z0-9_-]+\.js$/.test(file) ||
      /^tools\/website-worker\/(?:worker|workerPool|roomWire|roomTask)\.cjs$/.test(file) ||
      file === 'package.json' || file === 'package-lock.json';
  }
  function checkedFile(root, file, maxBytes = LIMITS.fileBytes) {
    relative(file);
    let current = path.resolve(root);
    for (const segment of ['', ...file.split('/')]) {
      if (segment) current = path.join(current, segment);
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink()) throw Error('Engine symlink rejected: ' + file);
      if (current !== path.join(path.resolve(root), ...file.split('/')) && !st.isDirectory()) throw Error('Invalid engine directory.');
    }
    const fd = fs.openSync(current, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > maxBytes || stat.nlink > 1) throw Error('Engine file is not a bounded ordinary file: ' + file);
      const bytes = Buffer.alloc(stat.size + 1); let size = 0, count;
      while (size < bytes.length && (count = fs.readSync(fd, bytes, size, bytes.length - size, null))) size += count;
      if (size !== stat.size) throw Error('Engine file changed while reading: ' + file);
      return bytes.subarray(0, size);
    } finally { fs.closeSync(fd); }
  }
  function inspect(bytes, hash) {
    if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.archiveBytes || !/^[a-f0-9]{64}$/.test(hash || '') || sha256(bytes) !== hash)
      throw Error('Engine archive checksum or size mismatch.');
    let archive;
    try { archive = JSON.parse(zlib.gunzipSync(bytes, { maxOutputLength: LIMITS.jsonBytes }).toString('utf8')); }
    catch { throw Error('Invalid or oversized engine archive.'); }
    const manifest = archive.manifest;
    if (manifest?.version !== 1 || manifest.format !== FORMAT || canonical(manifest.dependencies) !== canonical(DEPENDENCIES) ||
        !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > LIMITS.files ||
        !Array.isArray(archive.files) || archive.files.length !== manifest.files.length) throw Error('Invalid engine manifest.');
    const decoded = [], names = new Set(); let total = 0, previous = '';
    for (let i = 0; i < manifest.files.length; i++) {
      const entry = manifest.files[i], row = archive.files[i];
      if (!entry || !allowed(entry.path) || names.has(entry.path.toLowerCase()) || entry.path <= previous ||
          !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > LIMITS.fileBytes ||
          !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || row?.path !== entry.path || typeof row.data !== 'string' ||
          row.data.length !== Math.ceil(entry.size / 3) * 4) throw Error('Invalid engine file entry.');
      const content = Buffer.from(row.data, 'base64');
      if (content.toString('base64') !== row.data || content.length !== entry.size || sha256(content) !== entry.sha256)
        throw Error('Engine file checksum mismatch: ' + entry.path);
      total += content.length;
      if (total > LIMITS.sourceBytes) throw Error('Engine source size limit exceeded.');
      names.add(entry.path.toLowerCase()); previous = entry.path; decoded.push({ path: entry.path, bytes: content });
    }
    const pkg = decoded.find(row => row.path === 'package.json'), lock = decoded.find(row => row.path === 'package-lock.json');
    if (!pkg || !lock) throw Error('Engine dependency manifests are missing.');
    const parsed = JSON.parse(pkg.bytes), parsedLock = JSON.parse(lock.bytes);
    if (parsed.name !== 'holodek-website-engine' || parsed.scripts || canonical(parsed.dependencies) !== canonical(DEPENDENCIES) ||
        parsedLock.lockfileVersion !== 3 || canonical(parsedLock.packages?.['']?.dependencies) !== canonical(DEPENDENCIES))
      throw Error('Unexpected engine dependencies.');
    return { hash, manifest, manifestHash: sha256(canonical(manifest)), files: decoded, sourceBytes: total };
  }
  function privateDirectory(directory) {
    const absolute = path.resolve(directory), parsed = path.parse(absolute);
    let current = parsed.root;
    for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
      const st = fs.lstatSync(current);
      if (!st.isDirectory() || st.isSymbolicLink()) throw Error('Unsafe engine installation directory.');
    }
    return absolute;
  }
  function preflight() {
    const glibc = process.report?.getReport().header.glibcVersionRuntime || null;
    return { platform: process.platform, arch: process.arch, node: process.version, glibc,
      supported: process.platform === 'linux' && !!glibc && Number(process.versions.node.split('.')[0]) >= 22,
      canvasPrebuiltTarget: process.platform === 'linux' && process.arch === 'x64' && !!glibc,
      sourceBuildPackages: ['build-essential', 'python3', 'pkg-config', 'libcairo2-dev', 'libpango1.0-dev'],
      optionalImagePackages: ['libjpeg-dev', 'libgif-dev', 'librsvg2-dev'], gpuRequired: false };
  }
  function diagnostic(value, limit = 1000) {
    return require('node:util').stripVTControlCharacters(String(value || ''))
      .replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted]')
      .replace(/\b(?:sk-|xai-|npm_|gh[pousr]_)[a-zA-Z0-9_-]{12,}\b/g, '[redacted]')
      .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
      .replace(/([?&](?:access_token|api[_-]?key|token|password|_authToken)=)[^&#\s]+/gi, '$1[redacted]')
      .replace(/(\b(?:authorization|(?:openai|xai)_api_key|api[_-]?key|_authToken|_auth|token|password)\b\s*[:=]\s*)(?:Bearer\s+)?(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[redacted]')
      .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]').trim().slice(-limit);
  }
  function prepare(directory) {
    if (!preflight().supported) throw Error('Engine installation needs Node 22+ on glibc Linux.');
    const { spawnSync } = require('node:child_process');
    const emptyConfig = name => {
      const file = path.join(directory, name);
      try {
        const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
          (fs.constants.O_NOFOLLOW || 0), 0o600);
        fs.closeSync(fd);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== 0 || stat.nlink !== 1) throw Error('Unsafe inactive engine npm config.');
      }
      return file;
    };
    // Do not inherit API keys, SSH agents, npm tokens, or a website's PM2 environment.
    const env = { HOME: os.homedir(), PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      LANG: 'C.UTF-8', npm_config_userconfig: emptyConfig('.npmrc-user'), npm_config_globalconfig: emptyConfig('.npmrc-global'),
      npm_config_registry: 'https://registry.npmjs.org/', ONNXRUNTIME_NODE_INSTALL: 'skip' };
    const run = (label, exe, args, timeout) => {
      const result = spawnSync(exe, args, { cwd: directory, env, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
      if (result.error || result.status !== 0) {
        const exitCode = Number.isInteger(result.status) ? result.status : null;
        const signal = diagnostic(result.signal, 32), spawnCode = diagnostic(result.error?.code, 64);
        const stderrTail = diagnostic(result.stderr);
        const error = Error('Inactive engine ' + label + ' failed (exitCode=' + exitCode +
          (signal ? ', signal=' + signal : '') + (spawnCode ? ', error=' + spawnCode : '') + '): ' + (stderrTail || '(no stderr)'));
        Object.assign(error, { code: 'ENGINE_PREPARE_FAILED', command: label, exitCode,
          signal: signal || null, spawnCode: spawnCode || null, stderrTail });
        throw error;
      }
    };
    run('npm ci', 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], 300000);
    run('node canvas preflight', process.execPath, ['-e', "const c=require('canvas');if(!c.createCanvas(2,2).toBuffer('image/png').length)process.exit(1);require.resolve('openai');require.resolve('retort-js');"], 30000);
  }
  function install(bytes, hash, options = {}) {
    const verified = inspect(bytes, hash);
    const directory = privateDirectory(options.directory || path.join(os.homedir(), '.holodek-worker', 'engines'));
    const target = path.join(directory, hash), receipt = '.installed.json';
    if (fs.existsSync(target)) {
      const saved = JSON.parse(checkedFile(target, receipt));
      if (saved.hash !== hash || saved.manifestHash !== verified.manifestHash || saved.ready !== true) throw Error('Engine generation already exists but is not verified.');
      for (const row of verified.files) if (sha256(checkedFile(target, row.path)) !== sha256(row.bytes)) throw Error('Installed engine generation changed.');
      return { hash, directory: target, ready: true, reused: true, activated: false };
    }
    const staging = path.join(directory, '.pending-' + hash + '-' + crypto.randomUUID());
    fs.mkdirSync(staging, { mode: 0o700 });
    for (const row of verified.files) {
      const destination = path.join(staging, ...row.path.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, row.bytes, { flag: 'wx', mode: 0o600 });
    }
    // A failed preparation remains private and inactive; no current generation is touched.
    (options.prepare || prepare)(staging);
    for (const row of verified.files) if (sha256(checkedFile(staging, row.path)) !== sha256(row.bytes)) throw Error('Engine source changed during dependency preparation.');
    fs.writeFileSync(path.join(staging, receipt), canonical({ hash, manifestHash: verified.manifestHash, ready: true }), { flag: 'wx', mode: 0o600 });
    if (fs.existsSync(target)) throw Error('Concurrent engine installation; existing generation preserved.');
    fs.renameSync(staging, target);
    return { hash, directory: target, ready: true, reused: false, activated: false };
  }
  return { LIMITS, DEPENDENCIES, FORMAT, sha256, canonical, relative, allowed, checkedFile, inspect, install, preflight };
}

const Runtime = installationRuntime();
// Non-require entrypoints (workers, spawned SID compiler, converter source and prompts).
// MiniLM, speech and offline WAV rendering are deliberately outside the room-stage runtime.
const ENTRYPOINTS = Object.freeze(['retort/roomBuildWorker.js', 'retort/remoteRoomWorker.js', 'retort/retortWithUserInput.js',
  'tools/website-worker/worker.cjs', 'tools/website-worker/workerPool.cjs',
  'tools/website-worker/roomWire.cjs', 'tools/website-worker/roomTask.cjs', 'retort/sidEffectsLive.js',
  'assets/renderSid_poke.js', 'retort/sidToWav.js', 'assets/sidLiveWorker.js', 'assets/sidPlayer.js',
  'assets/sid-to-wav.html', 'tools/analyze-sid-reference.cjs',
  'prompts/grave-master-local.md', 'prompts/grave-master-local-holodek1.md']);

// Lex only; never require the engine (which constructs SDK clients and reads state).
function imports(source) {
  const tokens = []; let i = 0;
  function scan(templateExpression = false, depth = 0) {
    if (depth > 64) throw Error('Engine source nesting limit exceeded.');
    let braces = 0, previous = '';
    while (i < source.length) {
      const ch = source[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (source.startsWith('//', i)) { i = source.indexOf('\n', i); if (i < 0) i = source.length; continue; }
      if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); if (end < 0) throw Error('Unclosed engine comment.'); i = end + 2; continue; }
      if (ch === '"' || ch === "'") {
        const quote = ch, start = ++i; let escaped = false;
        while (i < source.length && source[i] !== quote) { if (source[i] === '\\') { escaped = true; i++; } i++; }
        if (i >= source.length) throw Error('Unclosed engine string.');
        tokens.push({ kind: 'string', value: escaped ? null : source.slice(start, i) }); i++; previous = 'value'; continue;
      }
      if (ch === '`') {
        i++;
        while (i < source.length && source[i] !== '`') {
          if (source[i] === '\\') { i += 2; continue; }
          if (source.startsWith('${', i)) { i += 2; scan(true, depth + 1); } else i++;
        }
        if (i >= source.length) throw Error('Unclosed engine template.');
        i++; previous = 'value'; continue;
      }
      if (ch === '/' && (!previous || /^(?:[({[=,:;!?&|+*%^~<>-]|return|throw|case|typeof|void|delete|yield|await)$/.test(previous))) {
        i++; let characterClass = false;
        while (i < source.length) {
          const c = source[i++];
          if (c === '\\') { i++; continue; }
          if (c === '[') characterClass = true;
          if (c === ']') characterClass = false;
          if (c === '/' && !characterClass) break;
        }
        while (/[a-z]/i.test(source[i] || '') && i < source.length) i++;
        previous = 'value'; continue;
      }
      if (templateExpression && ch === '}' && braces === 0) { i++; return; }
      if (ch === '{') braces++;
      if (ch === '}') braces--;
      if (/[a-zA-Z_$]/.test(ch)) {
        const start = i++;
        while (i < source.length && /[\w$]/.test(source[i])) i++;
        previous = source.slice(start, i); tokens.push({ kind: 'word', value: previous });
      } else { previous = ch; tokens.push({ kind: 'punct', value: ch }); i++; }
    }
    if (templateExpression) throw Error('Unclosed engine template expression.');
  }
  scan();
  const result = [];
  for (let n = 0; n < tokens.length - 3; n++) {
    if (tokens[n].kind === 'word' && tokens[n].value === 'require' && // A preceding spread (...require) is not a member call (object.require).
        (tokens[n - 1]?.value !== '.' || tokens[n - 2]?.value === '.' && tokens[n - 3]?.value === '.') &&
        tokens[n + 1].value === '(' && tokens[n + 2].kind === 'string' && tokens[n + 3].value === ')') {
      if (tokens[n + 2].value === null) throw Error('Escaped engine import is unsupported.');
      result.push(tokens[n + 2].value);
    }
  }
  return result;
}

function dependencyLock(root) {
  const lock = JSON.parse(Runtime.checkedFile(root, 'package-lock.json'));
  if (lock.lockfileVersion !== 3 || !lock.packages) throw Error('Engine needs a v3 dependency lock.');
  const pkg = { name: 'holodek-website-engine', version: '1.0.0', private: true, engines: { node: '>=22' }, dependencies: Runtime.DEPENDENCIES };
  const packages = { '': pkg }, visiting = new Set();
  function resolve(from, name) {
    if (!/^(?:@[a-z0-9_-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw Error('Unsafe engine dependency name.');
    let at = from;
    while (true) {
      const candidate = (at ? at + '/' : '') + 'node_modules/' + name;
      if (Object.hasOwn(lock.packages, candidate)) return candidate;
      if (!at) return null;
      const parent = at.lastIndexOf('/node_modules/'); at = parent < 0 ? '' : at.slice(0, parent);
    }
  }
  function include(key) {
    if (visiting.has(key)) return;
    visiting.add(key);
    const record = lock.packages[key];
    if (!record || record.link || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(record.version || '') ||
        !/^https:\/\/registry\.npmjs\.org\/[a-zA-Z0-9@/_.%-]+\.tgz$/.test(record.resolved || '') ||
        !/^sha(?:256|384|512)-[a-zA-Z0-9+/]+=*$/.test(record.integrity || '')) throw Error('Engine dependency is not registry-pinned: ' + key);
    packages[key] = record;
    for (const [name, optional] of [...Object.keys(record.dependencies || {}).map(n => [n, false]),
      ...Object.keys(record.optionalDependencies || {}).map(n => [n, true]),
      ...Object.keys(record.peerDependencies || {}).map(n => [n, record.peerDependenciesMeta?.[n]?.optional === true])]) {
      const next = resolve(key, name);
      if (next) include(next); else if (!optional) throw Error('Missing locked engine dependency: ' + name);
    }
  }
  for (const [name, version] of Object.entries(Runtime.DEPENDENCIES)) {
    const key = resolve('', name);
    if (!key || lock.packages[key].version !== version) throw Error('Unexpected locked engine dependency: ' + name);
    include(key);
  }
  return { pkg, lock: { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages } };
}

// Read-only: supportRoot may fill missing tools/ source in an otherwise complete staged tree.
function build(root, { supportRoot } = {}) {
  root = path.resolve(root);
  if (supportRoot) supportRoot = path.resolve(supportRoot);
  const content = new Map(); let sourceBytes = 0;
  function read(file) {
    if (!Runtime.allowed(file)) throw Error('Disallowed runtime dependency: ' + file);
    try { return Runtime.checkedFile(root, file); }
    catch (error) {
      // Supplement only known build-tool source, never a missing engine, secret, or save.
      if (error.code === 'ENOENT' && supportRoot && /^tools\/(?:analyze-sid-reference\.cjs|sfx-build\/[a-zA-Z0-9_-]+\.js)$/.test(file))
        return Runtime.checkedFile(supportRoot, file);
      throw error;
    }
  }
  function add(file, bytes) {
    if (content.has(file)) return;
    sourceBytes += bytes.length;
    if (bytes.length > Runtime.LIMITS.fileBytes || content.size >= Runtime.LIMITS.files || sourceBytes > Runtime.LIMITS.sourceBytes)
      throw Error('Engine source size/count limit exceeded.');
    if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(bytes.toString('utf8'))) throw Error('Private key material in engine source.');
    content.set(file, bytes);
  }
  function walk(file) {
    if (content.has(file)) return;
    const bytes = read(file); add(file, bytes);
    if (!/\.(?:js|cjs)$/.test(file)) return;
    for (const specifier of imports(bytes.toString('utf8'))) {
      if (specifier.startsWith('.')) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        Runtime.relative(base);
        let found = false;
        for (const candidate of [base, base + '.js', base + '.json', base + '.cjs', base + '/index.js']) {
          if (!Runtime.allowed(candidate)) continue;
          try { read(candidate); walk(candidate); found = true; break; }
          catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
        }
        if (!found) throw Error('Missing runtime dependency: ' + specifier + ' from ' + file);
      } else if (!specifier.startsWith('node:') && !builtinModules.includes(specifier)) {
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        if (!Object.hasOwn(Runtime.DEPENDENCIES, name)) throw Error('Unsupported engine package: ' + name);
      }
    }
  }
  for (const entry of ENTRYPOINTS) walk(entry);
  const manifests = dependencyLock(root);
  add('package.json', Buffer.from(Runtime.canonical(manifests.pkg) + '\n'));
  add('package-lock.json', Buffer.from(Runtime.canonical(manifests.lock) + '\n'));
  const files = [...content.keys()].sort().map(file => ({ path: file, size: content.get(file).length, sha256: Runtime.sha256(content.get(file)) }));
  const manifest = { version: 1, format: Runtime.FORMAT, dependencies: Runtime.DEPENDENCIES, files };
  const json = Buffer.from(Runtime.canonical({ manifest, files: files.map(row => ({ path: row.path, data: content.get(row.path).toString('base64') })) }));
  if (json.length > Runtime.LIMITS.jsonBytes) throw Error('Engine JSON size limit exceeded.');
  const bytes = require('node:zlib').gzipSync(json, { level: 9, mtime: 0 });
  bytes[9] = 255; // Normalize the gzip OS header; no filename or timestamp enters the archive.
  if (bytes.length > Runtime.LIMITS.archiveBytes) throw Error('Engine archive size limit exceeded.');
  const hash = Runtime.sha256(bytes);
  Runtime.inspect(bytes, hash);
  return { hash, bytes, files, dependencies: { ...Runtime.DEPENDENCIES }, manifest,
    manifestHash: Runtime.sha256(Runtime.canonical(manifest)), sourceBytes };
}

// node -e <source>, stdin: { hash, archive: <base64 gzip> }; no activation side effects.
function installerSource() {
  return "'use strict';const engine=(" + installationRuntime.toString() + ")();let size=0;const chunks=[];" +
    "process.stdin.on('data',b=>{size+=b.length;if(size>engine.LIMITS.archiveBytes*2){process.stderr.write('Engine input limit exceeded.');process.exit(1)}chunks.push(b)});" +
    "process.stdin.on('end',()=>{try{const p=JSON.parse(Buffer.concat(chunks).toString('utf8'));" +
    "if(typeof p.archive!=='string'||p.archive.length>Math.ceil(engine.LIMITS.archiveBytes/3)*4)throw Error('Invalid engine input.');" +
    "const b=Buffer.from(p.archive,'base64');if(b.toString('base64')!==p.archive)throw Error('Invalid engine encoding.');" +
    "process.stdout.write(JSON.stringify({value:engine.install(b,p.hash)})+'\\n')}catch(e){process.stdout.write(JSON.stringify({error:e.message})+'\\n');process.exitCode=1}});";
}

module.exports = { build, inspect: Runtime.inspect, install: Runtime.install, preflight: Runtime.preflight,
  installerSource, ENTRYPOINTS, LIMITS: Runtime.LIMITS, DEPENDENCIES: Runtime.DEPENDENCIES };
