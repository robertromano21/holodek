(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LibraryBooks = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  // world1 LIBRARY_BOOKS: every bookshelf in a room exposes individually clickable books with their own hit boxes.
  // Shared by client (hover/click) and server (reach checks), so both agree on names and positions.
  const SHELVES = 4, PER_SHELF = 5, RUIN = /toppled|ruin|broken|burnt|charred|collapsed|fallen/i, VAST = /\b(library|archive|athenaeum|scriptorium|great hall of records)\b/i,
    SUBJECTS = ['Rites of the Dead', 'Chronicles', 'Law and Petitions', 'Star and Calendar', 'Herbals', 'Masonry and Craft', 'Bestiaries', 'Travels', 'Genealogies', 'Hymns', 'Letters', 'Maps and Roads'],
    ERAS = ['Founding', 'Old Kingdom', 'Long Siege', 'Ash Years', 'Present Age'], BOOKISH = /\b(book|tome|codex|ledger|journal|chronicle|scroll|spellbook|grimoire|manual|treatise|almanac|annals|psalter|bestiary|diary|letters|folio|volume|primer|gospel|testament|catechism|register)s?\b/i;
  const isBookName = name => BOOKISH.test(String(name || ''));
  const layouts = new WeakMap();
  function layoutCache(dungeon) {
    // Revisionless callers retain the original fresh-scan behavior.
    if (!dungeon || !dungeon._geometryStamp) return null;
    let entry = layouts.get(dungeon);
    if (!entry || entry.stamp !== dungeon._geometryStamp || entry.cells !== dungeon.cells ||
        entry.tiles !== dungeon.tiles || entry.landmarks !== dungeon.sceneLandmarks ||
        entry.name !== dungeon.roomName || entry.sourceName !== dungeon.sceneSpec?.source?.roomName ||
        entry.scale !== dungeon.libraryScale) {
      entry = { stamp: dungeon._geometryStamp, cells: dungeon.cells, tiles: dungeon.tiles,
        landmarks: dungeon.sceneLandmarks, name: dungeon.roomName,
        sourceName: dungeon.sceneSpec?.source?.roomName, scale: dungeon.libraryScale };
      layouts.set(dungeon, entry);
    }
    return entry;
  }
  function shelfCells(dungeon) {
    const cached = layoutCache(dungeon);
    if (cached?.shelves) return cached.shelves;
    const out = [], seen = new Set();
    const add = (x, y, label) => { const k = `${x},${y}`; if (seen.has(k)) return; seen.add(k); out.push({ x, y, key: k, label }); };
    for (const l of dungeon?.sceneLandmarks || []) if (/bookshel|bookcase/i.test(`${l.type} ${l.label}`)) add(l.x, l.y, l.label || 'bookshelf');
    for (const [k, c] of Object.entries(dungeon?.cells || {})) {
      const t = dungeon.tiles?.[c?.tile], spec = t?.spriteSpec || {};
      if (/bookshel|bookcase/i.test(`${t?.landmark?.type || ''} ${spec.type || ''} ${spec.voxelShape || ''} ${c.tile || ''}`)) { const [x, y] = k.split(',').map(Number); add(x, y, t?.landmark?.label || 'bookshelf'); }
    }
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    if (cached) cached.shelves = out;
    return out;
  }
  function facing(dungeon, x, y) {
    for (const [dx, dy, axis, sign] of [[0, 1, 'y', 1], [0, -1, 'y', -1], [1, 0, 'x', 1], [-1, 0, 'x', -1]]) if (dungeon.cells?.[`${x + dx},${y + dy}`]?.tile === 'floor') return { axis, sign };
    return { axis: 'y', sign: 1 };
  }
  // Scale by condition and place: ruins keep a few survivors; city libraries/archives are vast (generated lazily on click).
  function scale(dungeon, shelf) {
    if (RUIN.test(shelf.label)) return { kind: 'ruin', rows: SHELVES, per: PER_SHELF };
    const name = `${dungeon?.roomName || ''} ${dungeon?.sceneSpec?.source?.roomName || ''} ${dungeon?.libraryScale || ''}`;
    if (dungeon?.libraryScale === 'vast' || VAST.test(name)) return { kind: 'vast', rows: 6, per: 12 };
    return { kind: 'normal', rows: SHELVES, per: PER_SHELF };
  }
  const survives = (s, n) => ((s * 7 + n * 13) % 17) < 4; // ~1 in 4 slots still hold a tome on a ruined shelf
  function section(shelf, s) { const h = (shelf.x * 31 + shelf.y * 17 + s * 7) >>> 0; return { subject: SUBJECTS[h % SUBJECTS.length], era: ERAS[(h >> 3) % ERAS.length] }; }
  function sections(dungeon) { return shelfCells(dungeon).map((shelf, s) => ({ shelf: s + 1, shelfKey: shelf.key, label: shelf.label, ...section(shelf, s), scale: scale(dungeon, shelf).kind })); }
  function books(dungeon) {
    if (!dungeon) return [];
    const cached = layoutCache(dungeon);
    if (cached?.books) return cached.books;
    const list = [];
    shelfCells(dungeon).forEach((shelf, s) => {
      const sc = scale(dungeon, shelf), SH = sc.rows, PS = sc.per, sec = section(shelf, s);
      const cell = dungeon.cells[shelf.key] || {}, floor = cell.floorHeight || 0, height = Math.max(1.2, Math.min(2.2, cell.structureHeight ?? ((cell.ceilHeight ?? 2) - floor)));
      const face = facing(dungeon, shelf.x, shelf.y), w = .8 / PS, rowH = height / (SH + .4);
      for (let r = 0; r < SH; r++) for (let b = 0; b < PS; b++) {
        const n = r * PS + b + 1; if (sc.kind === 'ruin' && !survives(s, n)) continue;
        const along = .1 + b * w + w * .1, z = floor + .12 + r * rowH, bh = rowH * (.62 + ((s * 7 + n * 13) % 5) * .05);
        const front = face.sign > 0 ? .78 : .2;
        const position = face.axis === 'y' ? { x: shelf.x + along, y: shelf.y + front, z } : { x: shelf.x + front, y: shelf.y + along, z };
        const size = face.axis === 'y' ? { x: w * .8, y: .03, z: bh } : { x: .03, y: w * .8, z: bh };
        list.push({ id: `shelf${s + 1}_book${n}`, name: `tome ${n} of shelf ${s + 1}`, shelf: s + 1, shelfKey: shelf.key, row: r + 1, slot: b + 1, position, size, axis: face.axis, sign: face.sign, subject: sec.subject, era: sec.era, condition: sc.kind === 'ruin' ? 'damaged' : 'intact' });
      }
    });
    if (cached) cached.books = list;
    return list;
  }
  function find(dungeon, name) { const k = String(name || '').trim().toLowerCase(); return books(dungeon).find(b => b.name === k) || null; }
  // "search the catalog [for X]": matches section labels and already-generated titles; no model call.
  function searchCatalog(dungeon, query, cached = []) { const q = String(query || '').toLowerCase().replace(/^(for|about)\s+/, '').trim();
    const secs = sections(dungeon).filter(s => !q || `${s.subject} ${s.era}`.toLowerCase().includes(q) || q.split(/\s+/).some(w => w.length > 3 && `${s.subject} ${s.era}`.toLowerCase().includes(w)));
    const titles = cached.filter(b => !q || `${b.title} ${b.author} ${(b.contents || []).join(' ')}`.toLowerCase().includes(q)).slice(0, 12);
    return { query: q, sections: secs, titles, counts: { shelves: shelfCells(dungeon).length, books: books(dungeon).length } }; }
  return { books, find, shelfCells, sections, searchCatalog, scale, isBookName, SHELVES, PER_SHELF };
});
