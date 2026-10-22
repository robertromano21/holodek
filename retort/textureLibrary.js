'use strict';
// Campaign Builder prefab texture library. A browsable index over EXISTING generators; nothing here draws its own art.
//   wall/floor/roof/underground -> assets/renderSceneTextures.js drawSceneSurface / drawRoofSurface (the room builder's own calls)
//   ornament fields, moldings   -> assets/designCatalog.js paintBand (the same painter surfaceArt uses)
//   themes, palettes, lighting, compositions, illustration kinds, pyramids -> designCatalog entries (shown as swatches)
// "Generate new texture" = ONE contract call (generationContracts.request, so mock/agent/live + cache apply) that returns a
// PARAMETER SPEC for drawSceneSurface; specs are stored as user content and rendered by the same generator.
const fs = require('fs'), path = require('path');
const { createCanvas } = require('canvas');
const T = require('../assets/renderSceneTextures.js');
const C = require('../assets/designCatalog');
const MATERIALS = ['stone', 'brick', 'marble', 'bone', 'obsidian', 'wood', 'metal', 'ice', 'lava', 'ash', 'sand', 'sandstone', 'earth', 'roots', 'crystal', 'flesh'];
const FLOOR_PATTERNS = ['hex_tiles', 'rough_plates', 'organic', 'planks'];
const userFile = () => path.join(process.cwd(), 'builder-worlds', 'textures.json');
const readUser = () => { try { return JSON.parse(fs.readFileSync(userFile(), 'utf8')); } catch { return []; } };
function prefabs() {
  const out = [];
  for (const m of MATERIALS) { if (T.hasMaterial('floor', m)) out.push({ id: `floor:${m}`, group: 'floor', apply: ['floor'], spec: { kind: 'floor', material: m } });
    if (T.hasMaterial('wall', m)) out.push({ id: `wall:${m}`, group: 'wall', apply: ['wall', 'prop'], spec: { kind: 'wall', material: m } });
    out.push({ id: `ceiling:${m}`, group: 'ceiling', apply: ['ceiling'], spec: { kind: 'roof', material: m } }); }
  for (const p of FLOOR_PATTERNS) out.push({ id: `floor:stone:${p}`, group: 'floor', apply: ['floor'], spec: { kind: 'floor', material: 'stone', style: { pattern: p } } });
  const A=require('../assets/genreArchitecture');
  for(const [kind,materials]of [['wall',A.WALL],['floor',A.FLOOR]])for(const material of Object.keys(materials)){
    if(!out.some(e=>e.id===`${kind}:${material}`))out.push({id:`${kind}:${material}`,group:kind,apply:kind==='wall'?['wall','prop']:['floor'],spec:{kind,material}});
  }
  for (const u of T.UNDERGROUND_PROFILES) for (const k of ['floor', 'wall']) out.push({ id: `${k}:${u}`, group: 'underground', apply: [k], spec: { kind: k, material: 'stone', undergroundProfile: u } });
  for (const o of C.ORNAMENTS) out.push({ id: `ornament:${o}`, group: 'ornament', apply: ['wall', 'prop'], tradition: C.TRADITION[o], spec: { kind: 'ornament', carvingStyle: o } });
  for (const m of Object.keys(C.MOLDINGS)) out.push({ id: `molding:${m}`, group: 'molding', apply: ['wall'], spec: { kind: 'molding', role: m } });
  for (const [k, v] of Object.entries(C.THEMES)) out.push({ id: `theme:${k}`, group: 'theme', apply: ['room'], spec: { kind: 'theme', theme: k }, detail: v });
  for (const k of Object.keys(C.PALETTES)) out.push({ id: `palette:${k}`, group: 'palette', apply: ['room', 'prop'], spec: { kind: 'palette', palette: k } });
  for (const k of C.LIGHTING) out.push({ id: `lighting:${k.id || k}`, group: 'lighting', apply: ['room'], spec: { kind: 'lighting', lighting: k.id || k } });
  for (const k of C.COMPOSITIONS) out.push({ id: `composition:${k.id || k}`, group: 'art', apply: ['picture'], spec: { kind: 'composition', composition: k.id || k } });
  for (const k of C.ILLUSTRATION_KINDS) out.push({ id: `art:${k.id || k}`, group: 'art', apply: ['picture'], spec: { kind: 'illustration', component: k.id || k } });
  for (const k of C.PYRAMIDS) out.push({ id: `pyramid:${k.id || k}`, group: 'structure', apply: ['prop'], spec: { kind: 'pyramid', shape: k.id || k } });
  return out;
}
const list = query => { const q = String(query || '').toLowerCase().trim(), all = [...prefabs(), ...readUser().map(u => ({ ...u, group: 'user' }))];
  return q ? all.filter(e => (e.id + ' ' + (e.label || '') + ' ' + (e.tradition || '') + ' ' + e.group).toLowerCase().includes(q)) : all; };
function counts() { return prefabs().reduce((a, e) => (a[e.group] = (a[e.group] || 0) + 1, a), {}); }
const palColors = name => { const p = C.PALETTES[name] || C.PALETTES.marble_dawn; return { primary: p[0], secondary: p[1], accent: p[5] || p[2], shadow: p[3], highlight: p[4] }; };
// Thumbnail: delegate to the generator that owns the entry.
function thumbnail(spec, size = 64) {
  const c = createCanvas(size, size), ctx = c.getContext('2d'), pal = spec.palette && typeof spec.palette === 'object' ? spec.palette : palColors(spec.paletteName || 'marble_dawn');
  if (spec.kind === 'floor' || spec.kind === 'wall') T.drawSceneSurface(ctx, createCanvas, spec.kind, { ...spec, palette: pal });
  else if (spec.kind === 'roof') T.drawRoofSurface(ctx, createCanvas, { ...spec, palette: pal });
  else if (spec.kind === 'ornament' || spec.kind === 'molding') { ctx.fillStyle = pal.primary; ctx.fillRect(0, 0, size, size);
    C.paintBand(ctx, { carvingStyle: spec.carvingStyle || C.ORNAMENTS[0], stoneworkRole: spec.kind === 'molding' ? spec.role : 'dado', axis: 'y', size: { x: 1, y: .02, z: .7 }, position: { x: 0, y: 0, z: 0 } }, pal); }
  else { const p = C.PALETTES[spec.palette || (C.THEMES[spec.theme]?.palettes || [])[0]] || C.PALETTES.marble_dawn; p.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(Math.floor(i * size / p.length), 0, Math.ceil(size / p.length), size); });
    ctx.fillStyle = '#000'; ctx.font = '9px monospace'; ctx.fillText(String(spec.theme || spec.lighting || spec.composition || spec.component || spec.shape || spec.palette || '').slice(0, 12), 2, size - 3); }
  return c.toBuffer('image/png');
}
// One contract call -> parameter spec for drawSceneSurface (palette-locked to the catalog palettes).
async function generate(description, { runner }) {
  description = String(description || '').trim().slice(0, 200); if (!description) throw Error('Describe the texture in a few words.');
  const Contracts = require('./generationContracts');
  const value = await runner(async $ => { await $.user(`TEXTURE SPEC for the game's existing procedural surface generator. Description: ${JSON.stringify(description)}. Choose parameters only; the generator draws the pixels.`);
    const r = await Contracts.request($, { component: 'texture-spec', maxTokens: 400, parameters: { label: Contracts.text(48), kind: Contracts.choice(['floor', 'wall', 'roof']), material: Contracts.choice(MATERIALS),
      pattern: Contracts.choice(['none', ...FLOOR_PATTERNS]), undergroundProfile: Contracts.choice(['none', ...T.UNDERGROUND_PROFILES]), palette: Contracts.choice(Object.keys(C.PALETTES)), paletteStrength: { type: Number, minimum: 0, maximum: 1 } } });
    return r.value; });
  if (!value) throw Error('No texture spec returned.');
  const spec = { kind: value.kind, material: value.material, paletteName: value.palette, paletteStrength: value.paletteStrength, ...(value.pattern !== 'none' && value.kind === 'floor' ? { style: { pattern: value.pattern } } : {}),
    ...(value.undergroundProfile !== 'none' ? { undergroundProfile: value.undergroundProfile } : {}), seed: description };
  const entry = { id: `user:${Date.now().toString(36)}`, label: value.label || description, description, apply: [value.kind === 'roof' ? 'ceiling' : value.kind], spec, at: new Date().toISOString() };
  const all = readUser(); all.push(entry); fs.mkdirSync(path.dirname(userFile()), { recursive: true }); fs.writeFileSync(userFile(), JSON.stringify(all, null, 1));
  return entry;
}
module.exports = { prefabs, list, counts, thumbnail, generate, MATERIALS, FLOOR_PATTERNS, palColors };
