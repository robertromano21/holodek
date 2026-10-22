// world1 DEMO PLAYER: makes visible runs play like an arcade attract-mode demo instead of replaying a script.
// Each turn it READS the screen, WAITS for loads and sprites, ROLLS dice when asked, picks only VALID menu numbers
// parsed from the screen, PACES itself like a person, and IMPROVISES an in-character command from the room, the
// people present and the GM's last question. Live mode asks the model for that line; mock/headless mode uses a
// local improviser (no network). The API key is read from the environment only and is never logged or echoed.
//
// Used by drive-cdp.mjs:  import { createDemoPlayer } from './demo-player.mjs';
//   const demo = createDemoPlayer({ evaluate, typeText, click, shot, log, sleep, mode: process.env.HOLODEK_MODE, speed: () => SPEED, persona });
//   await demo.turn();   // one human-paced turn; returns { kind, text?, choice?, reason }
const SAFE = s => String(s || '').replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-<redacted>');
const rnd = (a, b) => a + Math.random() * (b - a);
const pickOne = a => a[Math.floor(Math.random() * a.length)];

// Runs in the page: everything a player can see right now.
export function readScreenInPage() {
  const vis = el => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const txt = el => (el?.innerText || el?.textContent || '').trim();
  const review = document.getElementById('character-sprite-review'), save = document.getElementById('review-save-button');
  const chat = document.getElementById('chatlog'), tail = txt(chat).slice(-2500);
  const lines = tail.split(/\n+/).map(s => s.trim()).filter(Boolean), last = lines.slice(-14);
  // Numbered menu: the LAST run of "N. ..." / "N) ..." lines; only those numbers are valid.
  const options = []; for (let i = last.length - 1; i >= 0; i--) { const m = /^(\d{1,2})[.):]\s+(.+)$/.exec(last[i]); if (m) options.unshift({ n: Number(m[1]), label: m[2].slice(0, 80) }); else if (options.length) break; }
  const consoleText = String(window.gameConsoleText || window.updatedGameConsole || document.getElementById('game-console')?.innerText || '');
  const field = k => (new RegExp('^' + k + ':\\s*(.*)$', 'mi').exec(consoleText) || [])[1] || '';
  const popups = [...document.querySelectorAll('#game-popup, .popup, [role="dialog"]')].filter(vis).map(p => ({ id: p.id || '', text: txt(p).slice(0, 300), buttons: [...p.querySelectorAll('button')].filter(b => vis(b) && !b.disabled).map(b => txt(b)).slice(0, 6) }));
  const dice = [...document.querySelectorAll('button.party-d20.awaiting-roll')].filter(b => vis(b) && !b.disabled).length;
  const target = [...document.querySelectorAll('button.popup-button')].find(b => vis(b) && !b.disabled && /Attack target/i.test(txt(b)));
  const placeholders = (() => { const r = window._pendingPartyReview?.roster || [window._pendingStartingCharacter].filter(Boolean); return r.filter(m => m?.sprite?.placeholder).map(m => m.Name || m.name); })();
  const modelSelect = (() => { const d = document.getElementById('model-select-screen'); const b = document.getElementById('model-select-continue'); return d?.open ? { ready: !!b && !b.disabled, choice: d.querySelector('input:checked')?.value || '' } : null; })();
  const busy = !!(window._characterStartupPending || window.GameCommandGate?.busy?.() || window._combatCommandPending);
  const input = document.getElementById('chatuserinput') || document.querySelector('textarea, input[type=text]');
  return { at: Date.now(), modelSelect, busy, paused: !!window.gamePaused, dice, target: !!target,
    review: vis(review) ? { name: txt(document.getElementById('review-character-name')), saveEnabled: !!save && !save.disabled && vis(save), note: txt(document.getElementById('review-save-note')), pending: placeholders } : null,
    popups, options, lastLines: last.slice(-8), question: [...last].reverse().find(l => /\?\s*$/.test(l)) || '',
    room: field('Room Name'), description: field('Room Description').slice(0, 400), exits: field('Exits'), npcs: (field('NPCs In Party') + ' ' + field('Monsters in Room')).trim().slice(0, 200),
    inputReady: !!input && !input.disabled && vis(input) };
}

export function createDemoPlayer({ evaluate, typeText, click, shot, log = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)), mode = 'mock', speed = () => ({ char: 40, after: 1500 }), persona = {}, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const live = /live|api/i.test(String(mode || ''));
  const history = [];
  const read = () => evaluate(readScreenInPage);
  const humanRead = async s => { const words = (s.lastLines || []).join(' ').split(/\s+/).length; await sleep(Math.min(9000, 900 + words * rnd(120, 220) * (speed().after / 1500))); };
  async function waitForLoads(maxMs = 15 * 60 * 1000) { // wait out room builds, model calls and sprite drawing
    const until = Date.now() + maxMs; let s = await read();
    while (Date.now() < until && (s.busy || s.paused || (s.review && !s.review.saveEnabled))) { await sleep(1500); s = await read(); }
    return s;
  }
  // Improvise one in-character line. Live: the model writes it. Mock: local improviser (deterministic-ish, offline).
  async function improvise(s) {
    const who = persona.name || 'the hero', role = persona.role || 'adventurer';
    if (live && env.OPENAI_API_KEY && fetchImpl) {
      try {
        const body = { model: env.HOLODEK_DEMO_MODEL || env.HOLODEK_MODEL || 'gpt-4.1-mini', temperature: .9, max_tokens: 40, messages: [
          { role: 'system', content: `You are playing a text adventure as ${who}, a ${role}. Reply with ONE short in-character command the game parser can act on (imperative, under 14 words, no quotes, no meta talk). Vary between talking to people, examining things, moving through exits, using items. Never repeat a recent command.` },
          { role: 'user', content: JSON.stringify({ room: s.room, description: s.description, exits: s.exits, people: s.npcs, gmSaid: s.lastLines.slice(-4), question: s.question, recent: history.slice(-6) }) }] };
        const r = await fetchImpl('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
        const j = await r.json(); const line = String(j?.choices?.[0]?.message?.content || '').split('\n')[0].replace(/^["'\-\s]+|["'\s]+$/g, '').slice(0, 120);
        if (line && !history.includes(line)) return { text: line, source: 'model' };
      } catch (e) { log('demo.log', { improviseError: SAFE(e.message) }); }
    }
    const people = String(s.npcs || '').split(/[,;\n]/).map(x => x.replace(/^(NPCs In Party|Monsters in Room):?/i, '').trim()).filter(x => x && !/^none$/i.test(x));
    const exits = String(s.exits || '').split(/[,\s]+/).filter(x => /^(north|south|east|west|up|down|northeast|northwest|southeast|southwest)$/i.test(x));
    const nouns = (String(s.description).match(/\b(bell|door|window|table|altar|shelf|book|lamp|lantern|tracks|sign|well|crate|barrel|mural|statue|chest|map|stairs|shaft|rail|cart|bench|pew|bar|counter|grave)\b/gi) || []);
    const q = s.question;
    const ideas = [
      q && people[0] ? `answer ${people[0]}: I came looking for the truth, nothing more` : null,
      people.length ? `ask ${pickOne(people)} what they saw last night` : null,
      people.length ? `quietly ask ${pickOne(people)} who they are afraid of` : null,
      nouns.length ? `examine the ${pickOne(nouns).toLowerCase()}` : 'look around carefully',
      nouns.length ? `search near the ${pickOne(nouns).toLowerCase()} for anything hidden` : 'search the room',
      exits.length && history.length > 2 ? `go ${pickOne(exits).toLowerCase()}` : null,
      'check my gear and count my ammo', 'listen for anything out of place'
    ].filter(Boolean).filter(x => !history.includes(x));
    return { text: ideas.length ? pickOne(ideas) : 'look around', source: 'local' };
  }
  async function chooseOption(s) { // only numbers that are actually on screen
    const valid = s.options.map(o => o.n); if (!valid.length) return null;
    let n = null;
    if (live && env.OPENAI_API_KEY && fetchImpl) {
      try { const r = await fetchImpl('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ model: env.HOLODEK_DEMO_MODEL || env.HOLODEK_MODEL || 'gpt-4.1-mini', max_tokens: 4, messages: [{ role: 'system', content: `Pick the option number that ${persona.name || 'the hero'} would choose. Reply with the number only.` }, { role: 'user', content: JSON.stringify(s.options) }] }) });
        const j = await r.json(); n = Number(String(j?.choices?.[0]?.message?.content || '').match(/\d+/)?.[0]); } catch (e) { log('demo.log', { chooseError: SAFE(e.message) }); }
    }
    if (!valid.includes(n)) n = persona.prefer && valid.includes(persona.prefer) ? persona.prefer : pickOne(valid);
    return n;
  }
  async function turn() {
    let s = await waitForLoads();
    if (s.modelSelect) { // start screen: keep the preselected default, read it like a person, then continue
      if (!s.modelSelect.ready) { await sleep(1000); return { kind: 'wait', reason: 'model list loading' }; }
      await sleep(rnd(1500, 3000)); await click('#model-select-continue'); log('demo.log', { kind: 'model-select', choice: s.modelSelect.choice }); return { kind: 'model-select', choice: s.modelSelect.choice, reason: 'kept the default model' };
    }
    if (s.dice) { await sleep(rnd(700, 1600)); await click('button.party-d20.awaiting-roll'); log('demo.log', { kind: 'dice' }); await sleep(2200); return { kind: 'dice', reason: 'a roll was requested' }; }
    if (s.target) { await sleep(rnd(800, 1800)); await click('Attack target'); return { kind: 'target', reason: 'combat target prompt' }; }
    if (s.review) { // never click through while Holodek is still drawing
      if (!s.review.saveEnabled) return { kind: 'wait', reason: s.review.note || 'sprites still drawing' };
      await sleep(rnd(1500, 3000)); await click('#review-save-button'); return { kind: 'save', reason: 'all party sprites loaded' };
    }
    const popup = s.popups.find(p => p.buttons.length);
    if (popup) { await humanRead({ lastLines: [popup.text] }); const b = popup.buttons.find(x => /continue|ok|close|yes|start|accept/i.test(x)) || popup.buttons[0]; await click(b); return { kind: 'popup', text: b, reason: popup.id || 'popup' }; }
    await humanRead(s);
    if (s.options.length) { const n = await chooseOption(s); await typeText(String(n)); history.push(String(n)); log('demo.log', { kind: 'menu', valid: s.options.map(o => o.n), choice: n }); return { kind: 'menu', choice: n, reason: `valid: ${s.options.map(o => o.n).join(',')}` }; }
    if (!s.inputReady) { await sleep(1500); return { kind: 'wait', reason: 'input not ready' }; }
    const idea = await improvise(s); history.push(idea.text); log('demo.log', { kind: 'improvise', source: idea.source, room: s.room, text: idea.text });
    await typeText(idea.text); return { kind: 'command', text: idea.text, source: idea.source, reason: s.question ? 'answering the GM' : 'exploring' };
  }
  return { read, waitForLoads, improvise, chooseOption, turn, history };
}
