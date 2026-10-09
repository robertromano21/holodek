'use strict';

const { makeNavigation, reachable, chooseArchitecture, complexDimensions } = require('./sceneArchitecture');
const { planIndoorRoofs, whollyRoofless, inside } = require('./indoorRoofPlan');
const { random } = require('./dungeonGeneration');
const VERSION = 6;

// Small porticos decorate existing terrain; they never carve a second room grid.
function domeSupports(zone) {
  const cx = zone.x + Math.floor(zone.width / 2), cy = zone.y + Math.floor(zone.height / 2);
  const r = Math.max(2, Math.floor(zone.width / 2) - (zone.compact ? 1 : 2));
  const diagonal = zone.compact && r === 2 ? 2 : r - 1;
  return { cx, cy, r, points: [[-r, 0], [r, 0], [0, -r], [0, r], [-diagonal, -diagonal],
    [diagonal, -diagonal], [-diagonal, diagonal], [diagonal, diagonal]] };
}

function shrineSites(dungeon, nav, connected, count, footprint, occupied, kind = 'shrine') {
  const candidates = [];
  if (footprint) {
    for (let y = footprint.y + 3; y <= footprint.y + footprint.height - 7; y++) {
      for (let x = footprint.x + 3; x <= footprint.x + footprint.width - 6; x++) candidates.push({ x, y });
    }
  } else {
    for (const radius of [8, 14, 22, 32, 44, 60]) for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      candidates.push({ x: Math.round(dungeon.start.x + Math.cos(angle) * radius) - 2,
        y: Math.round(dungeon.start.y + Math.sin(angle) * radius) - 2 });
    }
  }
  const seed = dungeon.generation?.seed;
  const rnd = seed ? random(`${seed}:${kind}:sites`) : null;
  for (const p of candidates) p.rank = Math.hypot(p.x + 2 - dungeon.start.x, p.y + 2 - dungeon.start.y) + (rnd ? rnd() * 12 : 0);
  candidates.sort((a, b) => a.rank - b.rank);
  const sites = [];
  const sizes = kind === 'rotunda' ? footprint ? [[7, 7]] : [[9, 9], [7, 7]] : [[4, 5], [4, 4], [3, 4]];
  for (const { x, y } of candidates) for (const [width, height] of sizes) {
    if (x < 1 || y < 1 || x + width >= nav.width || y + height >= nav.height ||
        Math.hypot(x + width / 2 - dungeon.start.x, y + height / 2 - dungeon.start.y) < 6 ||
        sites.some(s => Math.hypot(x - s.x, y - s.y) < 12) ||
        occupied.some(s => !footprint && s.compact && Math.hypot(x - s.x, y - s.y) < 12 ||
          x < s.x + s.width && x + width > s.x && y < s.y + s.height && y + height > s.y)) continue;
    const floors = [];
    let valid = true;
    let walkable = 0;
    for (let dy = 0; dy < height && valid; dy++) for (let dx = 0; dx < width; dx++) {
      const c = dungeon.cells[`${x + dx},${y + dy}`];
      const corner = (dx === 0 || dx === width - 1) && (dy === 0 || dy === height - 1);
      const existingColumn = c?.tile === 'pillar' && (dx === 0 || dx === width - 1);
      if (kind === 'rotunda') {
        if (!c || c.exit || c.door || c.interactable || c.roof) { valid = false; break; }
        if (c.tile === 'floor' && connected.seen[(y + dy) * nav.width + x + dx]) walkable++;
      } else if (!existingColumn && (c?.tile !== 'floor' || c.feature ||
          !connected.seen[(y + dy) * nav.width + x + dx]) ||
          c?.interactable || c?.exit || c?.door || c?.roof || corner && c?.navigationReserved) {
        valid = false; break;
      }
      floors.push(c.floorHeight || 0);
    }
    if (!valid || Math.max(...floors) - Math.min(...floors) > 0.5) continue;
    const site = { role: kind, x, y, width, height, compact: true };
    if (kind === 'rotunda') {
      const { cx, cy, points } = domeSupports(site);
      if (!connected.seen[cy * nav.width + cx] || walkable < width * height * 0.55) continue;
      const supports = points.filter(([dx, dy]) => {
        const c = dungeon.cells[`${cx + dx},${cy + dy}`];
        return c?.tile === 'pillar' || c?.tile === 'floor' && !c.navigationReserved && !c.feature &&
          !c.exit && !c.door && !c.interactable;
      });
      if (supports.length < 4) continue;
    }
    sites.push(site);
    if (sites.length === count) return sites;
  }
  return sites;
}

function architecturalStyle(spec = {}) {
  const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''}`.toLowerCase();
  if (/byzantine|hagia sophia|pendentive|squinch/.test(text)) return 'byzantine';
  if (/romanesque/.test(text)) return 'romanesque';
  if (/gothic|cathedral|pointed|ribbed/.test(text)) return 'gothic';
  if (/medieval|castle|gatehouse|timber/.test(text)) return 'medieval';
  return 'classical';
}

function columnOrder(spec = {}) {
  const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''}`.toLowerCase();
  return /corinthian|acanthus/.test(text) ? 'corinthian' : /ionic|volute/.test(text) ? 'ionic' : 'doric';
}

// Sky remains the default; ruined courtyards do not become indoor rooms.
function roofStyle(spec = {}) {
  const clauses = `${spec.source?.roomName || ''}. ${spec.source?.description || ''}`.toLowerCase().split(/[.!?;]/);
  const text = clauses.filter(s => /roof|ceiling|vault|covered hall|dome|rotunda/.test(s) &&
    !/roofless|no roof|without|collapsed roof|fallen roof|open[- ]sky|like|as if/.test(s)).join(' ');
  if (!text) return null;
  if (/pendentive/.test(text)) return 'pendentive';
  if (/squinch/.test(text)) return 'squinch';
  if (/fan[- ]vault/.test(text)) return 'fan';
  if (/groin|cross[- ]vault/.test(text)) return 'groin';
  if (/hammer[- ]?beam/.test(text)) return 'hammerbeam';
  if (/boarded|flat wooden|painted timber/.test(text)) return 'boarded';
  if (/gold|gilded/.test(text) && /coffer/.test(text)) return 'gold-coffered';
  if (/rotunda|dome/.test(text)) return 'domed';
  if (/coffer/.test(text)) return 'coffered';
  if (/ribbed|gothic|pointed vault/.test(text) || architecturalStyle(spec) === 'gothic') return 'ribbed';
  if (/barrel|vault/.test(text)) return 'barrel';
  if (/timber|wood|beam/.test(text)) return 'timber';
  return 'stone';
}

// Linear vault segments share edge heights instead of stacking horizontal tile slabs.
function roofProfile(style, x, width) {
  const t = Math.max(0, Math.min(1, x / width));
  if (style === 'barrel') return Math.sin(t * Math.PI) * 1.2;
  if (style === 'ribbed') return (1 - Math.abs(2 * t - 1)) * 1.6;
  if (style === 'pitched' || style === 'timber') return (1 - Math.abs(2 * t - 1)) * 1.0;
  return 0;
}

function applySceneRoofs(dungeon, spec = {}) {
  const architecture = dungeon?.sceneArchitecture;
  if (!dungeon?.cells || !dungeon.layout || !dungeon.start || architecture?.reason === 'disabled') {
    return { status: 'skipped', reason: 'no-architecture' };
  }
  if (dungeon.sceneRoof?.version === VERSION) return dungeon.sceneRoof;
  const idiom = architecturalStyle(spec), order = columnOrder(spec);
  const text = `${spec.source?.roomName || ''} ${spec.source?.description || ''}`;
  const explicitlyRoofless = whollyRoofless(spec);
  const declaredStyle = roofStyle(spec);
  const defaults = { temple: idiom === 'gothic' ? 'ribbed' : 'coffered', castle: architecture?.variant === 'stone-keep' ? 'groin' : 'timber',
    bathhouse: 'barrel', catacomb: 'barrel', rotunda: 'domed', basilica: 'coffered', forum: 'coffered',
    domus: 'coffered', villa: 'coffered', warehouse: 'timber', insula: 'boarded',
    amphitheater: 'barrel', theater: 'barrel', circus: 'coffered', infrastructure: 'barrel' };
  const indoor = spec.indoor === true || spec.indoor !== false && dungeon.classification?.indoor === true;
  const style = explicitlyRoofless ? null : declaredStyle || (idiom === 'byzantine' ? 'pendentive' :
    idiom === 'romanesque' ? 'barrel' : defaults[architecture?.family] || (indoor ? 'barrel' : null));
  const courtyardMentioned = /courtyard|open[- ]air|roofless|collapsed roof/i.test(text);
  const parts = [], bays = [], rejected = [];
  const material = spec.wallStyleMaterial || spec.wallMaterial || 'stone';
  const dimensions = architecture?.dimensions || complexDimensions(spec);
  dungeon.tiles ||= {};
  const tileFor = (shape, mat = material) => {
    const tile = `custom_structure_v${VERSION}_${shape}_${mat}`;
    dungeon.tiles[tile] ||= { url: dungeon.tiles.pillar?.url || dungeon.tiles.wall?.url,
      spriteSpec: { voxelShape: shape, material: mat, profile: 'flat', heightRatio: 1,
        baseWidth: 0.85, gridWidth: 0.85, collisionRadius: 0.43 } };
    return tile;
  };
  const part = (shape, pos, size, role, mat = material) => {
    parts.push({ tile: tileFor(shape, mat), shape, position: pos, size, role });
  };
  if (architecture?.variant === 'motte-bailey') for (const c of Object.values(dungeon.cells)) {
    if (c.tile !== 'wall' || c.door || c.exit || c.feature || !['shell', 'keep-curtain'].includes(c.architectureRole)) continue;
    c.tile = tileFor('palisade', 'wood'); c.architectureRole = 'castle-timber-wall';
    c.structureHeight = (c.ceilHeight || 3.5) - (c.floorHeight || 0);
  }
  // A cached pre-upgrade slab must not survive beneath the new vault.
  for (const cell of Object.values(dungeon.cells)) if (cell.roof) delete cell.roof;
  const zones = !explicitlyRoofless && architecture?.status === 'built' ?
    architecture.zones.filter(z => z.role !== 'courtyard' && z.role !== 'perimeter' &&
      z.role !== 'exterior-approach' &&
      (style || z.roofStyle || defaults[z.moduleFamily]) &&
      (declaredStyle || z.moduleFamily || z.role !== 'nave' && z.role !== 'spine')) : [];
  const outdoor = spec.indoor === false || dungeon.classification?.indoor === false;
  const temple = (architecture?.family || chooseArchitecture(spec)?.family) === 'temple';
  const nestedShrine = /\bshrine|\bportico|\bpediment/i.test(text);
  const entrance = /\btemple\b.*\bentrance\b/i.test(spec.source?.roomName || '');
  const ruinText = `${text} ${spec.source?.puzzle || ''}`;
  const biome = spec.biome || dungeon.classification?.biome || '';
  const outdoorRuins = outdoor && (/ruin|shrine|temple|altar|tomb|masonry/i.test(ruinText) ||
    /wasteland|desert|ruins|volcanic/.test(biome));
  const requestedShrines = entrance || !explicitlyRoofless && (temple || nestedShrine) ? 1 :
    outdoorRuins && !explicitlyRoofless ? 3 : 0;
  let navigation = makeNavigation(dungeon), connected = reachable(navigation, dungeon.start);
  const existingRotunda = zones.some(z => z.role === 'rotunda');
  const requestedRotundas = existingRotunda || !explicitlyRoofless && (temple || outdoorRuins || /\brotunda\b/i.test(text)) ? 1 : 0;
  const footprint = (temple || nestedShrine) && architecture?.status === 'built' ? architecture.footprint : null;
  const rotundas = requestedRotundas && !existingRotunda ?
    shrineSites(dungeon, navigation, connected, 1, footprint, zones, 'rotunda') : [];
  if (rotundas.length) zones.push(...rotundas);
  else if (requestedRotundas && !existingRotunda) rejected.push({ role: 'rotunda', reason: 'no-safe-connected-site', requested: 1 });
  const shrineCount = outdoor && !temple && !nestedShrine ? requestedShrines - rotundas.length : requestedShrines;
  const remainingShrines = Math.max(0, shrineCount - zones.filter(z => z.role === 'shrine').length);
  const sites = remainingShrines ? shrineSites(dungeon, navigation, connected, remainingShrines, footprint, zones) : [];
  if (explicitlyRoofless && entrance) for (const site of sites) site.openPortico = true;
  // A roofless middle cluster makes outdoor ruins less like repeated intact temples.
  if (outdoor && sites.length > 1) sites[1].openPortico = true;
  zones.push(...sites);
  if (sites.length < remainingShrines) rejected.push({ role: 'shrine', reason: 'no-safe-connected-site',
    requested: remainingShrines, candidates: sites.length });
  let coveragePlan;
  let porticoRetried = false;
  // Initial architectural bays get priority; infill is planned from the remaining real floors.
  for (let zoneIndex = 0; zoneIndex < zones.length || !coveragePlan; zoneIndex++) {
    if (zoneIndex === zones.length) {
      if (!porticoRetried && shrineCount && !bays.some(b => b.role === 'shrine')) {
        porticoRetried = true;
        const retries = shrineSites(dungeon, navigation, connected, 1, footprint, bays);
        if (explicitlyRoofless && entrance) for (const site of retries) site.openPortico = true;
        if (retries.length) { zones.push(...retries); zoneIndex--; continue; }
      }
      coveragePlan = planIndoorRoofs(dungeon, spec, connected, bays.filter(b => !b.openPortico));
      zones.push(...coveragePlan.zones);
      if (zoneIndex === zones.length) break;
    }
    const zone = zones[zoneIndex];
    if (zone.infill && coveragePlan?.open.some(o => inside(o, zone.x, zone.y))) continue;
    const z = { ...zone };
    const bayIdiom = z.role === 'shrine' && (entrance || /pediment|classical|roman|doric|ionic|corinthian/i.test(text)) ? 'classical' : idiom;
    const bayOrder = ['doric', 'ionic', 'corinthian'].includes(z.columnOrder) ? z.columnOrder : order;
    const supportShape = bayIdiom === 'gothic' ? 'gothic_pier' : bayIdiom === 'medieval' ? 'timber_post' : `${bayOrder}_column`;
    if (courtyardMentioned && z.role === 'nave') z.height = Math.ceil(z.height / 2);
    const bayStyle = z.roofStyle || declaredStyle || defaults[z.moduleFamily] || style;
    const transitionDome = ['pendentive', 'squinch'].includes(bayStyle) && z.width >= 5 && z.height >= 5 && !z.infill;
    const dome = z.role === 'rotunda' || transitionDome;
    if (transitionDome) z.width = z.height = Math.min(z.width, z.height);
    const zoneStyle = dome ? transitionDome || ['pendentive', 'squinch'].includes(bayStyle) ? bayStyle : 'domed' : z.openPortico ? 'open-portico' : z.role === 'shrine' ?
      bayIdiom === 'gothic' ? 'ribbed' : bayIdiom === 'medieval' ? 'timber' : 'pitched' : bayStyle === 'domed' ? 'coffered' : bayStyle;
    const nav = navigation, before = connected;
    const spring = Math.max(...Array.from({ length: z.width * z.height }, (_, i) => {
      const cell = dungeon.cells[`${z.x + i % z.width},${z.y + Math.floor(i / z.width)}`];
      return (cell?.floorHeight || 0) + (Number.isFinite(z.clearance) ? z.clearance : dimensions.clearance);
    }));
    const patch = new Map(), supportKeys = [], supportCaps = new Map();
    const support = (x, y) => {
      const key = `${x},${y}`, c = dungeon.cells[key];
      if (!c) return false;
      if (c.architectureRole === 'roof-support' && c.structureHeight && c.ceilHeight >= spring) {
        // Adjacent shrine and nave bays can share an already-grounded column.
        patch.set(key, c);
      } else if (c.tile === 'torch' && z.infill && !c.door && !c.exit) {
        // Extend the masonry above the existing wall without moving the mounted torch.
        patch.set(key, c);
        const capBase = c.ceilHeight ?? (c.floorHeight || 0) + 2.5;
        if (capBase < spring + 0.35) supportCaps.set(key, { x, y, z: capBase, height: spring + 0.35 - capBase });
      } else if ((c.tile === 'wall' || c.architectureRole === 'castle-timber-wall') && !c.door && !c.exit) {
        const ceilHeight = Math.max(c.ceilHeight || 0, spring + 0.35);
        patch.set(key, { ...c, ceilHeight, ...(c.structureHeight ? { structureHeight: ceilHeight - (c.floorHeight || 0) } : {}) });
      } else if (c.tile === 'pillar' || c.tile === 'floor' && (!z.infill || z.width >= 4 && z.height >= 4) && !c.navigationReserved &&
          !c.exit && !c.door && !c.interactable && !c.feature &&
          Math.hypot(x - dungeon.start.x, y - dungeon.start.y) > 2) {
        patch.set(key, { ...c, tile: tileFor(supportShape, bayIdiom === 'medieval' ? 'wood' : material),
          feature: 'pillar', ceilHeight: spring, structureHeight: spring - (c.floorHeight || 0),
          architectureRole: 'roof-support' });
      } else return false;
      supportKeys.push(key);
      return true;
    };
    if (dome) {
      if (transitionDome) for (const x of [z.x, z.x + z.width - 1]) {
        for (const y of [z.y, z.y + z.height - 1]) support(x, y);
      } else {
        const { cx, cy, points } = domeSupports(z);
        for (const [dx, dy] of points) support(cx + dx, cy + dy);
      }
    } else {
      const xs = z.role === 'shrine' ? [z.x, z.x + z.width - 1] : [z.x - 1, z.x + z.width];
      for (let y = z.y; y < z.y + z.height; y += z.compact ? z.height - 1 : 3) for (const x of xs) support(x, y);
      for (const x of xs) support(x, z.y + z.height - 1);
      if (z.infill) for (const y of [z.y - 1, z.y + z.height]) {
        for (const x of [z.x, z.x + z.width - 1]) support(x, y);
      }
      if (z.infill) {
        for (let y = z.y; y < z.y + z.height; y++) for (const x of xs) {
          const c = dungeon.cells[`${x},${y}`];
          if (c?.tile === 'wall' || c?.tile === 'torch' || c?.structureHeight) support(x, y);
        }
        for (let x = z.x; x < z.x + z.width; x++) for (const y of [z.y - 1, z.y + z.height]) {
          const c = dungeon.cells[`${x},${y}`];
          if (c?.tile === 'wall' || c?.tile === 'torch' || c?.structureHeight) support(x, y);
        }
      }
    }
    const next = { ...nav, passable: nav.passable.slice(), floors: nav.floors.slice() };
    for (const [key, c] of patch) {
      const [x, y] = key.split(',').map(Number);
      next.passable[y * nav.width + x] = c.tile === 'floor' ? 1 : 0;
    }
    const after = reachable(next, dungeon.start);
    const disconnected = before.seen.some((seen, i) => seen && next.passable[i] && !after.seen[i]);
    const uniqueSupports = [...new Set(supportKeys)];
    const opposingWalls = z.infill && (z.width <= 3 || z.height <= 3) && uniqueSupports.some(key => {
      const [x, y] = key.split(',').map(Number);
      return x === z.x - 1 && uniqueSupports.includes(`${z.x + z.width},${y}`) ||
        y === z.y - 1 && uniqueSupports.includes(`${x},${z.y + z.height}`);
    });
    const minimumSupports = opposingWalls ? 2 : 4;
    if (uniqueSupports.length < minimumSupports || disconnected) {
      rejected.push({ role: z.role, reason: disconnected ? 'would-block-route' : 'insufficient-supports',
        supports: uniqueSupports, x: z.x, y: z.y });
      continue;
    }
    for (const [key, c] of patch) dungeon.cells[key] = c;
    for (const cap of supportCaps.values()) part('entablature', { x: cap.x, y: cap.y, z: cap.z },
      { x: 1, y: 1, z: cap.height }, 'wall-roof-cap');
    navigation = next; connected = after;
    if (dome) {
      const r = transitionDome ? (z.width - 1) / 2 : domeSupports(z).r, diameter = r * 2 + 1;
      const x = z.x + Math.floor(z.width / 2) - r, y = z.y + Math.floor(z.height / 2) - r;
      const transitionHeight = transitionDome ? 1.2 : 0;
      if (transitionDome) part(`${bayStyle}_transition`, { x, y, z: spring },
        { x: diameter, y: diameter, z: transitionHeight }, 'dome-transition');
      part('entablature_ring', { x, y, z: spring + transitionHeight }, { x: diameter, y: diameter, z: 0.4 }, 'drum');
      part('dome_shell', { x, y, z: spring + transitionHeight + 0.35 },
        { x: diameter, y: diameter, z: 2.4 }, 'dome');
      for (let dy = 0; dy < z.height; dy++) for (let dx = 0; dx < z.width; dx++) {
        const c = dungeon.cells[`${z.x + dx},${z.y + dy}`];
        if (!c || Math.hypot(z.x + dx + 0.5 - x - diameter / 2, z.y + dy + 0.5 - y - diameter / 2) > diameter / 2) continue;
        c.roof ||= { version: VERSION, style: zoneStyle, height: spring + transitionHeight + 0.35,
          slopeX: 0, slopeY: 0, material, zone: z.role };
      }
      if (z.compact && idiom === 'classical') {
        const { cx, cy, points } = domeSupports(z);
        // A paired, grounded threshold carries the pediment; never add an unsupported facade.
        for (const side of [1, -1]) {
          const dy = Math.max(...points.map(p => p[1])) * side;
          const dx = Math.max(...points.filter(p => p[1] === dy).map(p => p[0]));
          if (!uniqueSupports.includes(`${cx - dx},${cy + dy}`) || !uniqueSupports.includes(`${cx + dx},${cy + dy}`)) continue;
          const position = { x: cx - dx + 0.05, y: cy + dy + 0.1, z: spring };
          part('entablature', position, { x: dx * 2 + 0.9, y: 0.8, z: 0.35 }, 'rotunda-portico');
          part('pediment', { ...position, z: spring + 0.35 },
            { x: dx * 2 + 0.9, y: 0.6, z: 1 }, 'rotunda-pediment');
          break;
        }
      }
    } else {
      const left = z.role === 'shrine' ? z.x + 0.5 : z.x - 0.5;
      const right = z.role === 'shrine' ? z.x + z.width - 0.5 : z.x + z.width + 0.5;
      const wooden = ['timber', 'hammerbeam', 'boarded', 'pitched'].includes(zoneStyle);
      const beamMat = wooden ? 'wood' : zoneStyle === 'gold-coffered' ? 'gold' : material;
      for (const x of [left, right]) part('entablature', { x: x - 0.5, y: z.y, z: spring },
        { x: 1, y: z.height, z: 0.35 }, 'eave', beamMat);
      for (const y of [z.y + 0.5, z.y + z.height - 0.5]) {
        part('entablature', { x: left - 0.45, y: y - 0.4, z: spring },
          { x: right - left + 0.9, y: 0.8, z: 0.35 }, 'lintel', beamMat);
        if (bayIdiom === 'classical' && (z.role === 'shrine' || z.role === 'sanctum')) {
          part('pediment', { x: left - 0.45, y: y - 0.3, z: spring + 0.35 },
            { x: right - left + 0.9, y: 0.6, z: 1 }, 'pediment');
        }
      }
      if (['barrel', 'ribbed', 'timber', 'hammerbeam'].includes(zoneStyle)) {
        for (let dy = 0; dy < z.height; dy += 3) {
          const shape = { barrel: 'barrel_rib', ribbed: 'ribbed_vault', timber: 'timber_truss', hammerbeam: 'hammerbeam_truss' }[zoneStyle];
          part(shape, { x: z.x, y: z.y + dy, z: spring + 0.23 },
            { x: z.width, y: Math.min(3, z.height - dy), z: zoneStyle === 'ribbed' ? 1.6 : zoneStyle === 'barrel' ? 1.2 : 1 },
            'roof-frame', beamMat);
        }
      }
      const shellShape = { barrel: 'barrel_vault_shell', ribbed: 'pointed_vault_shell',
        timber: 'pitched_roof_shell', pitched: 'pitched_roof_shell', hammerbeam: 'pitched_roof_shell',
        boarded: 'boarded_ceiling', 'gold-coffered': 'gold_coffered_slab', groin: 'groin_vault_shell', fan: 'fan_vault_shell',
        pendentive: 'groin_vault_shell', squinch: 'groin_vault_shell' }[zoneStyle] || 'coffered_slab';
      if (!z.openPortico) part(shellShape, { x: z.x, y: z.y, z: spring + 0.35 },
        { x: z.width, y: z.height, z: zoneStyle === 'barrel' ? 1.35 : zoneStyle === 'ribbed' ? 1.75 :
          ['timber', 'pitched', 'hammerbeam', 'groin', 'fan', 'pendentive', 'squinch'].includes(zoneStyle) ? 1.15 : 0.22 }, 'roof-shell', beamMat);
      for (let dy = 0; dy < z.height; dy++) for (let dx = 0; dx < z.width; dx++) {
        const c = dungeon.cells[`${z.x + dx},${z.y + dy}`];
        if (!c || c.roof || z.openPortico) continue;
        const h0 = roofProfile(zoneStyle, dx, z.width), h1 = roofProfile(zoneStyle, dx + 1, z.width);
        c.roof = { version: VERSION, style: zoneStyle, height: spring + 0.35 + (h0 + h1) / 2,
          slopeX: h1 - h0, slopeY: 0, material: beamMat, zone: z.role };
      }
    }
    bays.push({ ...z, style: zoneStyle, idiom: bayIdiom, springHeight: spring, supports: uniqueSupports,
      supportCaps: [...supportCaps.keys()], minimumSupports });
  }
  if (idiom === 'gothic' && bays.length && architecture?.footprint) {
    const f = architecture.footprint, x = f.x + 2;
    for (const y of [f.y + 5, f.y + 10, f.y + 15]) {
      const c = dungeon.cells[`${x},${y}`];
      if (c?.tile !== 'wall' || c.exit || c.door || c.feature) continue;
      const floor = c.floorHeight || 0, height = Math.max(3.5, (c.ceilHeight || 0) - floor + 0.8);
      part('flying_buttress', { x, y, z: floor }, { x: 3, y: 1, z: height }, 'flying-buttress');
    }
  }
  const gateways = [], rejectedGateways = [];
  for (const entrance of architecture?.entrances || []) {
    const axisY = ['east', 'west'].includes(entrance.direction);
    if (!['north', 'east', 'south', 'west'].includes(entrance.direction)) {
      rejectedGateways.push({ direction: entrance.direction, reason: 'corner-vestibule-without-paired-facade' });
      continue;
    }
    const supports = [-2, 2].map(offset => ({ x: entrance.x + (axisY ? 0 : offset), y: entrance.y + (axisY ? offset : 0) }));
    if (!supports.every(p => {
      const c = dungeon.cells[`${p.x},${p.y}`];
      return c && ['wall', 'torch'].includes(c.tile) && !c.door && !c.exit && !c.interactable;
    })) {
      rejectedGateways.push({ direction: entrance.direction, reason: 'no-existing-paired-wall-supports' });
      continue;
    }
    const spring = Math.max(...supports.map(p => (dungeon.cells[`${p.x},${p.y}`].floorHeight || 0) + dimensions.clearance));
    for (const p of supports) {
      const c = dungeon.cells[`${p.x},${p.y}`];
      if (c.tile === 'torch') {
        if (c.ceilHeight < spring + 0.35) part('entablature', { x: p.x, y: p.y, z: c.ceilHeight },
          { x: 1, y: 1, z: spring + 0.35 - c.ceilHeight }, 'gateway-wall-cap');
      } else c.ceilHeight = Math.max(c.ceilHeight, spring + 0.35);
    }
    const position = { x: entrance.x - (axisY ? 0 : 2), y: entrance.y - (axisY ? 2 : 0), z: spring };
    part('entablature', position, { x: axisY ? 1 : 5, y: axisY ? 5 : 1, z: 0.35 }, 'gateway-lintel');
    if (!axisY && idiom === 'classical') part('pediment', { ...position, z: spring + 0.35 },
      { x: 5, y: 1, z: 1.2 }, 'gateway-pediment');
    gateways.push({ direction: entrance.direction, springHeight: spring, supports });
  }
  let facadeParts = 0;
  if (architecture?.status === 'built' && architecture.entrances?.length && !explicitlyRoofless) {
    const f = architecture.footprint;
    const castle = architecture.family === 'castle', timber = architecture.variant === 'motte-bailey';
    const edges = [
      { x: f.x + 2, y: f.y + 2, dx: 1, dy: 0, length: f.width - 4 },
      { x: f.x + 2, y: f.y + f.height - 3, dx: 1, dy: 0, length: f.width - 4 },
      { x: f.x + 2, y: f.y + 3, dx: 0, dy: 1, length: f.height - 6 },
      { x: f.x + f.width - 3, y: f.y + 3, dx: 0, dy: 1, length: f.height - 6 }
    ];
    for (const edge of edges) {
      let start = null, count = 0, height = 0;
      const flush = () => {
        if (!start) return;
        const shape = castle && !timber ? 'battlement' : 'entablature';
        part(shape, { x: start.x - 0.06, y: start.y - 0.06, z: height },
          { x: edge.dx ? count + 0.12 : 1.12, y: edge.dy ? count + 0.12 : 1.12, z: castle && !timber ? 0.7 : 0.25 },
          castle && !timber ? 'exterior-battlement' : 'facade-cornice', timber ? 'wood' : material);
        facadeParts++; start = null; count = 0;
      };
      for (let i = 0; i < edge.length; i++) {
        const x = edge.x + edge.dx * i, y = edge.y + edge.dy * i, c = dungeon.cells[`${x},${y}`];
        const wall = c && ['wall', 'torch'].includes(c.tile) && !c.door && !c.exit && !c.interactable;
        if (!wall || start && Math.abs(c.ceilHeight - height) > 0.01) flush();
        if (wall) {
          if (!start) { start = { x, y }; height = c.ceilHeight; }
          count++;
        }
      }
      flush();
    }
  }
  dungeon.sceneStructures = parts;
  const count = Object.values(dungeon.cells).filter(c => c.roof).length;
  let covered = 0;
  if (coveragePlan?.indoor) for (const [key, c] of Object.entries(dungeon.cells)) {
    const [x, y] = key.split(',').map(Number);
    if (c.tile === 'floor' && c.roof && connected.seen[y * navigation.width + x] &&
        !coveragePlan.open.some(z => inside(z, x, y))) covered++;
  }
  const coverageRatio = coveragePlan?.eligible ? covered / coveragePlan.eligible : 0;
  return (dungeon.sceneRoof = { version: VERSION, status: bays.length ? 'built' : 'skipped', style,
    idiom, columnOrder: order, coveredCells: count, bays, rejected, parts: parts.length, skyDefault: true,
    dimensions, gateways, rejectedGateways, facadeParts,
    roofEvidence: declaredStyle ? roofStyle({ source: { description: spec.source?.description } }) ? 'description' : 'room-name' :
      defaults[architecture?.family] ? 'building-family' : indoor ? 'indoor-default' : 'localized-shrines',
    shrines: { requested: shrineCount, placed: bays.filter(b => b.compact && b.role === 'shrine').length,
      evidence: entrance ? 'temple-entrance' : outdoorRuins ? 'outdoor-ruin-context' : 'description' },
    rotundas: { requested: requestedRotundas, placed: bays.filter(b => b.role === 'rotunda').length },
    coverage: coveragePlan?.indoor ? { eligible: coveragePlan.eligible, target: coveragePlan.target,
      covered, uncovered: Math.max(0, coveragePlan.eligible - covered), ratio: coverageRatio,
      targetMet: coverageRatio >= coveragePlan.target,
      openZones: coveragePlan.open, limitReached: coveragePlan.limitReached || false } : null });
}

module.exports = { roofStyle, applySceneRoofs, roofProfile, architecturalStyle, columnOrder };
