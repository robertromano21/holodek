'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
let installed;

function install({ platform = process.platform, ownerPid = process.pid, timeoutMs = 20000,
  start = spawn, directory = os.tmpdir(), windows = process.env.WINDIR || 'C:\\Windows' } = {}) {
  if (installed) return installed;
  if (platform !== 'win32') return { mode: 'graceful', ownerPid };
  const folder = fs.mkdtempSync(path.join(directory, 'holodek-process-owner-'));
  const statusFile = path.join(folder, 'ready.json'), token = randomBytes(24).toString('hex');
  const executable = path.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = path.join(__dirname, 'tools', 'runtime', 'game-process-owner.ps1');
  if (!fs.existsSync(executable) || !fs.existsSync(script)) throw Error('Windows game process containment is unavailable; no workers were started.');
  // This watchdog starts before assignment, outside the game's job. It holds the
  // only job handle until the exact owner process handle signals its exit.
  const child = start(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-OwnerPid', String(ownerPid), '-StatusFile', statusFile, '-Token', token],
    { windowsHide: true, stdio: 'ignore' });
  let failed;
  child.on('error', error => { failed = error; });
  const deadline = Date.now() + timeoutMs, sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (!failed && Date.now() < deadline) {
    if (fs.existsSync(statusFile)) {
      let status;
      try { status = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch { /* Atomic rename is completing. */ }
      if (status) {
        if (status.ownerPid !== ownerPid || status.token !== token) { failed = Error('Process ownership receipt mismatch.'); break; }
        if (!status.ready) { failed = Error(status.error || 'Windows process containment was not established.'); break; }
        installed = { mode: 'windows-job', ownerPid, watchdogPid: child.pid };
        child.unref(); return installed;
      }
    }
    Atomics.wait(sleeper, 0, 0, 20);
  }
  child.kill();
  for (const file of [statusFile, statusFile + '.tmp']) try { fs.unlinkSync(file); } catch {}
  try { fs.rmdirSync(folder); } catch {}
  throw Error('Game startup stopped before launching workers: ' + (failed?.message || 'Windows process containment timed out.'));
}

module.exports = { install };
