'use strict';
// Explicit operator action: add save-only routes to this process without a
// restart. Never execute automatically from normal game startup or save/load.
const fs = require('node:fs'), path = require('node:path'), WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function targets() { try { const r = await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(1000) }); return await r.json(); } catch { return []; } }
async function main() {
  const pidFile = path.join(process.env.USERPROFILE, '.pm2/pids/gameServer-0.pid');
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw Error('Invalid running game PID.');
  let list = await targets(), opened = !list.length;
  if (opened) {
    if (typeof process._debugProcess !== 'function') throw Error('This Node build cannot attach to the existing game.');
    process._debugProcess(pid);
    for (let n = 0; n < 30 && !list.length; n++) { await sleep(100); list = await targets(); }
  }
  if (list.length !== 1 || !list[0].webSocketDebuggerUrl) throw Error('Cannot identify a unique local game inspector.');
  const ws = new WebSocket(list[0].webSocketDebuggerUrl); let sequence = 0; const waiting = new Map();
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { waiting.delete(id); reject(Error('Inspector request timed out.')); }, 20000);
    waiting.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  ws.on('message', bytes => { const message = JSON.parse(String(bytes)), task = waiting.get(message.id); if (!task) return;
    waiting.delete(message.id); clearTimeout(task.timer);
    if (message.error || message.result?.exceptionDetails) task.reject(Error(JSON.stringify(message.error || message.result.exceptionDetails)));
    else task.resolve(message.result.result.value);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let verified = false;
  try {
    const target = await evaluate('({pid:process.pid,cwd:process.cwd()})');
    if (target.pid !== pid || path.resolve(target.cwd).toLowerCase() !== root.toLowerCase()) throw Error('Inspector is not attached to this workspace game. No changes made.');
    verified = true;
    const modulePath = JSON.stringify(path.join(root, 'liveSaveBridge.js'));
    const result = await evaluate(`(async()=>{
      const app = process._getActiveHandles().flatMap(h=>typeof h.listeners==='function'?h.listeners('request'):[])
        .find(fn=>fn._router?.stack.some(layer=>layer.route?.path==='/processInput7'));
      if (!app) throw Error('The running game application was not found.');
      await process.mainModule.require(${modulePath}).install(app);
      return {installed:true,pid:process.pid,runId:process.mainModule.require(${JSON.stringify(path.join(root, 'sharedState.js'))}).getDungeonRunId(),slots:10,canLoad:false};
    })()`);
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    // Only close the inspector we opened, and only on the verified process.
    if (opened && verified) await evaluate("setTimeout(()=>process.mainModule.require('node:inspector').close(),250); true").catch(() => {});
    ws.close();
    for (const task of waiting.values()) { clearTimeout(task.timer); task.reject(Error('Inspector detached.')); }
  }
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
