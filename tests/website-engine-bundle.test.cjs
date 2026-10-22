'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), zlib = require('node:zlib');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const Bundle = require(path.join(root, 'retort/websiteEngineBundle'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-engine-bundle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (file, text) => { const dest = path.join(directory, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
  for (const entry of Bundle.ENTRYPOINTS) write(entry, entry.endsWith('.js') || entry.endsWith('.cjs') ? 'module.exports = {};\n' : 'engine fixture\n');
  write('retort/retortWithUserInput.js', "require('../sharedState'); require('canvas'); require('retort-js/dist/message'); require('openai');\n");
  write('sharedState.js', "require('./saveGameState');\n");
  write('saveGameState.js', 'module.exports = {};\n');
  const packages = {};
  for (const [name, version] of Object.entries(Bundle.DEPENDENCIES)) packages['node_modules/' + name] = {
    version, resolved: 'https://registry.npmjs.org/' + name + '/-/' + name + '-' + version + '.tgz', integrity: 'sha512-' + Buffer.alloc(64).toString('base64')
  };
  packages['node_modules/onnxruntime-node'] = { version: '1.30.0', resolved: 'never used' };
  write('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages }));
  return { directory, write };
}
function repack(bundle, mutate) {
  const data = JSON.parse(zlib.gunzipSync(bundle.bytes)); mutate(data);
  const bytes = zlib.gzipSync(JSON.stringify(data)); return { bytes, hash: sha(bytes) };
}

test('bundle is deterministic, sorted, content-hashed, minimal and independent of timestamps', t => {
  const f = fixture(t);
  for (const file of ['keys/openai.key', '.retort-data/saves/game.json', 'node_modules/private.js', 'assets/unrelated.js', 'server.js'])
    f.write(file, 'SECRET-DO-NOT-PACK');
  const first = Bundle.build(f.directory);
  fs.utimesSync(path.join(f.directory, 'sharedState.js'), new Date(0), new Date(0));
  const second = Bundle.build(f.directory);
  assert.equal(first.hash, second.hash); assert.deepEqual(first.bytes, second.bytes);
  assert.match(first.hash, /^[a-f0-9]{64}$/); assert.equal(first.hash, sha(first.bytes));
  assert.deepEqual(first.files.map(f => f.path), first.files.map(f => f.path).sort());
  const verified = Bundle.inspect(first.bytes, first.hash);
  assert.equal(verified.manifestHash, first.manifestHash);
  assert.ok(!zlib.gunzipSync(first.bytes).includes(Buffer.from('SECRET-DO-NOT-PACK')));
  const pkg = JSON.parse(verified.files.find(f => f.path === 'package.json').bytes);
  const lock = JSON.parse(verified.files.find(f => f.path === 'package-lock.json').bytes);
  assert.deepEqual(pkg.dependencies, Bundle.DEPENDENCIES); assert.equal(pkg.scripts, undefined);
  assert.equal(lock.packages['node_modules/onnxruntime-node'], undefined);
  f.write('sharedState.js', "require('./saveGameState'); // changed source\n");
  assert.notEqual(Bundle.build(f.directory).hash, first.hash);
});

test('import tracing ignores comments, strings and regex but follows template expressions and cycles', t => {
  const f = fixture(t);
  f.write('sharedState.js', "// require('./server')\nconst s=\"require('../keys/private')\"; const r=/require('not-a-package')/;\n/* require('onnxruntime-node') */\nconst t=`text ${require('./saveGameState')}`;\n");
  f.write('saveGameState.js', "require('./sharedState');\n");
  const bundle = Bundle.build(f.directory);
  assert.ok(bundle.files.some(f => f.path === 'saveGameState.js'));
  assert.ok(!bundle.files.some(f => f.path === 'server.js'));
});

test('lock pruning keeps nested and required transitive dependencies, not unrelated root packages', t => {
  const f = fixture(t), file = path.join(f.directory, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  lock.packages['node_modules/canvas'].dependencies = { helper: '^1.0.0' };
  lock.packages['node_modules/canvas/node_modules/helper'] = {
    version: '1.0.0', resolved: 'https://registry.npmjs.org/helper/-/helper-1.0.0.tgz',
    integrity: 'sha512-' + Buffer.alloc(64).toString('base64'),
    peerDependencies: { absent: '*' }, peerDependenciesMeta: { absent: { optional: true } }
  };
  f.write('package-lock.json', JSON.stringify(lock));
  const bundle = Bundle.build(f.directory), inspected = Bundle.inspect(bundle.bytes, bundle.hash);
  const packed = JSON.parse(inspected.files.find(f => f.path === 'package-lock.json').bytes);
  assert.ok(packed.packages['node_modules/canvas/node_modules/helper']);
  assert.equal(packed.packages['node_modules/onnxruntime-node'], undefined);
  delete lock.packages['node_modules/canvas/node_modules/helper'];
  f.write('package-lock.json', JSON.stringify(lock));
  assert.throws(() => Bundle.build(f.directory), /Missing locked/);
});

test('dependency locks reject credential-bearing registries, local links and floating direct versions', t => {
  for (const mutate of [r => { r.resolved = 'https://token@registry.npmjs.org/canvas/-/canvas-3.2.0.tgz'; },
    r => { r.link = true; }, r => { r.version = '3.3.0'; }]) {
    const f = fixture(t), file = path.join(f.directory, 'package-lock.json'), lock = JSON.parse(fs.readFileSync(file, 'utf8'));
    mutate(lock.packages['node_modules/canvas']);
    f.write('package-lock.json', JSON.stringify(lock));
    assert.throws(() => Bundle.build(f.directory), /registry-pinned|Unexpected locked/);
  }
});

test('private, unapproved, missing and optional heavyweight imports fail closed', t => {
  const f = fixture(t);
  for (const source of ["require('../keys/openai.key')", "require('./server')", "require('onnxruntime-node')", "require('phonemizer')"] ) {
    f.write('sharedState.js', source);
    assert.throws(() => Bundle.build(f.directory), /Unsafe|Missing|Unsupported|Disallowed/);
  }
  f.write('sharedState.js', '-----BEGIN OPENSSH PRIVATE KEY-----');
  assert.throws(() => Bundle.build(f.directory), /Private key/);
});

test('source and archive limits are enforced before runtime or extraction', t => {
  const f = fixture(t);
  f.write('sharedState.js', Buffer.alloc(Bundle.LIMITS.fileBytes + 1, 32));
  assert.throws(() => Bundle.build(f.directory), /bounded|limit/);
  assert.throws(() => Bundle.inspect(Buffer.alloc(Bundle.LIMITS.archiveBytes + 1), '0'.repeat(64)), /size/);
  const bomb = zlib.gzipSync(Buffer.alloc(Bundle.LIMITS.jsonBytes + 1, 32));
  assert.throws(() => Bundle.inspect(bomb, sha(bomb)), /oversized/);
});

test('verifier rejects corruption, unsafe paths, case collisions, manifests and entry hashes', t => {
  const f = fixture(t), bundle = Bundle.build(f.directory);
  assert.throws(() => Bundle.inspect(bundle.bytes, '0'.repeat(64)), /checksum/);
  for (const name of ['../escape.js', '/tmp/escape.js', 'C:/escape.js', 'retort\\escape.js', 'retort/../escape.js',
    'node_modules/secret.js', '.retort-data/saves/game.json', 'retort/CON.js', 'retort/private/secret.js']) {
    const changed = repack(bundle, a => { a.manifest.files[0].path = a.files[0].path = name; });
    assert.throws(() => Bundle.inspect(changed.bytes, changed.hash), /path|entry/);
  }
  for (const mutate of [a => { a.files[0].data = Buffer.from('tamper').toString('base64'); },
    a => { a.manifest.files[0].sha256 = '0'.repeat(64); },
    a => { a.manifest.dependencies.canvas = '*'; },
    a => { a.manifest.files.push(a.manifest.files[0]); a.files.push(a.files[0]); }]) {
    const changed = repack(bundle, mutate);
    assert.throws(() => Bundle.inspect(changed.bytes, changed.hash));
  }
});

test('supplemental root supplies only missing allowlisted tool source', t => {
  const f = fixture(t), support = fixture(t);
  fs.unlinkSync(path.join(f.directory, 'tools/analyze-sid-reference.cjs'));
  assert.throws(() => Bundle.build(f.directory), /ENOENT/);
  assert.ok(Bundle.build(f.directory, { supportRoot: support.directory }).files.some(f => f.path === 'tools/analyze-sid-reference.cjs'));
  fs.unlinkSync(path.join(f.directory, 'sharedState.js'));
  assert.throws(() => Bundle.build(f.directory, { supportRoot: support.directory }), /Missing/);
});

test('symlinked source files and source directories are rejected', t => {
  const f = fixture(t), other = fixture(t);
  try {
    fs.unlinkSync(path.join(f.directory, 'sharedState.js'));
    fs.symlinkSync(path.join(other.directory, 'sharedState.js'), path.join(f.directory, 'sharedState.js'), 'file');
  } catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('OS does not allow test symlinks'); throw error; }
  assert.throws(() => Bundle.build(f.directory), /symlink/);
  fs.unlinkSync(path.join(f.directory, 'sharedState.js'));
  f.write('sharedState.js', "require('./saveGameState');\n");
  fs.renameSync(path.join(f.directory, 'prompts'), path.join(f.directory, 'prompts-original'));
  fs.symlinkSync(path.join(other.directory, 'prompts'), path.join(f.directory, 'prompts'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => Bundle.build(f.directory), /symlink/);
});

test('install prepares a fresh private generation before publication and never activates or restarts', t => {
  const f = fixture(t), bundle = Bundle.build(f.directory), directory = path.join(f.directory, 'engines');
  let calls = 0;
  const options = { directory, prepare: staging => {
    calls++; assert.equal(fs.existsSync(path.join(directory, bundle.hash)), false);
    assert.ok(path.basename(staging).startsWith('.pending-'));
    assert.ok(fs.existsSync(path.join(staging, 'package-lock.json')));
    assert.equal(fs.existsSync(path.join(staging, '.installed.json')), false);
  } };
  const result = Bundle.install(bundle.bytes, bundle.hash, options);
  assert.equal(result.ready, true); assert.equal(result.activated, false); assert.equal(calls, 1);
  assert.equal(Bundle.install(bundle.bytes, bundle.hash, options).reused, true); assert.equal(calls, 1);
  fs.writeFileSync(path.join(result.directory, 'sharedState.js'), 'tampered');
  assert.throws(() => Bundle.install(bundle.bytes, bundle.hash, options), /changed/);
});

test('failed dependencies never publish or alter an existing engine generation', t => {
  const f = fixture(t), first = Bundle.build(f.directory), directory = path.join(f.directory, 'engines');
  const installed = Bundle.install(first.bytes, first.hash, { directory, prepare() {} });
  f.write('sharedState.js', '// new generation\n');
  const next = Bundle.build(f.directory);
  assert.throws(() => Bundle.install(next.bytes, next.hash, { directory, prepare() { throw Error('offline dependency failure'); } }), /offline/);
  assert.equal(fs.existsSync(path.join(directory, next.hash)), false);
  assert.ok(fs.existsSync(path.join(installed.directory, '.installed.json')));
});

function offlineInstaller(spawn) {
  const source = Bundle.installerSource(), boundary = source.indexOf(';let size=0');
  assert.ok(boundary > 0);
  return vm.runInNewContext(source.slice(0, boundary) + ';engine;', {
    Buffer, require: name => name === 'node:child_process' ? { spawnSync: spawn } : require(name),
    process: { platform: 'linux', arch: 'x64', version: 'v22.23.4', versions: { node: '22.23.4' },
      execPath: '/private/node/bin/node', report: { getReport: () => ({ header: { glibcVersionRuntime: '2.34' } }) },
      env: { PATH: '/private/node/bin:/usr/bin', OPENAI_API_KEY: 'parent-key-must-not-inherit',
        XAI_API_KEY: 'parent-xai-key-must-not-inherit', NPM_TOKEN: 'parent-npm-token-must-not-inherit', SSH_AUTH_SOCK: '/private/agent.sock' } }
  });
}

test('standalone installer exposes bounded sanitized npm diagnostics without inheriting credentials', t => {
  const f = fixture(t), bundle = Bundle.build(f.directory), directory = path.join(f.directory, 'engines');
  const calls = [], secrets = ['sk-proj-' + 'A'.repeat(40), 'xai-' + 'B'.repeat(40), 'npm_' + 'C'.repeat(40)];
  const stderr = 'discarded-prefix\n' + 'x'.repeat(1400) + '\n\u001b[31mNPM CONFIG FAILURE\u001b[0m\u0000\n' +
    secrets.join(' ') + '\nOPENAI_API_KEY=offline-provider-secret\nAuthorization: Bearer arbitrary-provider-secret\n' +
    'https://private-user:private-password@example.invalid/?token=private-query-token\n' +
    '-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-material\n-----END OPENSSH PRIVATE KEY-----\nEUSAGE: lock file is out of sync';
  const installer = offlineInstaller((exe, args, options) => {
    calls.push({ exe, args, options });
    return { status: 1, signal: null, stderr, stdout: 'stdout-must-not-be-disclosed' };
  });
  assert.throws(() => installer.install(bundle.bytes, bundle.hash, { directory }), error => {
    assert.equal(error.command, 'npm ci'); assert.equal(error.exitCode, 1);
    assert.equal(error.code, 'ENGINE_PREPARE_FAILED');
    assert.match(error.message, /npm ci failed \(exitCode=1\)/);
    assert.match(error.message, /NPM CONFIG FAILURE/); assert.match(error.message, /lock file is out of sync$/);
    assert.ok(error.stderrTail.length <= 1000); assert.ok(error.message.length <= 1200);
    for (const secret of [...secrets, 'offline-provider-secret', 'arbitrary-provider-secret', 'private-password',
      'private-query-token', 'private-material', 'discarded-prefix', 'stdout-must-not-be-disclosed', '\u001b', '\u0000'])
      assert.ok(!error.message.includes(secret), secret);
    return true;
  });
  assert.equal(calls.length, 1); assert.equal(calls[0].exe, 'npm'); assert.equal(calls[0].args[0], 'ci');
  for (const name of ['OPENAI_API_KEY', 'XAI_API_KEY', 'NPM_TOKEN', 'SSH_AUTH_SOCK']) assert.equal(calls[0].options.env[name], undefined);
  const { npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig } = calls[0].options.env;
  assert.notEqual(userConfig, globalConfig);
  for (const file of [userConfig, globalConfig]) {
    assert.equal(path.dirname(file), calls[0].options.cwd);
    assert.equal(fs.readFileSync(file, 'utf8'), '');
    const stat = fs.lstatSync(file);
    assert.equal(stat.isSymbolicLink(), false);
    if (process.platform !== 'win32') assert.equal(stat.mode & 0o777, 0o600);
  }
  assert.equal(fs.existsSync(path.join(directory, bundle.hash)), false);
});

test('standalone installer distinguishes native preflight failure from npm failure', t => {
  const f = fixture(t), bundle = Bundle.build(f.directory), calls = [];
  const installer = offlineInstaller((exe, args, options) => {
    calls.push({ exe, args, options });
    return calls.length === 1 ? { status: 0, stderr: '' } : {
      status: 7, stderr: 'ERR_DLOPEN_FAILED: libcairo.so.2: cannot open shared object file' };
  });
  assert.throws(() => installer.install(bundle.bytes, bundle.hash, { directory: path.join(f.directory, 'engines') }), error => {
    assert.equal(error.command, 'node canvas preflight'); assert.equal(error.exitCode, 7);
    assert.match(error.message, /node canvas preflight failed \(exitCode=7\).*libcairo\.so\.2/);
    return true;
  });
  assert.equal(calls.length, 2); assert.equal(calls[1].exe, '/private/node/bin/node');
});

test('standalone installer reports spawn failures and timeout signals even without stderr', t => {
  for (const result of [{ status: null, error: { code: 'ENOENT' } },
    { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }]) {
    const f = fixture(t), bundle = Bundle.build(f.directory), installer = offlineInstaller(() => result);
    assert.throws(() => installer.install(bundle.bytes, bundle.hash, { directory: path.join(f.directory, 'engines') }), error => {
      assert.match(error.message, /npm ci failed \(exitCode=null/);
      assert.ok(error.message.includes('error=' + result.error.code)); assert.match(error.message, /\(no stderr\)$/);
      if (result.signal) assert.ok(error.message.includes('signal=SIGTERM'));
      return true;
    });
  }
});

test('installer refuses symlinked destination ancestry without writing through it', t => {
  const f = fixture(t), other = fixture(t), bundle = Bundle.build(f.directory), link = path.join(f.directory, 'engines');
  try { fs.symlinkSync(other.directory, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('OS does not allow test symlinks'); throw error; }
  assert.throws(() => Bundle.install(bundle.bytes, bundle.hash, { directory: link, prepare() {} }), /Unsafe/);
  assert.equal(fs.existsSync(path.join(other.directory, bundle.hash)), false);
});

test('installer rejects invalid archive before creating a destination or invoking preparation', t => {
  const f = fixture(t), bundle = Bundle.build(f.directory), directory = path.join(f.directory, 'must-not-exist');
  assert.throws(() => Bundle.install(bundle.bytes, '0'.repeat(64), { directory, prepare() { assert.fail('must not prepare'); } }), /checksum/);
  assert.equal(fs.existsSync(directory), false);
});

test('self-contained SSH installer validates input before npm or disk writes', () => {
  const source = Bundle.installerSource();
  const result = spawnSync(process.execPath, ['-e', source], { input: JSON.stringify({ hash: '0'.repeat(64), archive: 'YmFk' }), encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(JSON.parse(result.stdout).error, /checksum/);
  assert.ok(!/sudo|pm2|restart|\.current/.test(source));
  const report = Bundle.preflight(); assert.equal(report.gpuRequired, false);
  assert.ok(report.sourceBuildPackages.includes('libcairo2-dev'));
});

test('real snapshot includes dynamic SID support and only the required npm closure', () => {
  const supportRoot = path.resolve(root, '../../..');
  const bundle = Bundle.build(root, { supportRoot });
  const files = new Set(bundle.files.map(f => f.path));
  for (const file of ['sharedState.js', 'saveGameState.js', 'saveGameAssets.js', 'dungeonDiagnostics.js',
    'assets/renderCharacterSprite.js', 'assets/renderSceneTextures.js', 'retort/sceneRoomBuilder.js',
    'retort/sidLocalWork.js', 'retort/sidMusicTheory.js', 'retort/sidAssembler.js', 'retort/sidVoice/jsid.js', 'retort/sidEffectsGains.json',
    'tools/analyze-sid-reference.cjs', 'tools/sfx-build/effects.js', 'tools/sfx-build/keyedStems.js',
    'tools/sfx-build/voices.js', 'tools/sfx-build/rangedEffects.js', 'retort/remoteRoomWorker.js',
    'tools/website-worker/worker.cjs', 'tools/website-worker/workerPool.cjs',
    'tools/website-worker/roomWire.cjs', 'tools/website-worker/roomTask.cjs']) assert.ok(files.has(file), file);
  for (const file of ['server.js', 'retort/memoryEmbeddingWorker.js', 'retort/sidVoice/worker.js']) assert.ok(!files.has(file), file);
  assert.ok(bundle.bytes.length < Bundle.LIMITS.archiveBytes);
  assert.deepEqual(bundle.dependencies, { canvas: '3.2.0', openai: '4.52.3', 'retort-js': '0.0.4' });
});

test('spread requires are traced while member require calls remain excluded', t => {
 const f=fixture(t);f.write('sharedState.js',"const rules={...require('./retort/spreadRules').rules()}; const values=[...require('./retort/spreadValues')]; object.require('./not-a-module');");f.write('retort/spreadRules.js',"module.exports={rules:()=>({})};");f.write('retort/spreadValues.js',"module.exports=[];");const paths=new Set(Bundle.build(f.directory).files.map(f=>f.path));assert.ok(paths.has('retort/spreadRules.js'));assert.ok(paths.has('retort/spreadValues.js'));
});

test('extracted worker archive loads the SID local-work rules without workspace access', t => {
 const bundle=Bundle.build(root),verified=Bundle.inspect(bundle.bytes,bundle.hash);const directory=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-sid-extracted-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));for(const row of verified.files){const file=path.join(directory,row.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,row.bytes);}const rules=require(path.join(directory,'retort/sidLocalWork.js')).rules();assert.equal(typeof rules.field,'function');assert.equal(typeof require(path.join(directory,'retort/sidComposition.js')).generate,'function');
});

