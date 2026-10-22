'use strict';
// world1 RANGED_COMBAT: one call before the existing attack roll (rollCombatAttack). Keeps dungeonReach's range,
// clear-sight and -4-when-threatened rules; adds falloff, cover, item-held ammo and rare resource-cost items.
const Flags = require('./worldFlags');
const R = require('../assets/rangedRules');
const Spells = require('./spellSystem');
const key = v => String(v?.name || v || '').trim().toLowerCase();
const weaponName = a => key(a?.equipped?.Weapon || a?.equipped?.weapon || a?.Equipped?.Weapon);
function store(sharedState) { const db = JSON.parse(sharedState.getRoomNameDatabase() || '{}'); db['0,0,0'] ||= {}; db['0,0,0'].rangedAmmo ||= {};
  return { s: db['0,0,0'].rangedAmmo, save: () => { const cur = JSON.parse(sharedState.getRoomNameDatabase() || '{}'); (cur['0,0,0'] ||= {}).rangedAmmo = db['0,0,0'].rangedAmmo; sharedState.setRoomNameDatabase(JSON.stringify(cur)); } }; }
function settingNow() { try { return require('./settingLayer').current() || null; } catch { return null; } }
function genreNow(setting = settingNow()) { return setting?.genres?.[0] ? (require('../assets/genreKits').genreOf(setting.genres[0]) || setting.genres[0]) : 'cotg'; }
// The actor's own stat line (stored as Magic: on the sheet; only the displayed name differs by genre).
function resource(sharedState, actor, label) {
  const sheet = () => Spells.allActors(sharedState.getUpdatedGameConsole() || '').find(a => a.name === actor.name);
  const get = () => Number(/^[ \t]*Magic:\s*(-?\d+)/m.exec(sheet()?.rawSheet || '')?.[1] || 0);
  return { label, get, spend: n => { const v = Math.max(0, get() - n); sharedState.setUpdatedGameConsole(Spells.changeActor(sharedState.getUpdatedGameConsole(), actor.name, raw => Spells.stat(raw, 'Magic', v))); } };
}
// Found or bought ammo bundles sit in the Inventory line as e.g. "bullets (12)"; one is consumed into the weapon's reserve when it runs dry.
function takeBundle(sharedState, ammo) {
  const A = R.AMMO[ammo]; if (!A) return 0; const text = sharedState.getUpdatedGameConsole() || '', m = /^Inventory:[ \t]*(.*)$/m.exec(text); if (!m) return 0;
  const items = m[1].split(/,\s*/).filter(Boolean), re = new RegExp(`^${A.label.toLowerCase().replace(/[^a-z ]/g, '.')}\\s*\\((\\d+)\\)$|^${ammo}\\s*\\((\\d+)\\)$`, 'i'), i = items.findIndex(x => re.test(x.trim()));
  if (i < 0) return 0; const n = Number(re.exec(items[i].trim()).slice(1).find(Boolean)); items.splice(i, 1);
  sharedState.setUpdatedGameConsole(text.replace(/^Inventory:[ \t]*.*$/m, `Inventory: ${items.join(', ') || 'None'}`)); return n;
}
function preAttack({ combatant, target, combatSpace, sharedState, broadcast = () => {}, rand = Math.random }) {
  if (!Flags.on('RANGED_COMBAT')) return null;
  const w = R.find(weaponName(combatant)); if (!w || !(w.range_tiles > 2)) return null;
  const set = settingNow(), label = R.resourceLabel(genreNow(set), set), st = store(sharedState), log = [];
  const from = combatSpace?.point?.(combatant), to = combatSpace?.point?.(target), dist = from && to ? Math.hypot(from.x - to.x, from.y - to.y) : 1;
  const fall = R.falloff(w, dist); if (fall === null) return { abort: true, log: [`${target.name} is beyond the ${w.name}'s range.`] };
  if (w.ammo) { const cur = R.state(st.s, combatant, w); if (cur.reserve <= 0 && (!w.magazine || cur.loaded <= 0)) { const n = takeBundle(sharedState, w.ammo); if (n) { cur.reserve += n; log.push(`${combatant.name} breaks open a bundle of ${n} ${R.AMMO[w.ammo].label.toLowerCase()}.`); } } }
  const shot = R.fire(st.s, combatant, w, w.costType === 'resource' ? resource(sharedState, combatant, label) : null, rand); st.save();
  if (shot.message) log.push(shot.message);
  if (!shot.ok) return { abort: true, log, empty: !!shot.empty, reload: !!shot.reload };
  const cov = w.ignoresCover ? 0 : R.cover(combatSpace?.dungeon, from, to);
  if (cov) log.push(`${target.name} has ${cov >= 4 ? 'three-quarter' : 'half'} cover (+${cov} AC).`);
  if (fall) log.push(`Long shot at ${dist.toFixed(1)} tiles (${fall} Attack).`);
  try { broadcast({ type: 'ranged_fx', fx: w.fx, sid: w.sid, weapon: w.name, from, to, actor: combatant.name, target: target.name, readout: R.readout(st.s, combatant, w) }); } catch {}
  return { modifier: fall, acBonus: cov, log, readout: R.readout(st.s, combatant, w) };
}
// AI ranged users (party members and monsters not under player control) keep distance: step one tile away from an adjacent enemy.
function kite({ combatant, target, combatSpace }) {
  if (!Flags.on('RANGED_COMBAT') || combatant.tacticalControlled || !combatSpace?.point || !combatSpace.canMoveTo) return null;
  const w = R.find(weaponName(combatant)), p = combatSpace.point(combatant), q = combatSpace.point(target); if (!w || !p || !q || !R.keepDistance(w, Math.hypot(p.x - q.x, p.y - q.y))) return null;
  const from = { x: Math.floor(p.x), y: Math.floor(p.y) }, opts = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => ({ x: from.x + dx, y: from.y + dy }))
    .filter(c => Math.hypot(c.x + .5 - q.x, c.y + .5 - q.y) > Math.hypot(p.x - q.x, p.y - q.y)).sort((a, b) => Math.hypot(b.x - q.x, b.y - q.y) - Math.hypot(a.x - q.x, a.y - q.y));
  for (const c of opts) if (combatSpace.canMoveTo(combatant, from, c)) { combatSpace.move(combatant, c); return c; }
  return null;
}
function endCombat(sharedState, rand = Math.random) { if (!Flags.on('RANGED_COMBAT')) return []; const st = store(sharedState); const out = R.recover(st.s, rand); st.save(); return out; }
function endRound(sharedState) { if (!Flags.on('RANGED_COMBAT')) return; const st = store(sharedState); R.cool(st.s); st.save(); }
function refill(sharedState, actor, weapon, count) { const w = R.find(weapon); if (!w?.ammo) return null; const st = store(sharedState); const s = R.refill(st.s, actor, w, count); st.save(); return s; }
function readouts(sharedState, actors) { const st = store(sharedState); return actors.map(a => ({ name: a.name, text: R.readout(st.s, a, R.find(weaponName(a))) })).filter(r => r.text); }
module.exports = { takeBundle, kite, preAttack, endCombat, endRound, refill, readouts, weaponName, resource, genreNow };
