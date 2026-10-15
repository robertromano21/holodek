'use strict';
const fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
(async () => {
  let receive, timer;
  const result = new Promise(resolve => { receive = resolve; });
  const server = http.createServer((req, res) => {
    if (req.url === '/report') { let body = ''; req.on('data', data => { body += data; }); req.on('end', () => { receive(JSON.parse(body)); res.end('ok'); }); return; }
    const file = req.url === '/' ? path.join(__dirname, 'save-game-ui-probe.html') : ['/assets/saveGameUi.js', '/assets/saveGameTranscript.js'].includes(req.url) ? path.join(__dirname, '..', req.url.slice(1)) : null;
    if (!file) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'application/javascript'); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-save-ui-'));
  const child = spawn(process.env.GPU_PROBE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=540,900', '--user-data-dir=' + profile, 'http://127.0.0.1:' + server.address().port], { windowsHide: true });
  let stderr = ''; child.stdout.on('data', () => {}); child.stderr.on('data', data => { stderr += data; });
  const stopped = new Promise(resolve => { child.once('error', e => resolve({ pass: false, error: e.message })); child.once('close', () => resolve({ pass: false, error: 'Browser closed before reporting.', stderr: stderr.slice(-1000) })); });
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ pass: false, error: 'Timed out.', stderr: stderr.slice(-1000) }), 20000); });
  const report = await Promise.race([result, stopped, timeout]); clearTimeout(timer); child.kill(); server.close();
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.pass ? 0 : 1;
})();
