// Holodek playtest driver (no installs): Chrome DevTools Protocol over Node's built-in WebSocket.
// Drives the real page exactly like a player: types into #chatuserinput and presses the Command button (normal
// /processInput7 pass with the full client payload), walks to exits, clicks a book. Records per turn: console input,
// full request bodies, resulting state, browser console. Model requests/responses are recorded server-side by capture.cjs.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
const GAME_PORT = Number(process.env.PLAYTEST_PORT) || 3001, ORIGIN = `http://localhost:${GAME_PORT}`, BASE = `${ORIGIN}/assets/index.html`;
const OUT = path.resolve(process.env.PLAYTEST_OUT || 'playtest-run'); fs.mkdirSync(path.join(OUT, 'requests'), { recursive: true });
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:\Program Files\Google\Chrome\Application\chrome.exe' : '/usr/bin/google-chrome');
const redact = s => String(s).replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-<redacted>'); // the key never reaches this process; key-shaped text is redacted anyway
const log = (f, row) => fs.appendFileSync(path.join(OUT, f), redact(typeof row === 'string' ? row : JSON.stringify(row)) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let turn = 0;
// HEADED=1: visible, maximized incognito window with its own profile dir (the normal Chrome profile is never used).
const HEADED = process.env.PLAYTEST_HEADLESS !== '1';
const PORT = Number(process.env.CDP_PORT) || 9400 + Math.floor(Math.random() * 500); // unique per run
const SPEEDS = { full: { char: 0, after: 0 }, fast: { char: 12, after: 600 }, normal: { char: 40, after: 1500 }, slow: { char: 90, after: 2500 } };
const SPEED = SPEEDS[process.env.PLAYTEST_SPEED || 'full'] || SPEEDS.full, PACE = HEADED ? SPEED.after : 0, CHAR_MS = HEADED ? SPEED.char : 0;
const chromeArgs = HEADED ? ['--incognito', '--start-maximized', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'chrome-playtest-profile')}`, '--no-first-run', '--no-default-browser-check', BASE]
  : ['--headless=new', '--incognito', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'chrome-playtest-profile')}`, '--window-size=1280,860', '--no-first-run', BASE];
if (process.platform !== 'win32') chromeArgs.unshift('--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore' });
const pause = () => sleep(PACE);
// Attach ONLY to the Chrome we launched: the debugging port must be owned by our PID, and only to its localhost:3001 page.
const owner = () => { try {
  if (process.platform === 'win32') return Number(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`], { encoding: 'utf8' }).trim()) || null;
  const m = /pid=(\d+)/.exec(execFileSync('ss', ['-ltnpH', `sport = :${PORT}`], { encoding: 'utf8' })); return m ? Number(m[1]) : null; } catch { return null; } };
let pageWs, verified = false;
for (let i = 0; i < 120 && !pageWs; i++) { await sleep(500);
  if (!verified) { const o = owner(); if (o == null) continue; if (o !== chrome.pid) { log('turns.log', { abort: `debug port ${PORT} owned by pid ${o}, not launched chrome ${chrome.pid}` }); chrome.kill(); process.exit(2); } verified = true; }
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); pageWs = list.find(t => t.type === 'page' && (t.url.startsWith(ORIGIN) ))?.webSocketDebuggerUrl; } catch {} }
if (!pageWs) { log('turns.log', { abort: 'no game page target in the launched chrome' }); chrome.kill(); process.exit(2); }
log('turns.log', { attached: { pid: chrome.pid, port: PORT, verifiedOwner: verified } });
const ws = new WebSocket(pageWs); await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pending = new Map(), handlers = {};
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } else if (m.method) (handlers[m.method] || []).forEach(h => h(m.params)); });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const on = (m, h) => (handlers[m] ||= []).push(h);
const evaluate = async (fn, ...args) => { const r = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true, timeout: 600000 });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); };
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable', { maxPostDataSize: 20 * 1024 * 1024 });
if (!HEADED) await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
on('Runtime.consoleAPICalled', p => log('browser-console.log', `[turn ${turn}] ${p.type}: ${p.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 2000)}`));
on('Runtime.exceptionThrown', p => log('browser-console.log', `[turn ${turn}] PAGEERROR ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`));
on('Network.requestWillBeSent', async p => { const r = p.request; if (r.method !== 'POST' || !r.url.startsWith(ORIGIN + '/')) return;
  let body = r.postData || ''; if (!body && r.hasPostData) try { body = (await send('Network.getRequestPostData', { requestId: p.requestId })).postData; } catch {}
  const n = `${String(turn).padStart(2, '0')}-${Date.now()}-${r.url.replace(ORIGIN + '/', '').replace(/\W+/g, '_')}.json`;
  fs.writeFileSync(path.join(OUT, 'requests', n), redact(body)); log('requests.log', { turn, url: r.url.replace(ORIGIN + '/', ''), bytes: body.length, file: n }); });
await send('Page.reload', { ignoreCache: true });
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
const scenarioFile = path.resolve(process.env.PLAYTEST_SCENARIO || new URL('./scenarios/full-pass.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
log('turns.log', { scenario: scenario.name || scenarioFile, steps: scenario.steps.length });
let START_CLICKS = [];
const startFlow = async (option, clicks = []) => { START_CLICKS = clicks;
  turn = 0; log('turns.log', { turn, action: 'new game through the in-page start flow: Start -> menu option ' + option });
  await command('Start', 20000); await command(String(option), 20000);
  for (let i = 0; i < 40; i++) {
    if (await evaluate(() => !!(typeof currentDungeon !== 'undefined' && currentDungeon?.geoKey))) break;
    const clicked = await evaluate(extra => { const vis = e => e.offsetParent !== null && !e.disabled;
      const all = [...document.querySelectorAll('button, input[type=button], input[type=submit]')].filter(vis);
      // Setup screens first: the character review's 'Save and Continue' (#review-save-button), then any scenario-named buttons.
      const b = all.find(x => x.id === 'review-save-button' || /save\s*(and|&)\s*continue/i.test(x.textContent || x.value))
        || all.find(x => (extra || []).some(t => x.id === t || (x.textContent || x.value || '').trim().toLowerCase() === String(t).toLowerCase()))
        || all.find(x => /\b(start|begin|play|accept|confirm|continue|proceed|enter|ready|use this|keep)\b/i.test(x.textContent || x.value) && !/quit|cancel|reroll|regenerate|back/i.test(x.textContent || x.value));
      if (b) { b.click(); return ((b.id ? '#' + b.id + ' ' : '') + (b.textContent || b.value).trim()).slice(0, 80); } return null; }, START_CLICKS);
    if ((clickCount = (clickCount || 0) + 1) > 8) throw Error('start flow stuck: the same setup button was clicked 8 times without the room loading; see server.log'); log('turns.log', { turn, startFlowClick: clicked });
    await (clicked ? idle(600000) : sleep(3000)); await pause();
  }
  await idle(1500000); };
let last = null;
try {
  for (const step of scenario.steps) {
    if (step.start !== undefined) { await startFlow(step.start, step.click || []); last = await state('after start flow'); }
    else if (step.command) last = await command(step.command);
    else if (step.walk) last = await walkTo(step.walk);
    else if (step.walkNext) { const s = await state('before walkNext'); const d = (s.exits || []).map(e => e.direction).find(x => !(step.walkNext.avoid || []).includes(x)) || 'north'; last = await walkTo(d); }
    else if (step.book) { const b = await bookPass(); if (!b) log('turns.log', { turn, book: 'no shelf or inventory book in the rooms reached' }); }
    else if (step.dev) { const r = await evaluate(op => { try { for (const k of ['x', 'y']) if (typeof op[k] === 'string') { const m = /^@p([xy])([+-]\d+(?:\.\d+)?)?$/.exec(op[k]); if (m) op[k] = (m[1] === 'x' ? playerPosX : playerPosY) + Number(m[2] || 0); } return window.__holodekDev ? window.__holodekDev.apply(op) : { error: 'dev sandbox not enabled (HOLODEK_DEV_SANDBOX=1)' }; } catch (e) { return { error: e.message }; } }, step.dev);
      log('turns.log', { turn, dev: step.dev, result: r }); await sleep(step.settle ?? 1200); }
    else if (step.live) fs.writeFileSync(path.join(OUT, 'live-budget.json'), JSON.stringify({ calls: step.live.calls ?? 1, components: step.live.components || [] }));
    else if (step.waitForClose) {
      log('turns.log', { turn, manualSession: 'waiting until the test browser is closed; no time limit' });
      if (chrome.exitCode === null) await new Promise(resolve => chrome.once('exit', resolve));
      break;
    }
    else if (step.wait) await sleep(step.wait);
    else if (step.screenshot) await shot(step.screenshot);
    else if (step.state) last = await state(step.state);
    else log('turns.log', { turn, unknownStep: step });
  }
} catch (e) { log('turns.log', { turn, harnessError: e.message }); }
try { const st = JSON.parse(fs.readFileSync(path.join(OUT, 'model-stats.json'), 'utf8')); log('turns.log', { turn, modelCalls: { total: st.total, live: st.live, local: st.total - st.live, localPercent: st.localPercent, liveTokens: st.liveTokens, localTokens: st.localTokens } }); } catch {}
log('turns.log', { turn, done: true, at: new Date().toISOString() });
if (!HEADED || process.env.PLAYTEST_CLOSE === '1') { try { await send('Browser.close'); } catch {} chrome.kill(); }
// headed: the window stays open for the developer
process.exit(0);
