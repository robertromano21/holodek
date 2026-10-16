(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dungeonInhabitants'));
  else root.OutdoorDiscovery = factory(root.DungeonInhabitants);
})(typeof window === 'undefined' ? globalThis : window, function(I) {
  'use strict';
  const VERSION = 1, MAX_SEARCH = 3600, QUIET_MOVING_MS = 45000, MIN_MOVING_MS = 8000;
  const SPAWN_MIN = 14, SPAWN_MAX = 20, ABANDON_RANGE = 36;
  const norm = value => String(value || '').trim().toLowerCase();
  const point = value => Number.isFinite(value?.x) && Number.isFinite(value?.y);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const nextDistance = id => 48 + I.hash(id) % 25;
  function resetPacing(travel) {
    travel.distance = 0; travel.movingMs = 0; travel.walkedDistance = 0; travel.excursion = 0; delete travel.cycleOrigin;
  }
  function eligible(d) {
    return d?.classification?.indoor === false && d.geoKey !== '0,0,0' &&
      Math.max(d.layout?.width || 0, d.layout?.height || 0) >= 192 && (d.layout?.width || 0) * (d.layout?.height || 0) >= 32768;
  }
  function itemNames(consoleText) {
    const line = String(consoleText || '').match(/^Objects in Room:[ \t]*([^\r\n]*)/m)?.[1];
    return line === undefined ? null : new Set(/^(?:none|empty|nothing)\.?$/i.test(line.trim()) ? [] : line.split(',').map(norm).filter(Boolean));
  }
  function setup(d, p, { protectedNames = [], fresh = false, player = d?.start, bossRoom = false } = {}) {
    if (!eligible(d) || !p || p.starting || bossRoom) return false;
    const protect = new Set(protectedNames.map(norm));
    let changed = false;
    if (!p.travelDiscovery || p.travelDiscovery.version !== VERSION) {
      p.travelDiscovery = { version: VERSION, objects: {}, explored: '', distance: 0, movingMs: 0,
        sequence: 0, nextDistance: nextDistance(p.geoKey), nextKind: 'people', nextAllegiance: 'Neutral' };
      changed = true;
    }
    const travel = p.travelDiscovery;
    if (travel.nextDistance > 72) { travel.nextDistance = nextDistance(`${p.geoKey}:${travel.sequence}`); changed = true; }
    if (!travel.nextAllegiance) {
      const latest = p.groups.filter(g => g.discoveryState === 'placed').sort((a, b) =>
        (p.actors[b.members[0]]?.discoveryRevision || 0) - (p.actors[a.members[0]]?.discoveryRevision || 0))[0];
      travel.nextAllegiance = latest && p.actors[latest.members[0]]?.allegiance !== 'Hostile' ? 'Hostile' : 'Neutral';
      changed = true;
    }
    const landmarks = (d.sceneLandmarks || []).filter(a => /ruin|tower|altar|shrine|gate|fort|keep|tomb|cave/i.test(a.type || ''));
    for (const group of p.groups || []) {
      const records = group.members.map(name => p.actors[name]).filter(Boolean);
      const bound = p.settlement?.hub || records.some(a => protect.has(norm(a.name)) || a.name === p.questIntroduction?.speaker);
      const anchored = records.every(a => ['guard', 'work', 'rest'].includes(a.routine)) &&
        landmarks.some(lm => point(group.site) && distance(lm, group.site) < 14);
      if (bound || anchored || group.status !== 'unseen' || group.introPlayed) {
        if (group.discoveryState === 'pending') { group.discoveryState = 'fixed'; changed = true; }
      } else if (!group.discoveryState) {
        const observed = point(player) && records.some(a => point(a.position) && distance(player, a.position) <= 24);
        group.discoveryState = observed ? 'fixed' : 'pending'; changed = true;
      }
      for (const record of records) record.discoveryState = group.discoveryState || 'fixed';
    }
    for (const item of (d.sceneObjects || []).slice(0, 64)) {
      const key = norm(item.name);
      if (!key) continue;
      const anchored = protect.has(key) || /key|artifact/i.test(item.type || '') || item.fixed || item.questBound;
      if (travel.objects[key]) {
        if (anchored && travel.objects[key].status === 'pending') { travel.objects[key].status = 'fixed'; changed = true; }
        continue;
      }
      // Existing saved loot may have been seen without being picked up; only new room loot is deferred.
      const observed = !fresh;
      travel.objects[key] = { name: item.name, id: item.id, status: anchored || observed ? 'fixed' : 'pending',
        ...(point(item) ? { x: item.x, y: item.y } : {}) };
      changed = true;
    }
    return changed;
  }
  function sample(travel, d, player, now) {
    const previous = travel.sample;
    travel.sample = { x: player.x, y: player.y, at: now };
    if (!previous || now <= previous.at || now - previous.at > 6500) return false;
    const delta = distance(previous, player);
    if (delta < 0.3 || delta > 48) return false;
    travel.heading = Math.atan2(player.y - previous.y, player.x - previous.x);
    travel.movingMs += Math.min(3500, now - previous.at);
    travel.cycleOrigin ||= { x: previous.x, y: previous.y };
    travel.walkedDistance = (travel.walkedDistance || 0) + delta;
    travel.excursion = Math.max(travel.excursion || 0, distance(travel.cycleOrigin, player));
    const columns = Math.ceil(d.layout.width / 4), length = Math.ceil(columns * Math.ceil(d.layout.height / 4) / 4);
    let explored = travel.explored.padEnd(length, '0');
    let fresh = 0;
    const steps = Math.max(1, Math.ceil(delta));
    for (let n = 1; n <= steps; n++) {
      const x = previous.x + (player.x - previous.x) * n / steps, y = previous.y + (player.y - previous.y) * n / steps;
      if (!I.pointWalkable(d, x, y)) continue;
      const index = Math.floor(y / 4) * columns + Math.floor(x / 4), slot = index >> 2, mask = 1 << (index & 3);
      const byte = parseInt(explored[slot] || '0', 16);
      if (byte & mask) continue;
      explored = explored.slice(0, slot) + (byte | mask).toString(16) + explored.slice(slot + 1); fresh++;
    }
    travel.explored = explored;
    travel.distance += Math.min(delta, fresh * 4);
    return true;
  }
  function candidates(d, player, heading, occupied) {
    const first = { x: Math.floor(player.x), y: Math.floor(player.y) }, queue = [first], seen = new Set([`${first.x},${first.y}`]), pool = [];
    for (let n = 0; n < queue.length && n < MAX_SEARCH; n++) {
      const p = queue[n], cell = d.cells[`${p.x},${p.y}`], range = Math.hypot(p.x + .5 - player.x, p.y + .5 - player.y);
      const key = `${p.x},${p.y}`;
      if (range >= SPAWN_MIN && range <= SPAWN_MAX && cell?.tile === 'floor' && !cell.object && !cell.exitMarker && !cell.complexExit &&
          !cell.feature && !cell.door && !occupied.has(key)) {
        const alignment = Math.cos(Math.atan2(p.y + .5 - player.y, p.x + .5 - player.x) - heading);
        if (alignment > .65 && I.lineClear(d, player, { x: p.x + .5, y: p.y + .5 }))
          pool.push({ ...p, score: alignment * 12 - Math.abs(range - 16) });
      }
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const next = { x: p.x + dx, y: p.y + dy }, key = `${next.x},${next.y}`;
        if (seen.has(key) || seen.size >= MAX_SEARCH || Math.hypot(next.x + .5 - player.x, next.y + .5 - player.y) > SPAWN_MAX + 2 ||
            !I.canTraverse(d, p, next)) continue;
        seen.add(key); queue.push(next);
      }
    }
    return pool.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  }
  function tick(d, p, roster, player, { now = Date.now(), consoleText = '', protectedNames = [] } = {}) {
    const travel = p?.travelDiscovery;
    if (!eligible(d) || !travel || !point(player)) return { changed: false, discoveries: [] };
    const wanted = itemNames(consoleText), protectedSet = new Set(protectedNames.map(norm));
    let changed = false;
    const finish = (waitReason, discoveries = []) => ({ changed, discoveries, waitReason });
    for (const [key, item] of Object.entries(travel.objects)) if (wanted && !wanted.has(key) && item.status !== 'exhausted') {
      item.status = 'exhausted'; changed = true;
    }
    if (travel.active?.objectKey && travel.objects[travel.active.objectKey]?.status === 'exhausted') {
      delete travel.active; resetPacing(travel);
    }
    if (!sample(travel, d, player, now)) return finish('not-moving');
    // A missed opportunity is not an exhausted encounter. Reuse only wholly unseen, unbound groups offscreen.
    for (const group of p.groups) {
      const records = group.members.map(name => p.actors[name]);
      if (group.discoveryState !== 'placed' || group.status !== 'unseen' || group.introPlayed ||
          records.some(a => !a || a.status !== 'present' || a.encounteredAt > 0 || protectedSet.has(norm(a.name)) ||
            a.name === p.questIntroduction?.speaker || !point(a.position) || distance(player, a.position) < ABANDON_RANGE)) continue;
      group.discoveryState = 'pending'; group.site = null;
      for (const record of records) { record.discoveryState = 'pending'; record.position = null; record.home = null; }
      if (travel.active?.groupId === group.id) { delete travel.active; resetPacing(travel); }
      changed = true;
    }
    // Discovery opportunities cannot overlap a nearby hostile encounter or an unresolved arrival.
    const danger = roster.some(a => a.type === 'monster' && a.discoveryState !== 'pending' && (a.hp ?? 1) > 0 &&
      I.state(a) !== 'Dead' && I.allegiance(a) === 'Hostile' && point({ x: a.mazeX, y: a.mazeY }) &&
      I.roomKey(a.mazeRoomKey) === p.geoKey && distance(player, { x: a.mazeX + .5, y: a.mazeY + .5 }) < 36);
    if (danger) { resetPacing(travel); return finish('nearby-hostile'); }
    if (travel.active && distance(player, travel.active) < ABANDON_RANGE) return finish('active-opportunity');
    if (travel.active) { delete travel.active; resetPacing(travel); changed = true; return finish('left-opportunity'); }
    if (travel.movingMs < MIN_MOVING_MS || (travel.distance < travel.nextDistance &&
        !(travel.movingMs >= QUIET_MOVING_MS && travel.walkedDistance >= 24 && travel.excursion >= 8))) return finish('insufficient-travel');
    const groups = p.groups.filter(g => g.discoveryState === 'pending' && g.status === 'unseen' && !g.introPlayed &&
      g.members.length <= 4 && g.members.every(name => p.actors[name]?.status === 'present' &&
        (p.actors[name].hp ?? 1) > 0 && !protectedSet.has(norm(name))));
    const objects = Object.entries(travel.objects).filter(([key, item]) => item.status === 'pending' &&
      wanted?.has(key) && !protectedSet.has(key));
    const kinds = travel.nextKind === 'people' ? ['people', 'object'] : ['object', 'people'];
    const kind = kinds.find(value => value === 'people' ? groups.length : objects.length);
    if (!kind) return finish('no-pending-content');
    const occupied = new Set(roster.filter(a => Number.isFinite(a.mazeX) && Number.isFinite(a.mazeY)).map(a => `${a.mazeX},${a.mazeY}`));
    for (const item of d.sceneObjects || []) if (point(item)) occupied.add(`${item.x},${item.y}`);
    const pool = candidates(d, player, travel.heading || 0, occupied);
    let site, group, spaces, objectKey;
    if (kind === 'people') {
      const rank = g => p.actors[g.members[0]]?.allegiance === travel.nextAllegiance ? 0 : 1;
      group = groups.sort((a, b) => rank(a) - rank(b) || I.hash(a.id) - I.hash(b.id))[0];
      for (const candidate of pool.slice(0, 48)) {
        spaces = [candidate];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const next = { x: candidate.x + dx, y: candidate.y + dy }, cell = d.cells[`${next.x},${next.y}`];
          if (!occupied.has(`${next.x},${next.y}`) && cell?.tile === 'floor' && !cell.feature && !cell.object &&
              !cell.exitMarker && !cell.complexExit && I.canTraverse(d, candidate, next)) spaces.push(next);
        }
        if (spaces.length >= group.members.length) { site = candidate; break; }
      }
    } else site = pool[0];
    if (!site) return finish('no-safe-visible-site');
    const id = `${p.geoKey}:travel:${++travel.sequence}`;
    if (group) {
      group.discoveryState = 'placed'; group.site = { x: site.x, y: site.y };
      group.members.forEach((name, i) => {
        const record = p.actors[name];
        record.position = record.home = { x: spaces[i].x, y: spaces[i].y };
        record.discoveryState = 'placed'; record.discoveryRevision = travel.sequence;
      });
      I.attach(roster, p);
      travel.nextAllegiance = p.actors[group.members[0]]?.allegiance === 'Hostile' ? 'Neutral' : 'Hostile';
    } else {
      const selected = objects[I.hash(id) % objects.length], item = selected[1]; objectKey = selected[0];
      Object.assign(item, { status: 'placed', x: site.x, y: site.y });
    }
    const bearing = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][(Math.round(Math.atan2(site.y - player.y, site.x - player.x) / (Math.PI / 4)) + 8) % 8];
    travel.active = { x: site.x + .5, y: site.y + .5, kind, groupId: group?.id, objectKey };
    travel.nextKind = kind === 'people' ? 'object' : 'people'; travel.nextDistance = nextDistance(id);
    resetPacing(travel); changed = true;
    return finish('placed', [{ id, kind, groupId: group?.id, x: site.x, y: site.y,
      text: `${kind === 'people' ? 'Figures are moving through the wastes' : 'Something glints on the ground'} ahead (${bearing}).` }]);
  }
  function release(p, groupId) {
    if (p?.travelDiscovery?.active?.groupId === groupId) {
      delete p.travelDiscovery.active; resetPacing(p.travelDiscovery);
    }
  }
  function objects(items, population) {
    const placements = population?.travelDiscovery?.objects;
    if (!placements) return items;
    return (items || []).flatMap(item => {
      const placement = placements[norm(item.name)];
      if (placement?.status === 'pending' || placement?.status === 'exhausted') return [];
      return [placement?.status === 'placed' ? { ...item, x: placement.x, y: placement.y } : item];
    });
  }
  return { eligible, setup, tick, release, objects, candidates, MAX_SEARCH, QUIET_MOVING_MS, SPAWN_MIN, SPAWN_MAX };
});
