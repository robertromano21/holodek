// unit test of demo-player decisions with a fake page
import { createDemoPlayer } from './demo-player.mjs';
const typed = [], clicked = []; let screen;
const base = { busy: false, paused: false, dice: 0, target: false, review: null, popups: [], options: [], lastLines: ['The Marshal squints.'], question: '', room: 'Juniper Flats Main Street', description: 'Dust, a church bell, a hitching post and a water trough.', exits: 'north, east', npcs: 'Bygul, Marshal Teague', inputReady: true };
const d = createDemoPlayer({ evaluate: async () => screen, typeText: async t => typed.push(t), click: async t => clicked.push(t), sleep: async () => {}, env: {}, mode: 'mock' });
const assert = (c, m) => { if (!c) { console.log('not ok -', m); process.exitCode = 1; } else console.log('ok -', m); };
screen = { ...base, options: [{ n: 1, label: 'Gunslinger' }, { n: 2, label: 'Bell-warden' }, { n: 3, label: 'Prospector' }, { n: 4, label: 'a' }, { n: 5, label: 'b' }, { n: 6, label: 'c' }] };
for (let i = 0; i < 20; i++) await d.turn(); assert(typed.every(t => +t >= 1 && +t <= 6), 'menu: only on-screen numbers 1-6 (never 8)');
let calls = 0; screen = { ...base, review: { saveEnabled: false, note: 'Holodek is still drawing Wren', pending: ['Wren'] } };
const d2 = createDemoPlayer({ evaluate: async () => { calls++; if (calls > 3) screen = { ...base, review: { saveEnabled: true, pending: [] } }; return screen; }, typeText: async () => {}, click: async t => clicked.push(t), sleep: async () => {}, env: {} });
const r = await d2.turn(); assert(r.kind === 'save' && calls > 3, 'review: waits until all sprites drawn, then Save & Continue');
screen = { ...base, dice: 1 }; clicked.length = 0; await d.turn(); assert(clicked[0] === 'button.party-d20.awaiting-roll', 'dice: rolls when prompted');
screen = { ...base }; typed.length = 0; for (let i = 0; i < 4; i++) await d.turn(); assert(typed.length === 4 && new Set(typed).size === 4 && typed.every(t => /\w/.test(t) && !/^\d+$/.test(t)), 'improvises varied in-character commands: ' + JSON.stringify(typed));
let sent = null; const d3 = createDemoPlayer({ evaluate: async () => ({ ...base, question: 'Who sent you?' }), typeText: async t => typed.push(t), click: async () => {}, sleep: async () => {}, mode: 'live', env: { OPENAI_API_KEY: 'sk-test-not-real-0000000000' },
  fetchImpl: async (u, o) => { sent = JSON.parse(o.body); return { json: async () => ({ choices: [{ message: { content: 'Tell the Marshal the widow Hask sent me' } }] }) }; }, log: (f, row) => { if (JSON.stringify(row).includes('sk-test')) process.exitCode = 1; } });
const r3 = await d3.turn(); assert(r3.source === 'model' && sent.messages[1].content.includes('Who sent you?'), 'live: model improvises from room/NPCs/GM question');
