'use strict';
// world1 myth variety: force a seeded choice of Danae deities into each room's murals.
// Mortacia dominates at and beside the Ruined Temple; the farther from 0,0,0, the more the pool opens up
// and the more least-used deities are preferred. Counts live per game in the room database.
const Flags = require('./worldFlags');
const Icons = require('../assets/shrineIconography');
const Memory = require('./crossGameMemory');
const SCENES = ['ancestral_court','burial_rites','dragon_war','scholars','star_map','forge','river_crossing','garden_of_souls','gatekeepers','pilgrimage',
  'oath_ceremony','healers','harvest','storm_voyage','dragon_flight','lament_of_cities','council_of_dragons','weaving_fates','descent_to_tartarus',
  'sculptors_workshop','celestial_orbit','banquet_of_shades','covenant_of_races','vigil_of_angels'];
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function distance(geoKey) { const c = String(geoKey).split(',').map(Number); return Math.max(Math.abs(c[0] || 0), Math.abs(c[1] || 0)) + Math.abs(c[2] || 0); }
function pick(seed, geoKey, counts = {}) {
  const names = Object.keys(Icons.pantheon), d = distance(geoKey), chosen = [];
  const want = d === 0 ? 2 : d < 4 ? 2 : 3;
  const weight = n => n === 'Mortacia' ? Math.max(0.3, 8 / (1 + d)) / (1 + (counts[n] || 0) * 0.3) : (1 + Math.min(d, 12) / 4) / (1 + (counts[n] || 0));
  for (let i = 0; chosen.length < want && i < 50; i++) {
    const pool = names.filter(n => !chosen.includes(n)), total = pool.reduce((s, n) => s + weight(n), 0);
    let r = (hash(`${seed}:${geoKey}:myth:${i}`) % 100000) / 100000 * total;
    for (const n of pool) { r -= weight(n); if (r <= 0) { chosen.push(n); break; } }
  }
  if (d === 0 && !chosen.includes('Mortacia')) chosen[0] = 'Mortacia';
  return { deities: chosen, scene: SCENES[hash(`${seed}:${geoKey}:scene`) % SCENES.length] };
}
function promptBlock(seed, geoKey, counts, runId) {
  if (require('./settingLayer').current()) return '';
  if (!Flags.on('MURAL_STORIES')) return '';
  const p = pick(seed, geoKey, counts), avoid = Memory.avoid(runId, 'murals', 6).map(t => String(t).slice(0, 40));
  return `\nMURALS (new this game): each fresco/mosaic needs title<=70, backstory (unique 2-4 sentence myth) and 2-6 figures with name, role, story. Depict ${p.deities.join(', ')} (dragons except Mortacia); scene:"${p.scene}". Avoid: ${avoid.join(' | ') || 'none'}.`;
}
// Enforce the forced deities and fill missing story fields; never throws.
function enforce(roomArt, seed, geoKey, counts = {}) {
  if (require('./settingLayer').current()) return roomArt;
  if (!Flags.on('MURAL_STORIES') || !Array.isArray(roomArt)) return roomArt;
  const p = pick(seed, geoKey, counts);
  for (const art of roomArt) {
    if (!['fresco', 'mosaic'].includes(art?.kind)) continue;
    art.figures = Array.isArray(art.figures) ? art.figures.slice(0, 6) : [];
    const present = new Set(art.figures.map(f => Icons.name(f.subject)).filter(Boolean));
    p.deities.filter(n => !present.has(n)).forEach((n, i) => {
      if (art.figures.length < 6) art.figures.push({ subject: n, pose: 'standing' });
      else art.figures[i].subject = n;
    });
    art.title ||= art.label;
    art.backstory ||= art.description;
    for (const f of art.figures) {
      const deity = Icons.name(f.subject);
      f.name ||= deity || String(f.subject || 'Figure').replace(/^\w/, c => c.toUpperCase());
      f.role ||= deity ? String(Icons.pantheon[deity].domain).split(';')[0].slice(0, 60) : 'witness';
      f.story ||= `${f.name} ${deity ? 'presides over' : 'takes part in'} ${art.title}.`;
    }
    art.world1 = Flags.VERSION;
    for (const n of p.deities) counts[n] = (counts[n] || 0) + 1;
  }
  return roomArt;
}
module.exports = { pick, promptBlock, enforce, distance, SCENES };
