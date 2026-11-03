(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./cityEstablishments') : root.CityEstablishments,
    typeof module === 'object' && module.exports ? require('./economyRules') : root.EconomyRules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LandmarkCatalog = api;
})(typeof window === 'undefined' ? globalThis : window, function(establishments, economy) {
  'use strict';
  const cache = new WeakMap(), prefixes = ['Ashen', 'Whispering', 'Sundered', 'Bonewhite', 'Veiled', 'Cinder', 'Forgotten', 'Silent'];
  function hash(text) { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function catalog(d) {
    if (!d) return [];
    const buildings = d.cityBlocks?.buildings;
    const stamp = `${d._geometryStamp || ''}:${d.sceneLandmarks?.length || 0}:${d.sceneGeography?.features?.length || 0}:${d.sceneExteriors?.buildings?.length || 0}:${buildings?.length || 0}:${d.cityBlocks?.streaming?.revision || 0}`;
    if (cache.get(d)?.stamp === stamp && cache.get(d).buildings === buildings) return cache.get(d).markers;
    const markers = [];
    function add(source, p, kind, name, major = false) {
      if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return;
      const id = `${source}:${p.x},${p.y}`;
      const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 90) :
        `${prefixes[hash(`${d.geoKey}:${id}`) % prefixes.length]} ${kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`;
      markers.push({ id, x: p.x + .5, y: p.y + .5, kind, label, major,
        glyph: /mountain|ridge|cliff/.test(kind) ? '^' : /canyon|river/.test(kind) ? '~' : /tower|temple|building/.test(kind) ? 'T' : '*', color: '#e2c27f' });
    }
    for (const [i, b] of (d.sceneExteriors?.buildings || []).slice(0, 6).entries()) add(`building-${i}`, b.doorway, 'building', b.targetName, true);
    for (const [i, f] of (d.sceneGeography?.features || []).slice(0, 8).entries()) add(`geography-${i}`, f.approach || f.center, f.role || 'mountain', f.name || f.label, true);
    for (const [i, lm] of (d.sceneLandmarks || []).slice(0, 64).entries()) {
      if (/altar|shrine|tower|ruin|gate|fort|keep|tomb|obelisk|arch|pediment|cave|spring|waterfall|bridge|statue|monolith/i.test(lm.type || ''))
        add(`landmark-${i}`, lm, lm.type, lm.name || lm.label, /tower|ruin|fort|keep|cave|bridge|pediment|monolith/i.test(lm.type));
    }
    let recognized = 0;
    for (const marker of markers) marker.knownOnArrival = marker.major && recognized++ < 2;
    const result = markers.slice(0, 48);
    if (!d.cityFloorContext && !economy?.isStarterRoom(d.geoKey,d)) for (const b of (buildings || []).slice(0, 750)) {
      const notice = establishments?.serviceNotice(b);
      if (!notice) continue;
      const p = b.doors?.find(p => Number.isFinite(p.x) && Number.isFinite(p.y)) ||
        { x: b.left + Math.floor(b.width / 2), y: b.top };
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : 'Service Building';
      result.push({ id: `city-service:${b.id}`, x: p.x + .5, y: p.y + .5, kind: 'service-building',
        label: `${name} - ${notice}`, name, notice, glyph: notice==='Work Inquiries Inside'?'W':'S', color: '#e2c27f', major: false, knownOnArrival: false });
    }
    cache.set(d, { stamp, buildings, markers: result }); return result;
  }
  return { catalog };
});
