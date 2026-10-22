// Box-only headless check: own Chrome, own profile, own port. Usage: node headless-check.mjs <steps.json> <outdir>
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import { createRequire } from 'node:module';
const WS = createRequire('/workspace/holodek-analysis/repo/')('ws');
const [,, stepsFile, OUT] = process.argv, steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8')); fs.mkdirSync(OUT, { recursive: true });
const PORT = 9900 + Math.floor(Math.random() * 90), sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn('/usr/bin/google-chrome', [...(process.env.HC_NOGL ? ['--no-sandbox', '--headless=new', '--disable-gpu', '--disable-webgl', '--disable-3d-apis'] : ['--no-sandbox', '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']), `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/hc-${PORT}`, '--window-size=' + (process.env.HC_SIZE || '1400,900'), 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 40 && !t; i++) { await sleep(400); try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page'); } catch {} }
const ws = new WS(t.webSocketDebuggerUrl); await new Promise(r => ws.on('open', r)); let id = 0; const pend = {}, errs = [];
ws.on('message', m => { const d = JSON.parse(m); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description?.slice(0, 200)); });
const cdp = (method, params = {}) => new Promise(r => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
await cdp('Runtime.enable'); await cdp('Page.enable');
const res = []; let n = 0;
for (const s of steps) { if (s.goto) { await cdp('Page.navigate', { url: s.goto }); await sleep(s.wait || 6000); continue; }
  if (s.eval) { const v = await ev(s.eval); res.push({ step: s.name || s.eval.slice(0, 50), value: v }); }
  await sleep(s.wait || 800);
  if (s.shot) { const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${String(++n).padStart(2, '0')}-${s.shot}.png`, Buffer.from(r.result.data, 'base64')); } }
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ res, errs }, null, 1)); console.log(JSON.stringify({ res, errs }, null, 1).slice(0, 6000));
ws.close(); chrome.kill();
