'use strict';
// Real routes to living-region communities. A route is a short chain of grid cells that starts at an existing,
// not-yet-prepared frontier cell reachable through open exits from the start room. Its exits are created by the
// normal topology pass (roomBuildTopology.prepare) as each cell is built, so the community becomes reachable through
// actual traversable exits. A route is advertised only once its exits exist (see status()).
const DIRS = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0], northeast: [1, 1], southeast: [1, -1], northwest: [-1, 1], southwest: [-1, -1] };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east', northeast: 'southwest', southwest: 'northeast', northwest: 'southeast', southeast: 'northwest' };
const COORD = /^-?\d+,-?\d+,-?\d+$/;
const parse = key => String(key).split(',').map(Number);
const step = (key, dir) => { const p = parse(key), d = DIRS[dir]; return `${p[0] + d[0]},${p[1] + d[1]},${p[2]}`; };
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function prepared(room) { return !!(room && (room.visited || room.populationComplete || room.preparedBuild || room.backgroundTopology?.version === 1 || room.builder?.mode === 'hand')); }
// Rooms whose exits are owned by another planned system.
function special(room) { return !!(room && (room.fortifiedFloor || room.villagePlan || room.villageBuilding || room.cityRoom || room.planarRealm || room.exits?.portal ||
  room.bossGate || room.regionalSite || room.cityFloorContext || room.citySites)); }
function claimed(db, region) {
  const keys = new Set(['0,0,0']), root = db['0,0,0'] || {};
  for (const room of Object.values(db)) for (const t of [room?.bossGate?.targetKey, room?.bossGate?.targetCoordinates]) if (typeof t === 'string') keys.add(t);
  for (const c of root.campaignAtlas?.map?.cities || []) if (c?.site?.key) keys.add(c.site.key);
  for (const k of root.regionalAdventure?.rooms || []) keys.add(k);
  for (const r of region?.routes || []) if (r.status !== 'abandoned') { r.cells.forEach(k => keys.add(k)); if (r.gate) keys.add(r.gate.key); (r.footprint?.rooms || []).forEach(k => keys.add(k)); }
  return keys;
}
// Keys that some existing room already points an exit at. An in-flight build may own those (its topology write set).
function targeted(db) { const out = new Set(); for (const room of Object.values(db)) for (const e of Object.values(room?.exits || {})) if (e?.targetCoordinates) out.add(e.targetCoordinates); return out; }
// Breadth-first search over OPEN exits only; unbuilt exit targets are leaves.
function search(db, from = '0,0,0') {
  const seen = new Map([[from, { depth: 0, prev: null, dir: null }]]), queue = [from];
  while (queue.length) {
    const key = queue.shift(), room = db[key];
    for (const [dir, exit] of Object.entries(room?.exits || {})) {
      const to = exit?.targetCoordinates;
      if (!to || !COORD.test(to) || seen.has(to) || String(exit.status || 'open').toLowerCase() !== 'open' || exit.kind === 'portal') continue;
      seen.set(to, { depth: seen.get(key).depth + 1, prev: key, dir }); queue.push(to);
    }
  }
  return seen;
}
function directions(db, to, from = '0,0,0') {
  const seen = search(db, from); if (!seen.has(to)) return null;
  const out = []; for (let k = to; seen.get(k).prev; k = seen.get(k).prev) out.unshift({ from: seen.get(k).prev, dir: seen.get(k).dir, to: k });
  return out;
}
// Plans one route: frontier T (reachable, unprepared) -> M -> anchor A, in a straight line, plus an optional blocked
// side passage G beyond A (the route a resident's "access" consequence can open). Every planned cell is unclaimed,
// has no record yet and is not the target of any existing exit (so no in-flight build owns it).
function plan(db, region, communityId, { reserved = [] } = {}) {
  const taken = new Set([...claimed(db, region), ...reserved]), aimed = targeted(db), seen = search(db);
  const free = key => !taken.has(key) && !db[key] && !aimed.has(key) && parse(key)[2] === 0;
  const frontier = [...seen.entries()].filter(([key]) => {
    const room = db[key]; return key !== '0,0,0' && !taken.has(key) && !prepared(room) && !special(room) && parse(key)[2] === 0;
  }).sort((a, b) => a[1].depth - b[1].depth || hash(region.runId + ':' + a[0]) - hash(region.runId + ':' + b[0]));
  for (const [T, info] of frontier) {
    const dirs = Object.keys(DIRS).sort((a, b) => hash(region.runId + ':' + T + ':' + a) - hash(region.runId + ':' + T + ':' + b));
    for (const dir of dirs) {
      if (info.dir && OPP[info.dir] === dir) continue; // do not double back toward where T was entered from
      const M = step(T, dir), A = step(M, dir), G = step(A, dir);
      if (!free(M) || !free(A)) continue;
      const p = parse(A); if (Math.max(Math.abs(p[0]), Math.abs(p[1])) < 2) continue;
      return { id: 'lrroute:' + communityId, communityId, cells: [T, M, A], dirs: [dir, dir], anchor: A,
        gate: free(G) ? { key: G, dir, status: 'blocked', reason: 'closed until a resident goal reopens it' } : null,
        entry: { from: info.prev, dir: info.dir }, status: 'planned', plannedAt: Date.now() };
    }
  }
  return null;
}
// Recovery when no straight route fits: a deliberate connected extension from a reachable, unbuilt frontier cell,
// found by breadth-first search over free cells (built rooms are never altered). Reported as route.extension.
function extend(db, region, communityId, { reserved = [] } = {}) {
  const taken = new Set([...claimed(db, region), ...reserved]), aimed = targeted(db), seen = search(db);
  const free = key => !taken.has(key) && !db[key] && !aimed.has(key) && parse(key)[2] === 0;
  const frontier = [...seen.entries()].filter(([key]) => { const room = db[key]; return key !== '0,0,0' && !taken.has(key) && !prepared(room) && !special(room) && parse(key)[2] === 0; })
    .sort((a, b) => a[1].depth - b[1].depth || hash(region.runId + ':' + a[0]) - hash(region.runId + ':' + b[0]));
  for (const [T, info] of frontier) {
    const prev = new Map([[T, null]]), queue = [[T, 0]];
    while (queue.length) {
      const [key, depth] = queue.shift();
      if (depth >= 2) {
        const p = parse(key);
        if (Math.max(Math.abs(p[0]), Math.abs(p[1])) >= 2) {
          const cells = [], dirs = []; for (let k = key; k; k = prev.get(k)?.from) { cells.unshift(k); if (prev.get(k)) dirs.unshift(prev.get(k).dir); }
          const last = dirs.at(-1), G = step(key, last);
          return { id: 'lrroute:' + communityId, communityId, cells, dirs, anchor: key, gate: free(G) && !cells.includes(G) ? { key: G, dir: last, status: 'blocked', reason: 'closed until a resident goal reopens it' } : null,
            entry: { from: info.prev, dir: info.dir }, status: 'planned', plannedAt: Date.now(),
            extension: { frontier: T, enteredFrom: info.prev, leadsTo: key, path: dirs, reason: 'no straight route fitted between existing rooms' } };
        }
      }
      if (depth >= 4) continue;
      for (const dir of Object.keys(DIRS).sort((a, b) => hash(region.runId + key + a) - hash(region.runId + key + b))) {
        const next = step(key, dir); if (prev.has(next) || !free(next)) continue;
        prev.set(next, { from: key, dir }); queue.push([next, depth + 1]);
      }
    }
  }
  return null;
}
// Regional continuity: when no frontier route fits, the next community is reserved onward from an earlier community's
// footprint (an unbuilt room there gets one more open exit), so communities connect to each other.
function chain(db, region, communityId, { reserved = [] } = {}) {
  const taken = new Set([...claimed(db, region), ...reserved]), aimed = targeted(db);
  const free = key => !taken.has(key) && !db[key] && !aimed.has(key) && parse(key)[2] === 0;
  for (const prior of (region.routes || []).filter(r => r.status !== 'abandoned' && r.footprint)) {
    const hosts = [prior.anchor, ...prior.cells.slice(0, -1).reverse()].filter(k => !prepared(db[k]));
    for (const H of hosts) {
      const used = new Set(linksOf(prior).flatMap(l => l.from === H ? [l.dir] : l.to === H ? [OPP[l.dir]] : []));
      for (const d of Object.keys(DIRS).filter(d => !used.has(d)).sort((a, b) => hash(region.runId + H + communityId + a) - hash(region.runId + H + communityId + b))) {
        const T = step(H, d); if (!free(T)) continue;
        for (const dir of Object.keys(DIRS).filter(x => x !== OPP[d]).sort((a, b) => hash(region.runId + T + a) - hash(region.runId + T + b))) {
          const M = step(T, dir), A = step(M, dir), G = step(A, dir);
          if (!free(M) || !free(A) || M === H || A === H) continue;
          const p = parse(A); if (Math.max(Math.abs(p[0]), Math.abs(p[1])) < 2) continue;
          return { id: 'lrroute:' + communityId, communityId, cells: [T, M, A], dirs: [dir, dir], anchor: A,
            gate: free(G) ? { key: G, dir, status: 'blocked', reason: 'closed until a resident goal reopens it' } : null,
            entry: { from: H, dir: d }, connector: { from: H, dir: d, to: T, communityId: prior.communityId }, chainedFrom: prior.communityId, status: 'planned', plannedAt: Date.now() };
        }
      }
    }
  }
  return null;
}
const SIDE = dir => Object.keys(DIRS).filter(d => d !== dir && d !== OPP[dir] && !d.includes(dir) && !dir.includes(d) && d.length <= 5);
// The connected playable footprint, reserved before any helper builds near it: route cells (with their exits), the
// community room, each resident's objective room (route rooms short of the community) and a side room per resident for
// their successor request (the opposite obstacle), plus the blocked passage. Saved in the region as route.footprint.
function reserve(db, region, community, residents, { reserved = [] } = {}) {
  const route = plan(db, region, community.id, { reserved }) || extend(db, region, community.id, { reserved }) || chain(db, region, community.id, { reserved });
  if (!route) return null;
  const taken = new Set([...claimed(db, region), ...reserved, ...route.cells, ...(route.gate ? [route.gate.key] : [])]), aimed = targeted(db);
  const free = key => !taken.has(key) && !db[key] && !aimed.has(key) && parse(key)[2] === 0;
  const links = route.cells.slice(0, -1).map((k, i) => ({ from: k, dir: route.dirs[i], to: route.cells[i + 1], status: 'open', kind: 'route' }));
  if (route.connector) links.unshift({ from: route.connector.from, dir: route.connector.dir, to: route.connector.to, status: 'open', kind: 'connector' });
  if (route.gate) links.push({ from: route.anchor, dir: route.gate.dir, to: route.gate.key, status: 'blocked', kind: 'gate' });
  const objectiveRooms = route.cells.slice(0, -1), objectives = {}, successorRooms = {};
  residents.forEach((r, i) => { if (objectiveRooms[i]) objectives[r.id] = { key: objectiveRooms[i], obstacle: r.goal.objective.obstacle }; });
  const hosts = [route.anchor, ...route.cells.slice(1, -1).reverse(), route.cells[0]];
  residents.forEach((r, i) => {
    for (const host of [hosts[i % hosts.length], ...hosts]) {
      const hostDir = route.dirs[Math.max(0, route.cells.indexOf(host) - 1)] || route.dirs[0];
      const dir = SIDE(hostDir).sort((a, b) => hash(region.runId + r.id + a) - hash(region.runId + r.id + b)).find(d => free(step(host, d)));
      if (!dir || (host === route.cells[0] && prepared(db[host]))) continue;
      const key = step(host, dir); taken.add(key);
      successorRooms[r.id] = { key, obstacle: r.goal.objective.obstacle === 'mechanism' ? 'hidden-chamber' : 'mechanism' };
      links.push({ from: host, dir, to: key, status: 'open', kind: 'successor' }); break;
    }
  });
  route.footprint = { version: 1, reservedAt: Date.now(), rooms: [...new Set([...route.cells, ...(route.gate ? [route.gate.key] : []), ...Object.values(successorRooms).map(s => s.key)])],
    links, objectives, successorRooms };
  return route;
}
function linksOf(route) {
  if (route.footprint?.links) return route.footprint.links;
  const links = route.cells.slice(0, -1).map((k, i) => ({ from: k, dir: route.dirs[i], to: route.cells[i + 1], status: 'open', kind: 'route' }));
  if (route.gate) links.push({ from: route.anchor, dir: route.gate.dir, to: route.gate.key, status: route.gate.status === 'open' ? 'open' : 'blocked', kind: 'gate' });
  return links;
}
// Hook for roomBuildTopology.prepare: the exits the footprint needs at this key, in both directions, whatever order the
// rooms are built in. Respects other builds' reservations; never alters a built room.
function exitsFor(db, key, { protectedKeys = new Set(), region } = {}) {
  if (!region) return [];
  const out = [];
  for (const route of region.routes || []) {
    if (route.status === 'abandoned') continue;
    const add = (dir, target, status, extra) => {
      const other = db[target];
      if (out.some(o => o.direction === dir)) return;
      // A reserved footprint link is added even toward a cell another build owns: that builder is assigned the same
      // link in reverse, so both sides agree whatever the order. Legacy routes keep the reservation rule.
      if (!route.footprint && protectedKeys.has(target) && !Object.values(other?.exits || {}).some(e => e.targetCoordinates === key)) return;
      if (other && prepared(other) && !Object.values(other.exits || {}).some(e => e.targetCoordinates === key)) return;
      out.push({ direction: dir, exit: { status, targetCoordinates: target, key: null, ...extra } });
    };
    for (const l of linksOf(route)) {
      const status = l.kind === 'gate' ? (route.gate?.status === 'open' ? 'open' : 'blocked') : l.status;
      const extra = l.kind === 'gate' ? { livingRegionGate: route.id } : { livingRegionRoute: route.id };
      if (l.from === key) add(l.dir, l.to, status, extra);
      else if (l.to === key) add(OPP[l.dir], l.from, status, extra);
    }
  }
  return out;
}
// Footprint keys other rooms' generic topology must not link into (unless the footprint itself links them).
function protectedFor(db, key, region) {
  const out = new Set();
  for (const route of region?.routes || []) {
    if (route.status === 'abandoned') continue;
    const linked = new Set(linksOf(route).flatMap(l => l.from === key ? [l.to] : l.to === key ? [l.from] : []));
    for (const k of route.footprint?.rooms || [...route.cells, ...(route.gate ? [route.gate.key] : [])]) if (k !== key && !linked.has(k)) out.add(k);
  }
  return out;
}
// planned: nothing built yet; partial: the first cells have their exits; traversable: the anchor is reachable through
// open exits from the start room; broken: a cell was built without its route exit (re-plan if nothing materialized).
function status(db, route) {
  const seen = search(db);
  if (seen.has(route.anchor)) return { status: 'traversable', path: directions(db, route.anchor) };
  for (let i = 0; i < route.cells.length - 1; i++) {
    const room = db[route.cells[i]];
    if (prepared(room) && room.exits?.[route.dirs[i]]?.targetCoordinates !== route.cells[i + 1]) return { status: 'broken', at: route.cells[i] };
  }
  if (!seen.has(route.cells[0])) {
    // A chained route waits for its host room in the earlier community's footprint.
    const host = route.connector && db[route.connector.from];
    if (route.connector && !(prepared(host) && host.exits?.[route.connector.dir]?.targetCoordinates !== route.cells[0])) return { status: 'planned', waitingOn: route.connector.from };
    return { status: 'broken', at: route.cells[0] };
  }
  return { status: prepared(db[route.cells[0]]) ? 'partial' : 'planned' };
}
// Opens the blocked side passage in both directions. Returns false when there is no physical passage to open.
function openGate(db, route) {
  if (!route.gate) return false;
  const a = db[route.anchor]?.exits?.[route.gate.dir], b = db[route.gate.key]?.exits?.[OPP[route.gate.dir]];
  if (!a || a.targetCoordinates !== route.gate.key) return false;
  a.status = 'open'; if (b && b.targetCoordinates === route.anchor) b.status = 'open';
  route.gate.status = 'open'; route.gate.openedAt = Date.now();
  return true;
}
module.exports = { DIRS, OPP, plan, extend, chain, reserve, linksOf, protectedFor, exitsFor, status, search, directions, openGate, prepared, special, claimed };
