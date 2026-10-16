'use strict';
// Isolated browser only: no game server, model requests, save writes or existing browser profile.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function main() {
  const page = fs.readFileSync(path.join(__dirname, 'retro-graphics-probe.html'));
  const roomImage = ['fresco-room-replay.png', 'saved-room-art-lighting.png'].map(name => path.join(root, 'logs/probes', name)).find(file => fs.existsSync(file));
  let resolveReport, child, timer, stage = 'loading';
  const report = new Promise(resolve => { resolveReport = resolve; });
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/progress?')) { stage = decodeURIComponent(req.url.slice(10)); res.end('ok'); return; }
    if (req.url === '/report' && req.method === 'POST') {
      let body = ''; req.on('data', bytes => { body += bytes; });
      req.on('end', () => { try { resolveReport(JSON.parse(body)); res.end('ok'); } catch { res.writeHead(400); res.end(); } }); return;
    }
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(page); return; }
    if (req.url === '/room-image' && roomImage) { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(roomImage)); return; }
    if (req.url === '/wall-image' || req.url === '/prop-image') {
      const file = path.join(root, 'sid/sprites', req.url === '/wall-image' ? '0,0,0_wall.png' : '0,0,0_pillar.png');
      if (fs.existsSync(file)) { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(file)); return; }
    }
    if (req.url === '/node_modules/phaser/dist/phaser.min.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(root, req.url.slice(1)))); return;
    }
    if (/^\/assets\/(retroGraphics|gameMenuUi|masonryPatterns|voxelMaterials|scenePropVoxels|renderCharacterProcedural|renderCharacterSprite|characterMotion3d|rendererWebGL)\.js$/.test(req.url)) {
      res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(root, req.url.slice(1)))); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-retro-graphics-'));
    const args = ['--headless=new', '--no-first-run', '--disable-background-networking', '--disable-sync', '--enable-unsafe-webgpu',
      '--window-size=1100,850', '--user-data-dir=' + profile, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'];
    if (process.argv.includes('--software')) args.push('--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
    args.push('http://127.0.0.1:' + server.address().port);
    child = spawn(process.env.GPU_PROBE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args, { windowsHide: true });
    let stderr = ''; child.stdout.on('data', () => {}); child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4000); });
    const stopped = new Promise(resolve => {
      child.once('error', error => resolve({ pass: false, error: error.message }));
      child.once('exit', () => resolve({ pass: false, error: 'Browser exited before reporting', stderr }));
    });
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ pass: false, error: 'Browser probe timed out', stage, stderr }), 45000); });
    const result = await Promise.race([report, stopped, timeout]); clearTimeout(timer);
    const directory = path.join(root, 'logs/probes'); fs.mkdirSync(directory, { recursive: true });
    for (const image of result.images || []) {
      if (!/^retro-graphics-[a-z-]+\.png$/.test(image.name)) throw new Error('Invalid probe image name');
      fs.writeFileSync(path.join(directory, image.name), Buffer.from(image.png.split(',')[1], 'base64'));
    }
    delete result.images; result.comparisonSource = roomImage || 'Synthetic animated scene';
    fs.writeFileSync(path.join(directory, 'retro-graphics.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.pass ? 0 : 1;
  } finally { clearTimeout(timer); child?.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
