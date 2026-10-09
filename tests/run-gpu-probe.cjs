const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const browser = process.env.GPU_PROBE_BROWSER || process.argv.slice(2).find(a => !a.startsWith('--')) ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'holodek-gpu-probe-'));
const blank = process.argv.includes('--blank');
const args = ['--headless=new', '--no-first-run', '--enable-logging=stderr', `--user-data-dir=${profile}`, '--dump-dom',
  blank ? 'about:blank' : pathToFileURL(path.join(__dirname, 'dungeon-gpu-probe.html')).href];
if (process.env.GPU_PROBE_SOFTWARE === '1' || process.argv.includes('--software')) args.unshift('--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const started = Date.now();
console.log('Starting isolated GPU probe:', browser);
const result = spawnSync(browser, args, { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
const content = result.stdout?.match(/<pre id="results">([^<]*)<\/pre>/)?.[1];
let report;
try { report = blank ? { pass: result.stdout?.includes('<body>') } : JSON.parse(content); }
catch { report = { error: 'Browser did not return probe results' }; }
const output = { wallMs: Date.now() - started, status: result.status,
  processError: result.error?.message, report,
  rendererLog: result.stderr?.split(/\r?\n/).filter(line => /RendererStartup|Shader compilation|Shader linking|CONTEXT_LOST|GPU process/.test(line)).slice(-24) };
console.log(JSON.stringify(process.argv.includes('--summary') ? { wallMs: output.wallMs, status: output.status,
  processError: output.processError, pass: report.pass, adapter: report.adapter,
  initializationMs: report.initializationMs, nearClip: report.nearClip, error: report.error } : output, null, 2));
process.exitCode = report.pass && !result.error ? 0 : 1;
