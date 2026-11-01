'use strict';
const fs = require('node:fs'), path = require('node:path'), { execFileSync, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..'), URL = 'http://localhost:3000';
const GAME_URL = URL + '/assets/index.html';

function rows(output) {
  if (Array.isArray(output)) return output;
  // A newly started PM2 daemon can print a banner before jlist's JSON.
  for (let at = String(output).indexOf('['); at >= 0; at = String(output).indexOf('[', at + 1)) {
    try { const value = JSON.parse(String(output).slice(at).trim()); if (Array.isArray(value)) return value; } catch {}
  }
  throw Error('PM2 process ownership could not be verified. Nothing was restarted.');
}
function application(list, root = ROOT) {
  const found = list.filter(row => row.name === 'gameServer');
  if (found.length > 1) throw Error('Multiple gameServer entries exist. Nothing was restarted.');
  const row = found[0]; if (!row) return null;
  const env = row.pm2_env || {}, key = value => path.resolve(value || '').toLowerCase();
  if (key(env.pm_cwd) !== key(root) || key(env.pm_exec_path) !== key(path.join(root, 'server.js')) ||
      Number(env.HOLODEK_PORT || env.PORT || env.env?.HOLODEK_PORT || env.env?.PORT || 3000) !== 3000)
    throw Error('gameServer belongs to another project or port. Nothing was restarted.');
  return row;
}
function pm(args) {
  const cli = path.join(process.env.APPDATA || '', 'npm/node_modules/pm2/bin/pm2');
  if (!fs.existsSync(cli)) throw Error('This Holodek installation needs its existing Node/PM2 runtime configured.');
  return execFileSync(process.execPath, [cli, ...args], { cwd: ROOT, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
}
async function health() {
  try {
    const response = await fetch(URL + '/game/lifecycle', { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    if (!response.ok) return null;
    const value = await response.json(); return Number.isInteger(value.pid) && value.port === 3000 ? value : null;
  } catch { return null; }
}
function chromePath({ env = process.env, exists = fs.existsSync } = {}) {
  const candidates = [env.CHROME, ...[env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
    .filter(Boolean).map(directory => path.join(directory, 'Google/Chrome/Application/chrome.exe'))];
  const executable = candidates.find(file => file && path.isAbsolute(file) && exists(file));
  if (!executable) throw Error('Chrome could not be found. Install Chrome or set CHROME to its executable. No regular browser window was opened.');
  return executable;
}
async function openIncognito(url = GAME_URL, { spawnProcess = spawn, env = process.env, exists = fs.existsSync } = {}) {
  if (url !== GAME_URL) throw Error('The launcher only opens the Holodek game page.');
  const executable = chromePath({ env, exists });
  await new Promise((resolve, reject) => {
    const child = spawnProcess(executable, ['--incognito', '--new-window', url],
      { windowsHide: true, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    // Chrome may stay alive for the whole game, or hand the window to its
    // existing process. Neither case should hold the hidden launcher open.
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
function idle(view, pid) {
  return view?.running === true && view.canQuit === true && Number.isSafeInteger(view.pid) && view.pid > 0 &&
    view.connectedWindows === 0 && (pid === undefined || view.pid === pid);
}
async function runIdFromStream(response) {
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
    throw Error('The leftover game could not identify its adventure. Nothing was closed.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 262144) break;
      pending += decoder.decode(value, { stream: true });
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
        if (!line.startsWith('data:')) continue;
        let event; try { event = JSON.parse(line.slice(5)); } catch { continue; }
        if (event?.type === 'dungeonRun' && typeof event.runId === 'string' && event.runId.length > 0 && event.runId.length <= 128)
          return event.runId;
      }
    }
    throw Error('The leftover game did not identify its adventure. Nothing was closed.');
  } finally { await reader.cancel().catch(() => {}); }
}
async function quitIdleGame({ root = ROOT, view, getHealth = health, request = fetch, beforeQuit,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, timeoutMs = 10000, url = URL }) {
  if (!idle(view)) throw Error('The leftover game has an open window or cannot quit safely. Nothing was closed.');
  // A fresh file round-trip proves the responding server serves this project,
  // rather than trusting an unrelated listener's claimed PID or product name.
  const name = 'holodek-launch-' + randomBytes(24).toString('hex') + '.txt', proof = randomBytes(32).toString('hex');
  const file = path.join(root, 'assets/debug', name);
  const options = () => ({ signal: AbortSignal.timeout(3000), cache: 'no-store', redirect: 'error' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, proof, { flag: 'wx', mode: 0o600 });
  try {
    const response = await request(url + '/assets/debug/' + name, options());
    if (!response.ok || await response.text() !== proof)
      throw Error('Port 3000 could not prove it belongs to this Holodek project. Nothing was closed.');
  } finally { fs.unlinkSync(file); }
  const runId = await runIdFromStream(await request(url + '/combat-updates2', options()));
  if (!idle(await getHealth(), view.pid)) throw Error('The adventure or its windows changed. Nothing was closed.');
  await beforeQuit();
  if (!idle(await getHealth(), view.pid)) throw Error('The adventure or its windows changed. Nothing was closed.');
  const response = await request(url + '/game/quit', { ...options(), method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, confirm: true, expectedPid: view.pid, requireNoWindows: true }) });
  const result = await response.json();
  if (!response.ok || result.quitting !== true) throw Error(result.error || 'The leftover game declined safe shutdown.');
  const deadline = now() + timeoutMs;
  do {
    const current = await getHealth(); if (!current) return;
    if (current.pid !== view.pid) throw Error('The server changed during shutdown. Nothing else was stopped.');
    await delay(250);
  } while (now() < deadline);
  throw Error('The leftover game has not finished closing. No process was force-stopped.');
}
async function startGame({ runPm = pm, getHealth = health, openWindow = openIncognito, delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, timeoutMs = 35000, root = ROOT, closeLeftover = quitIdleGame } = {}) {
  let row = application(rows(runPm(['jlist'])), root), view = await getHealth();
  if (row?.pid === 0 && view?.running) {
    await closeLeftover({ root, view, getHealth, delay, now, beforeQuit: async () => {
      const current = application(rows(runPm(['jlist'])), root);
      if (current?.pid !== 0 || !['online', 'stopped', 'errored', 'waiting restart'].includes(current.pm2_env.status))
        throw Error('PM2 ownership changed. The leftover game was left running.');
      // Clear stale restart scheduling before asking the verified game to quit.
      runPm(['stop', 'gameServer']);
      const stopped = application(rows(runPm(['jlist'])), root);
      if (stopped?.pid !== 0 || stopped.pm2_env.status !== 'stopped')
        throw Error('PM2 could not stop its stale entry. The leftover game was left running.');
    } });
  } else if (row?.pm2_env.status === 'online') {
    if (!view || view.pid !== row.pid) throw Error('PM2 and the responding game disagree (PM2 PID ' + row.pid +
      ', server PID ' + (view?.pid ?? 'unavailable') + '). The adventure was left running.');
    const stops = Array.isArray(row.pm2_env.stop_exit_codes) ? row.pm2_env.stop_exit_codes.map(Number) : [];
    if (view.running && (view.connectedWindows > 0 || view.processOwnership === 'windows-job' && stops.includes(0) && stops.includes(73))) {
      await openWindow(GAME_URL); return { reused: true, pid: row.pid };
    }
  } else if (view?.running) throw Error('Port 3000 belongs to an unverified process. Nothing was restarted.');
  runPm(['startOrReload', path.join(root, 'ecosystem.config.cjs'), '--only', 'gameServer', '--update-env']);
  const deadline = now() + timeoutMs;
  do {
    row = application(rows(runPm(['jlist'])), root); view = await getHealth();
    if (row?.pm2_env.status === 'online' && view?.running && view.pid === row.pid && view.processOwnership === 'windows-job') {
      await openWindow(GAME_URL); return { reused: false, pid: row.pid };
    }
    await delay(250);
  } while (now() < deadline);
  throw Error('The game did not become ready with process cleanup enabled. No other application was stopped.');
}

module.exports = { startGame, application, rows, quitIdleGame, runIdFromStream, chromePath, openIncognito, GAME_URL };
if (require.main === module) startGame().catch(error => {
  fs.mkdirSync(path.join(ROOT, '.retort-data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, '.retort-data/startup-error.log'), new Date().toISOString() + '\n' + error.message + '\n');
  process.exitCode = 1;
});
