// world1 PC full-pass driver (no installs): Chrome DevTools Protocol over Node's built-in WebSocket.
// Drives the real page exactly like a player: types into #chatuserinput and presses the Command button (normal
// /processInput7 pass with the full client payload), walks to exits, clicks a book. Records per turn: console input,
// full request bodies, resulting state, browser console. Model requests/responses are recorded server-side by capture.cjs.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:3001/assets/index.html';
const OUT = path.resolve(process.env.HARNESS_OUT || 'world1-run'); fs.mkdirSync(path.join(OUT, 'requests'), { recursive: true });
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const redact = s => String(s).replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-<redacted>');
const log = (f, row) => fs.appendFileSync(path.join(OUT, f), redact(typeof row === 'string' ? row : JSON.stringify(row)) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let turn = 0;
// HEADED=1: visible, maximized incognito window with its own profile dir (the normal Chrome profile is never used).
const HEADED = process.env.HEADED === '1';
const PORT = Number(process.env.CDP_PORT) || 9400 + Math.floor(Math.random() * 500); // unique per run
const SPEEDS = { fast: { char: 12, after: 600 }, normal: { char: 40, after: 1500 }, slow: { char: 90, after: 2500 } };
const SPEED = SPEEDS[process.env.SPEED || 'fast'] || SPEEDS.fast, PACE = HEADED ? SPEED.after : 0, CHAR_MS = HEADED ? SPEED.char : 0;
const chromeArgs = HEADED ? ['--incognito', '--start-maximized', '--new-window', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'chrome-visible-profile')}`, '--no-first-run', '--no-default-browser-check', BASE]
  : ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'chrome-profile')}`, '--window-size=1280,860', '--no-first-run', 'about:blank'];
const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore' });
const pause = () => sleep(PACE);
const START_CLICKS = ['review-save-button', 'Save and Continue'];
// Attach ONLY to the Chrome we launched: the debugging port must be owned by our PID, and only to its localhost:3001 page.
const owner = () => { try { return Number(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`], { encoding: 'utf8' }).trim()) || null; } catch { return null; } };
let pageWs, verified = false;
for (let i = 0; i < 120 && !pageWs; i++) { await sleep(500);
  if (!verified) { const o = owner(); if (o == null) continue; if (o !== chrome.pid) { log('turns.log', { abort: `debug port ${PORT} owned by pid ${o}, not launched chrome ${chrome.pid}` }); chrome.kill(); process.exit(2); } verified = true; }
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); pageWs = list.find(t => t.type === 'page' && (t.url.startsWith('http://localhost:3001') || !HEADED && t.url === 'about:blank'))?.webSocketDebuggerUrl; } catch {} }
if (!pageWs) { log('turns.log', { abort: 'no localhost:3001 page target in the launched chrome' }); chrome.kill(); process.exit(2); }
log('turns.log', { attached: { pid: chrome.pid, port: PORT, verifiedOwner: verified } });
const ws = new WebSocket(pageWs); await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pending = new Map(), handlers = {};
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } else if (m.method) (handlers[m.method] || []).forEach(h => h(m.params)); });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
// Watched run: closing the test window (X) ends the test. Chrome exit or DevTools disconnect -> summary, stop server, exit.
const SUMMARY_DIR = process.env.PLAYTEST_SUMMARY_DIR || path.join(process.cwd(), 'playtest-run'); fs.mkdirSync(SUMMARY_DIR, { recursive: true });
let finishing = false;
const finish = reason => { if (finishing) return; finishing = true;
  let lines = []; try { lines = fs.readFileSync(path.join(OUT, 'turns.log'), 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return {}; } }); } catch {}
  let stats = null; try { stats = JSON.parse(fs.readFileSync(path.join(SUMMARY_DIR, 'model-stats.json'), 'utf8')); } catch {}
  const decisions = lines.filter(l => l.playerDecision).map(l => `  turn ${l.turn}: ${l.playerDecision}`);
  const errors = lines.filter(l => l.harnessError || l.serverDied).map(l => '  ' + (l.harnessError || 'server died: ' + l.serverDied));
  fs.writeFileSync(path.join(SUMMARY_DIR, 'summary.txt'), [`Holodek watched playtest - ended ${new Date().toISOString()}`, `End reason: ${reason}`, `Turns: ${turn}`,
    `Console commands: ${lines.filter(l => l.consoleInput).length}, walks: ${lines.filter(l => l.walk).length}, start clicks: ${lines.filter(l => l.startFlowClick).length}`,
    'Player decisions:', ...(decisions.length ? decisions : ['  (none)']), 'Errors:', ...(errors.length ? errors : ['  (none)']),
    `Model calls: ${stats ? JSON.stringify({ total: stats.total, live: stats.live, mocked: stats.mocked, handwritten: stats.handwritten }) : 'n/a'}`, `Logs: ${OUT}`].join('\r\n'));
  log('turns.log', { turn, ended: reason, at: new Date().toISOString() });
  if (process.env.KEEP_SERVER !== '1') try { execFileSync('pm2', ['stop', 'gameServer-world1-test'], { stdio: 'ignore', shell: true }); } catch {}
  try { chrome.kill(); } catch {}
  process.exit(0); };
ws.addEventListener('close', () => finish('test window closed (DevTools disconnected)'));
chrome.on('exit', code => finish(`test Chrome exited (code ${code})`));
// Bring our own window to the foreground (Browser domain on our target only).
try { const { windowId } = await send('Browser.getWindowForTarget'); await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }); await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } }); } catch (e) { log('turns.log', { focusNote: e.message }); }
const on = (m, h) => (handlers[m] ||= []).push(h);
const evaluate = async (fn, ...args) => { const r = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true, timeout: 600000 });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); };
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable', { maxPostDataSize: 20 * 1024 * 1024 });
if (!HEADED) await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
on('Runtime.consoleAPICalled', p => log('browser-console.log', `[turn ${turn}] ${p.type}: ${p.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 2000)}`));
on('Runtime.exceptionThrown', p => log('browser-console.log', `[turn ${turn}] PAGEERROR ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`));
on('Network.requestWillBeSent', async p => { const r = p.request; if (r.method !== 'POST' || !r.url.startsWith('http://localhost:3001/')) return;
  let body = r.postData || ''; if (!body && r.hasPostData) try { body = (await send('Network.getRequestPostData', { requestId: p.requestId })).postData; } catch {}
  const n = `${String(turn).padStart(2, '0')}-${Date.now()}-${r.url.replace('http://localhost:3001/', '').replace(/\W+/g, '_')}.json`;
  fs.writeFileSync(path.join(OUT, 'requests', n), redact(body)); log('requests.log', { turn, url: r.url.replace('http://localhost:3001/', ''), bytes: body.length, file: n }); });
if (!HEADED) await send('Page.navigate', { url: BASE }); else await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 360; i++) { await sleep(500); try { if (await evaluate(() => !!document.getElementById('chatuserinput') && typeof window.chatbotprocessinput === 'function')) break; } catch {} }
await sleep(3000);
const state = async label => { const s = await evaluate(() => {
  const db = typeof roomNameDatabase !== 'undefined' ? Object.fromEntries(roomNameDatabase) : {}, d = typeof currentDungeon !== 'undefined' ? currentDungeon : null, key = d?.geoKey, room = db[key] || {};
  const arts = (d?.surfaceArt || []).filter(a => ['fresco', 'mosaic'].includes(a.kind)).map(a => ({ kind: a.kind, title: a.title, figures: (window.SurfaceArt?.figureBoxes?.(a) || []).length }));
  const pop = window.DungeonLife?.population?.();
  return { coords: typeof currentCoordinates !== 'undefined' ? currentCoordinates : null, geoKey: key, player: { x: typeof playerPosX !== 'undefined' ? playerPosX : null, y: typeof playerPosY !== 'undefined' ? playerPosY : null },
    layout: d?.layout, start: d?.start, origin: d?._world1Start, arrival: window._world1Arrival || null, exits: (d?.roomExits?.markers || []).map(m => ({ direction: m.direction, x: m.x, y: m.y })),
    frames: (d?.sceneStructures || []).filter(p => p.role === 'journey-exit-frame').map(p => ({ shape: p.shape, carved: !!d.tiles?.[p.tile]?.spriteSpec?.stoneCarving })),
    moldings: (d?.moldingArt || []).map(m => m.stoneworkRole + ':' + m.moldingStyle), bands: (d?.surfaceArt || []).filter(a => a.carvingStyle).map(a => a.carvingStyle + (a.ornamentSecond ? '+' + a.ornamentSecond + '/' + a.ornamentWeave : '')),
    pyramid: d?.pyramidFeature || null, shelfBooks: window.LibraryBooks?.books(d).length || 0, cityParts: (d?.sceneStructures || []).filter(p => p.world1City).length, murals: arts,
    illustration: room.illustration ? { palette: room.illustration.plan?.palette, lighting: room.illustration.plan?.lighting, composition: room.illustration.plan?.composition, kinds: (room.illustration.plan?.layers || []).map(l => l.kind) } : null,
    footExits: room.footExits || null, pendingFootExits: db['0,0,0']?.pendingFootExits || null,
    cast: pop?.roomCast ? { arcs: pop.roomCast.arcs.map(a => ({ title: a.title, difficulty: a.difficulty, localStages: a.localStages, stage: a.stage })) } : null,
    ambush: (pop?.groups || []).filter(g => g.ambush).map(g => ({ id: g.id, ambush: g.ambush })),
    missions: Object.values(room.minorMissions || {}).map(m => ({ id: m.id, status: m.status, reward: m.rewardSilver })),
    questMarkers: window.QuestMap ? window.QuestMap.mapMarkers(d, roomNameDatabase, { flags: window.HolodekFlags, landmarks: window.LandmarkCatalog?.catalog(d) || [] }) : null,
    cities: (db['0,0,0']?.campaignAtlas?.map?.cities || []).map(c => ({ name: c.name, site: c.site })), placement: db['0,0,0']?.campaignAtlas?.map?.placement || null,
    books: Object.values(db).flatMap(r => (r.readables || []).filter(x => x.bookLore).map(x => ({ name: x.name, title: x.title, author: x.author, published: x.published, chapters: x.chapters.map(c => ({ title: c.title, chars: c.text.length })) }))),
    bookFacts: db['0,0,0']?.bookFacts?.length || 0, rooms: Object.keys(db), historyRuns: db['0,0,0']?.crossGameHistory?.runs?.length || 0, flags: window.HolodekFlags,
    inventory: typeof inventory !== 'undefined' ? [...inventory].slice(0, 30) : null, console: (document.getElementById('chatlog')?.innerText || '').slice(-1500) }; });
  log('states.jsonl', { turn, label, ...s }); return s; };
let serverMisses = 0;
const serverAlive = async () => { try { const r = await fetch(BASE, { method: 'HEAD', signal: AbortSignal.timeout(5000) }); serverMisses = r.ok ? 0 : serverMisses + 1; } catch { serverMisses++; }
  if (serverMisses >= 3) { log('turns.log', { turn, serverDied: BASE, at: new Date().toISOString() }); throw Error(`test server stopped answering at ${BASE}; pass aborted (check pm2 logs)`); } };
const idle = async (timeout = 900000) => { const until = Date.now() + timeout; await sleep(3000);
  while (Date.now() < until) { await serverAlive(); const busy = await evaluate(() => !!window._characterStartupPending || /Loading\.\.\.$/.test(document.getElementById('chatlog')?.innerText || '') || !!document.querySelector('#chatbotbutton[disabled]')); if (!busy) break; await sleep(1500); }
  await sleep(2000); };
let clickCount = 0;
const command = async (text, idleMs = 900000) => { await serverAlive(); turn++; log('turns.log', { turn, consoleInput: text, at: new Date().toISOString() });
  await pause();
  await evaluate(() => { const p = document.getElementById('popup'); if (p) p.style.display = 'block'; const el = document.getElementById('chatuserinput'); el.value = ''; el.focus(); });
  for (const ch of text) { await evaluate(c => { const el = document.getElementById('chatuserinput'); el.value += c; el.dispatchEvent(new Event('input', { bubbles: true })); }, ch); if (CHAR_MS) await sleep(CHAR_MS); }
  await pause();
  await evaluate(() => { const b = document.getElementById('chatbotbutton'); if (b) b.click(); else chatbotprocessinput(); });
  await idle(idleMs); await pause(); return state(`after "${text}"`); };
const walkTo = async direction => { turn++; log('turns.log', { turn, walk: direction, at: new Date().toISOString() });
  const ok = await evaluate(dir => { const m = currentDungeon?.roomExits?.markers?.find(x => x.direction === dir); if (!m) return false; playerPosX = m.x + .5; playerPosY = m.y + 1.6; return true; }, direction);
  if (!ok) return { error: `no ${direction} exit marker` };
  for (let i = 0; i < 10; i++) { await sleep(500); await evaluate(dir => { const m = currentDungeon.roomExits.markers.find(x => x.direction === dir); playerPosX = m.x + .5; playerPosY = m.y + .5; }, direction); }
  const go = await evaluate(() => { const b = [...document.querySelectorAll('.popup-container[data-dungeon-exit] button')].find(b => /^\s*go\b/i.test(b.textContent)); if (b) { b.click(); return b.textContent; } return null; });
  log('turns.log', { turn, walkPrompt: go }); await idle(); await pause(); return state(`after walking ${direction}`); };
const bookPass = async () => {
  const target = await evaluate(() => { const d = currentDungeon, shelf = window.LibraryBooks?.books(d)?.[0];
    if (shelf) { const [x, y] = shelf.shelfKey.split(',').map(Number); playerPosX = x + .5 + (shelf.axis === 'x' ? shelf.sign : 0); playerPosY = y + .5 + (shelf.axis === 'y' ? shelf.sign : 0); return { name: shelf.name, via: 'shelf' }; }
    const inv = typeof inventory !== 'undefined' ? [...inventory].map(String) : []; const book = inv.find(n => window.LibraryBooks?.isBookName(n)); return book ? { name: book, via: 'inventory' } : null; });
  log('turns.log', { turn, bookTarget: target });
  if (!target) return null;
  await command(`read ${target.name}`);
  await evaluate(n => window.BookReaderUi?.render(n, 0), target.name); await pause(); await shot('shot-book-cover.png'); await evaluate(() => window.BookReaderUi?.close());
  await command(`I want to read chapter 1 of the ${target.name}`);
  await evaluate(n => window.BookReaderUi?.render(n, 1), target.name); await pause(); await pause(); await shot('shot-book-chapter.png'); await evaluate(() => window.BookReaderUi?.close());
  return target; };
try {
  // New game exactly as a player: type Start, pick a start-menu option, then click through the page's own start/review buttons.
  turn = 0; log('turns.log', { turn, action: 'new game through the in-page start flow: Start -> menu option ' + (process.env.START_OPTION || '2') });
  await command('Start', 20000); await command(process.env.START_OPTION || '2', 20000);
  for (let i = 0; i < 40; i++) {
    if (await evaluate(() => !!(typeof currentDungeon !== 'undefined' && currentDungeon?.geoKey))) break;
    const clicked = await evaluate(extra => { const vis = e => e.offsetParent !== null && !e.disabled;
      const all = [...document.querySelectorAll('button, input[type=button], input[type=submit]')].filter(vis);
      // Setup screens first: the character review's 'Save and Continue' (#review-save-button), then any scenario-named buttons.
      const b = all.find(x => x.id === 'review-save-button' || /save\s*(and|&)\s*continue/i.test(x.textContent || x.value))
        || all.find(x => (extra || []).some(t => x.id === t || (x.textContent || x.value || '').trim().toLowerCase() === String(t).toLowerCase()))
        || all.find(x => /\b(start|begin|play|accept|confirm|continue|proceed|enter|ready|use this|keep)\b/i.test(x.textContent || x.value) && !/quit|cancel|reroll|regenerate|back/i.test(x.textContent || x.value));
      if (b) { b.click(); return ((b.id ? '#' + b.id + ' ' : '') + (b.textContent || b.value).trim()).slice(0, 80); } return null; }, START_CLICKS);
    if ((clickCount = (clickCount || 0) + 1) > 25) throw Error('start flow stuck: setup buttons were clicked 25 times without the room loading; see server.log'); log('turns.log', { turn, startFlowClick: clicked });
    await (clicked ? idle(600000) : sleep(3000)); await pause();
  }
  await idle(1500000); await state('temple 0,0,0 after new game'); await shot('shot-temple.png');
  // Adaptive player: read the visible state, choose the next move, log why.
  const MAX = Number(process.env.HOLODEK_MAX_TURNS || 14), done = { talked: new Set(), murals: false, book: false, quest: false, walked: new Set(), map: false };
  for (let t = 0; t < MAX; t++) {
    const s = await state(`player turn ${t}`);
    const view = await evaluate(() => { const pop = window.DungeonLife?.population?.() || {}, actors = Object.values(pop.actors || {}).filter(a => a.status === 'present');
      return { combat: !!(window.actionDiceState?.active?.kind === 'combat' || document.querySelector('#combat-panel:not([hidden]), .combat-popup[style*=block]')),
        npcs: actors.filter(a => a.allegiance !== 'Hostile').map(a => a.name), hostiles: actors.filter(a => a.allegiance === 'Hostile').map(a => a.name),
        log: (document.getElementById('chatlog')?.innerText || '').slice(-600) }; });
    let why, act;
    if (view.combat) { why = 'combat active'; act = () => command(view.hostiles[0] ? `attack ${view.hostiles[0]}` : 'attack'); }
    else if (view.npcs.find(n => !done.talked.has(n))) { const n = view.npcs.find(n => !done.talked.has(n)); done.talked.add(n); why = 'unmet NPC'; act = () => command(`talk to ${n}`); }
    else if (!done.quest && (s.cast?.arcs?.length || /quest|task|errand|help us/i.test(view.log))) { done.quest = true; why = 'quest offered'; act = () => command('I accept the quest. What must I do?'); }
    else if (!done.murals && s.murals?.length) { done.murals = true; why = 'mural in room'; act = async () => { await evaluate(() => window.WorldInteractionUi?.hoverFirst?.('mural')); await shot(`shot-mural-${t}.png`); return command(`examine the ${s.murals[0].kind}`); }; }
    else if (!done.book && (s.shelfBooks || (s.inventory || []).some(n => window?.LibraryBooks ? false : /book|tome|scroll|codex/i.test(n)))) { done.book = true; why = 'book available'; act = bookPass; }
    else { const e = (s.exits || []).map(x => x.direction).find(d => !done.walked.has(s.geoKey + d) && d !== 'portal');
      if (e) { done.walked.add(s.geoKey + e); why = `unwalked exit ${e}`; act = async () => { const r = await walkTo(e); await shot(`shot-walk-${t}-${e}.png`); return r; }; }
      else if (!done.map) { done.map = true; why = 'check the map'; act = () => command('look at the map'); }
      else { why = 'nothing new: look around'; act = () => command('search the room'); } }
    log('turns.log', { turn, playerDecision: why });
    await act();
  }
  await state('final');
} catch (e) { log('turns.log', { turn, harnessError: e.message }); }
log('turns.log', { turn, done: true, at: new Date().toISOString() });
if (!HEADED) { try { await send('Browser.close'); } catch {} chrome.kill(); finish('headless pass finished'); }
// headed: the pass is over but the window stays open; the test ends when the user closes it.
log('turns.log', { turn, waiting: 'close the test window to end the test' }); setInterval(() => {}, 1 << 30);
