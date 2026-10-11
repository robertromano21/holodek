(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LandmarkCatalog = api;
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  const cache = new WeakMap(), prefixes = ['Ashen', 'Whispering', 'Sundered', 'Bonewhite', 'Veiled', 'Cinder', 'Forgotten', 'Silent'];
  function hash(text) { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
  function catalog(d) {
    if (!d) return [];
    const stamp = `${d._geometryStamp || ''}:${d.sceneLandmarks?.length || 0}:${d.sceneGeography?.features?.length || 0}:${d.sceneExteriors?.buildings?.length || 0}`;
    if (cache.get(d)?.stamp === stamp) return cache.get(d).markers;
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
    const result = markers.slice(0, 48); cache.set(d, { stamp, markers: result }); return result;
  }
  return { catalog };
});
