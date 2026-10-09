'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { createCanvas, loadImage } = require('canvas');
const { buildEnvironmentLab, biomeExhibits } = require('../retort/environmentLab');

const root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const software = argv.includes('--software') || process.env.GPU_PROBE_SOFTWARE === '1';
const summary = argv.includes('--summary');
const browser = process.env.GPU_PROBE_BROWSER || argv.find(a => !a.startsWith('--')) ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const limits = { width: 160, height: 120, initializationMs: 15000, frameMs: 10000, drawCalls: 600,
  fullAttemptMs: 20000, specializedAttemptMs: 45000, stdoutBytes: 8 * 1024 * 1024 };
const assetNames = ['masonryPatterns', 'voxelMaterials', 'scenePropVoxels', 'voxelCollision', 'terrainCamera', 'rendererWebGL'];
const started = Date.now();

function overview(kind, d) {
  const points = d.environmentLab.viewpoints;
  if (kind === 'badlands') return { ...points[1], label: 'Mesa across canyon', angle: .18 };
  if (kind === 'caldera') {
    const feature = d.outdoorTerrain.features.find(f => f.kind === 'caldera' && f.source);
    const target = { x: feature.x + feature.radiusX * .45, y: feature.y };
    const p = d.environmentLab.routes[0].points.reduce((best, p) =>
      Math.hypot(p.x - target.x, p.y - target.y) < Math.hypot(best.x - target.x, best.y - target.y) ? p : best);
    return { ...p, label: 'Rim toward crater', angle: Math.atan2(feature.y - p.y, feature.x - p.x) };
  }
  if (kind === 'uplands') return { ...points[0], label: 'Snow shelf toward peaks', angle: -Math.PI / 2 };
  if (kind === 'leafless') return { ...points[2], label: 'Yew stand toward hollow', angle: Math.PI };
  if (kind === 'modular-sanctuary') return { ...points[2], label: 'Groin-vaulted hall', angle: .35 };
  return { ...points[5], label: 'Gallery toward staircase', angle: 0 };
}

function stageLog(stderr) {
  return stderr.split(/\r?\n/).filter(line => /BiomeProbe|RendererStartup|Shader compilation|shader compile error|program link error|CONTEXT_LOST|GPU process/.test(line)).slice(-32);
}

async function edgeAttempt(server, outputDir, specialized) {
  const profile = fs.mkdtempSync(path.join(outputDir, specialized ? 'edge-zero-light-' : 'edge-production-'));
  const url = `http://127.0.0.1:${server.address().port}/${specialized ? '?zero-light=1' : ''}`;
  const args = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--enable-logging=stderr', '--window-size=800,700',
    '--virtual-time-budget=10000', '--dump-dom', `--user-data-dir=${profile}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', url];
  if (software) args.unshift('--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const child = spawn(browser, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const attemptStarted = Date.now();
  let stdout = '', stderr = '', timedOut = false, overflow = false;
  child.stdout.on('data', data => {
    if (stdout.length + data.length > limits.stdoutBytes) { overflow = true; child.kill(); return; }
    stdout += data;
  });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-1024 * 1024); });
  let hardStop;
  const timeout = setTimeout(() => {
    timedOut = true;
    // Kill only the Edge tree launched with this unique profile, including a stalled GPU subprocess.
    if (process.platform === 'win32' && Number.isInteger(child.pid)) {
      const kill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      kill.on('error', () => child.kill());
    } else child.kill();
    hardStop = setTimeout(() => { child.kill(); child.stdout.destroy(); child.stderr.destroy(); }, 1500);
  }, specialized ? limits.specializedAttemptMs : limits.fullAttemptMs);
  const completion = await new Promise(resolve => {
    child.once('error', error => resolve({ error: error.message }));
    child.once('close', (status, signal) => resolve({ status, signal }));
  });
  clearTimeout(timeout); clearTimeout(hardStop);
  let report;
  try {
    const text = stdout.match(/<pre id="results">([\s\S]*?)<\/pre>/)?.[1];
    report = JSON.parse(text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  } catch { report = { pass: false, error: timedOut ? 'Bounded Edge attempt timed out' : completion.error || 'No completed browser report' }; }
  const name = specialized ? 'zero-light' : 'production';
  fs.writeFileSync(path.join(outputDir, `${name}-edge.log`), stderr);
  const details = { ...completion, wallMs: Date.now() - attemptStarted, timedOut, overflow, specialized,
    profile, report, rendererLog: stageLog(stderr) };
  return details;
}

async function saveScreenshots(report, outputDir) {
  const images = [];
  for (const exhibit of report.exhibits || []) for (const frame of exhibit.frames || []) {
    if (!/^data:image\/png;base64,/.test(frame.png || '')) throw new Error('Fixture did not return a PNG frame');
    const png = Buffer.from(frame.png.split(',')[1], 'base64');
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.length > 1024 * 1024) throw new Error('Invalid or oversized screenshot');
    const name = `${exhibit.kind}-${frame.view}.png`;
    if (!/^[a-z-]+\.png$/.test(name)) throw new Error('Invalid fixture screenshot name');
    frame.screenshot = path.join(outputDir, name);
    fs.writeFileSync(frame.screenshot, png);
    delete frame.png;
    images.push({ name, label: `${exhibit.kind} / ${frame.label}`, image: await loadImage(png) });
  }
  if (!images.length) return null;
  const cellWidth = 480, cellHeight = 390, columns = 3;
  const sheet = createCanvas(cellWidth * columns, cellHeight * Math.ceil(images.length / columns));
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#181c1c'; ctx.fillRect(0, 0, sheet.width, sheet.height); ctx.imageSmoothingEnabled = false;
  images.forEach((entry, i) => {
    const x = i % columns * cellWidth, y = Math.floor(i / columns) * cellHeight;
    ctx.drawImage(entry.image, x, y, cellWidth, 360);
    ctx.fillStyle = '#e7ddbd'; ctx.font = '16px monospace'; ctx.fillText(entry.label, x + 8, y + 382);
  });
  const filename = path.join(outputDir, 'contact-sheet.png');
  fs.writeFileSync(filename, sheet.toBuffer('image/png'));
  return filename;
}

async function main() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-biome-visual-'));
  const html = fs.readFileSync(path.join(__dirname, 'biome-visual-probe.html'), 'utf8');
  for (const [, source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (source.trim()) new vm.Script(source);
  const assets = new Map(assetNames.map(name => [`/assets/${name}.js`, fs.readFileSync(path.join(root, 'assets', `${name}.js`))]));
  const sourceHashes = Object.fromEntries([...assetNames.map(name => `assets/${name}.js`),
    'retort/environmentLab.js', 'retort/sceneArchitecture.js', 'retort/sceneRoofs.js',
    'tests/run-biome-visual-probe.cjs', 'tests/biome-visual-probe.html'].map(name => [name,
    createHash('sha256').update(assets.get(`/${name}`) || fs.readFileSync(path.join(root, name))).digest('hex')]));
  const exhibits = Object.keys(biomeExhibits).map(kind => {
    const dungeon = buildEnvironmentLab(kind);
    if (Object.values(dungeon.cells).some(c => c.tile === 'torch')) throw new Error('Zero-light fixtures cannot contain live torches');
    return { kind, dungeon, views: [{ ...dungeon.start, label: 'Spawn', view: 'spawn', angle: -Math.PI / 2 },
      { ...overview(kind, dungeon), view: 'overview' }] };
  });
  if (exhibits.length !== 6) throw new Error('Expected exactly six seeded biome fixtures');
  const fixtures = `window.BIOME_FIXTURES=${JSON.stringify({ exhibits, limits }).replace(/</g, '\\u003c')};`;
  const requests = [], rejectedRequests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push(`${req.method} ${url.pathname}`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'");
    if (req.method === 'GET' && url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); }
    else if (req.method === 'GET' && url.pathname === '/fixtures.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(fixtures); }
    else if (req.method === 'GET' && assets.has(url.pathname)) { res.setHeader('Content-Type', 'application/javascript'); res.end(assets.get(url.pathname)); }
    else if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); }
    else { rejectedRequests.push(`${req.method} ${url.pathname}`); res.writeHead(404); res.end(); }
  });
  const attempts = [];
  let report, error, contactSheet;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    attempts.push(await edgeAttempt(server, outputDir, false));
    let last = attempts.at(-1);
    // A fallback is permitted only after a real unmodified SwiftShader attempt stalls.
    if (last.timedOut && (software || last.rendererLog.some(line => /SwiftShader/i.test(line)))) {
      attempts.push(await edgeAttempt(server, outputDir, true)); last = attempts.at(-1);
    }
    report = last.report;
    contactSheet = await saveScreenshots(report, outputDir);
  } catch (caught) { error = caught.stack; }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  const sourceDrift = Object.entries(sourceHashes).filter(([name, hash]) =>
    createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') !== hash).map(([name]) => name);
  const pass = !error && !sourceDrift.length && !rejectedRequests.length && report?.pass === true && attempts.at(-1)?.status === 0 && !attempts.at(-1)?.overflow;
  const output = { pass, wallMs: Date.now() - started, software, browser, outputDir, contactSheet, limits, sourceHashes,
    specialization: attempts.at(-1)?.specialized ? 'Original production shaders compiled first; only world accumulateTorchLit replaced by a zero-light return for rendering after the full SwiftShader attempt timed out. Voxel/sprite shaders and world traversal unchanged.' : 'None; unmodified production shader path requested.',
    attempts, requests, rejectedRequests, sourceDrift, error };
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(output, null, 2));
  const brief = { pass, wallMs: output.wallMs, outputDir, contactSheet, adapter: report?.adapter,
    originalShadersCompiled: report?.originalShadersCompiled, initializationMs: report?.initializationMs,
    specialization: output.specialization, attempts: attempts.map(a => ({ specialized: a.specialized, wallMs: a.wallMs, timedOut: a.timedOut, status: a.status, error: a.report.error })),
    exhibits: report?.exhibits?.map(e => ({ kind: e.kind, shapes: e.meshes.length,
      frames: e.frames.map(f => ({ view: f.view, nonblackPixels: f.nonblackPixels, drawCalls: f.drawCalls, voxelDrawCalls: f.voxelDrawCalls, frameMs: f.frameMs, glErrors: f.glErrors, screenshot: f.screenshot })) })),
    rejectedRequests, sourceDrift, error: error || report?.error };
  console.log(JSON.stringify(summary ? brief : output, null, 2));
  process.exitCode = pass ? 0 : 1;
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
