(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dungeonInhabitants'));
  else root.CampaignMemory = factory(root.DungeonInhabitants);
})(typeof window === 'object' ? window : globalThis, function(Inhabitants) {
  'use strict';
  const VERSION = 1, MAX_TEXT = 1400, MAX_RECORDS = 8192, MAX_CONTEXT = 4800;
  const stop = new Set('a an and are as at be been but by can could did do does for from had has have how i if in is it its me my of on or our say so that the their them there these they this to us was we were what when where which who will with would you your'.split(' '));
  const clusters = ['promise vow oath pledge', 'missing vanished lost disappearance', 'key seal lock unlock',
    'puzzle riddle mechanism sequence', 'defeat kill slain dead killed', 'deliver return give handed',
    'search investigate inspect examine', 'gate door entrance', 'clue hint inscription rune', 'help assist protect rescue'];
  const synonyms = new Map();
  const inflections = new Map();
  for (const family of ['promise promised promises promising', 'vow vowed vows', 'kill killed kills killing',
    'defeat defeated defeats defeating', 'search searched searches searching', 'investigate investigated investigating',
    'deliver delivered delivering delivery', 'unlock unlocked unlocking', 'key keys', 'clue clues', 'rune runes',
    'gate gates', 'door doors', 'puzzle puzzles']) {
    const [root, ...forms] = family.split(' '); forms.forEach(form => inflections.set(form, root));
  }
  const clean = (value, max = MAX_TEXT) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const key = value => clean(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  function tokens(value) {
    return (key(value).match(/[\p{L}\p{N}]+/gu) || []).filter(word => word.length > 1 && !stop.has(word))
      .map(word => inflections.get(word) || word);
  }
  for (const cluster of clusters) for (const word of cluster.split(' ')) synonyms.set(word, cluster.split(' '));
  function roomKey(value) {
    if (typeof value !== 'string') return null;
    const plain = value.trim(), labelled = plain.match(/^X:\s*(-?\d+),\s*Y:\s*(-?\d+),\s*Z:\s*(-?\d+)$/i);
    const parts = labelled ? labelled.slice(1) : /^-?\d+,-?\d+,-?\d+$/.test(plain) ? plain.split(',') : null;
    return parts?.map(Number).every(Number.isSafeInteger) ? parts.map(Number).join(',') : null;
  }
  const names = values => [...new Set((Array.isArray(values) ? values : []).map(value => clean(value, 100)).filter(Boolean))].slice(0, 32);
  function hash(value) {
    let n = 2166136261;
    for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
    return (n >>> 0).toString(16);
  }
  function normalize(raw, runId) {
    if (!raw || raw.runId !== runId || !clean(runId, 100) || !roomKey(raw.roomKey) || !clean(raw.text)) return null;
    const record = { runId, roomKey: roomKey(raw.roomKey), roomName: clean(raw.roomName, 100), text: clean(raw.text),
      kind: ['biography', 'dialogue', 'player-input', 'room-history', 'activity', 'puzzle', 'quest'].includes(raw.kind) ? raw.kind : 'room-history',
      authority: ['background', 'statement', 'reported', 'adjudicated', 'state'].includes(raw.authority) ? raw.authority : 'reported',
      source: clean(raw.source, 80) || 'room-history', actors: names(raw.actors), witnesses: names(raw.witnesses),
      speaker: clean(raw.speaker, 100), turn: Number.isSafeInteger(raw.turn) && raw.turn >= 0 ? raw.turn : 0,
      at: Number.isFinite(raw.at) && raw.at >= 0 ? raw.at : 0, taskBinding: clean(raw.taskBinding, 160),
      evidenceIds: names(raw.evidenceIds).slice(0, 8) };
    if (raw.profile && typeof raw.profile === 'object') record.profile = {
      personality: clean(raw.profile.personality, 220), voice: clean(raw.profile.voice, 140),
      history: clean(raw.profile.history, 600), motivation: clean(raw.profile.motivation, 180) };
    record.id = clean(raw.id, 160) || `memory-${hash(JSON.stringify(record))}`;
    return record;
  }
  function chunks(value) {
    const text = clean(value, 24000), result = [];
    let remaining = text;
    while (remaining && result.length < 32) {
      let end = Math.min(MAX_TEXT, remaining.length);
      if (end < remaining.length) {
        const boundary = [...remaining.slice(0, end).matchAll(/[.!?](?:["']?)(?:\s|$)|\n\s*\n/g)].at(-1);
        if (boundary && boundary.index > end / 2) end = boundary.index + boundary[0].length;
      }
      result.push(remaining.slice(0, end).trim()); remaining = remaining.slice(end).trimStart();
    }
    return result.filter(Boolean);
  }
  const unwrap = value => clean(value, 24000).replace(/^\$\.(?:user|assistant)\s*`([\s\S]*)`$/, '$1');
  function canReplace(previous, record) {
    return !previous || JSON.stringify(previous) !== JSON.stringify(record) &&
      (!['background', 'adjudicated', 'state'].includes(previous.authority) || ['background', 'adjudicated', 'state'].includes(record.authority));
  }
  function historyRecords(row, context) {
    if (!row || row.runId && row.runId !== context.runId || !row.runId && context.allowLegacy === false ||
        row.conversationId && row.conversationId !== context.conversationId) return [];
    const geo = roomKey(row.geoKey || context.roomKey || clean(row.gameConsole, 100000).match(/^Coordinates:[ \t]*(.*)$/m)?.[1]);
    if (!geo && row.kind !== 'ambient-dialogue') return [];
    const roomName = row.roomName || clean(row.gameConsole, 100000).match(/^Room Name:[ \t]*(.*)$/m)?.[1];
    const pc = clean(row.gameConsole, 100000).match(/^PC:[ \t]*(?:\r?\n[ \t]*)?([^\r\n]+)/m)?.[1]?.trim();
    const base = { runId: context.runId, roomKey: geo, roomName, authority: 'reported', source: 'indexeddb-room-history',
      actors: pc ? [pc] : [], witnesses: pc ? [pc] : [], at: row.at || 0, turn: row.turn || 0 };
    const identity = `${context.conversationId || ''}:${row.id ?? hash(unwrap(row.prompt) + unwrap(row.response))}`;
    const records = [];
    if (row.kind === 'ambient-dialogue') {
      for (const line of (Array.isArray(row.dialogue) ? row.dialogue : []).slice(-6)) {
        if (line.runId && line.runId !== context.runId) continue;
        const lineGeo = roomKey(line.geoKey) || geo, speech = clean(line.speech);
        const attributed = speech.match(/^([^:\r\n]{1,100}):\s*"([\s\S]*)"$/);
        const speaker = clean(line.speaker || attributed?.[1], 100), text = clean(line.line || attributed?.[2] || speech);
        if (!lineGeo || !text || !speaker) continue;
        records.push({ ...base, roomKey: lineGeo, roomName: lineGeo === geo ? roomName : '', kind: 'dialogue',
          id: `ambient:${hash(context.conversationId || '')}:${hash(lineGeo + speaker + text)}`, speaker,
          actors: [speaker], witnesses: [...new Set([pc, speaker].filter(Boolean))], text, at: line.at || row.at || 0 });
      }
      return records;
    }
    for (const [kind, text] of [['player-input', unwrap(row.prompt)], ['room-history', unwrap(row.response) || row.roomHistory]]) {
      // Never index recursive personalNarrative, system prompts, sheets, item JSON or cached alternatives.
      for (const [i, excerpt] of chunks(text).entries()) {
        if (/^(?:Current Game Information|Updated Game Information|PC:|NPCs in Party:)/i.test(excerpt)) continue;
        records.push({ ...base, id: `history:${identity}:${kind}:${i}`, kind, text: excerpt });
      }
    }
    if (Inhabitants && row.gameConsole) {
      const cast = [...Inhabitants.parseSheets(row.gameConsole, 'NPCs in Party'), ...Inhabitants.parseSheets(row.gameConsole)].map(actor => actor.name);
      for (const speech of Inhabitants.extractAttributedSpeech(unwrap(row.response), cast)) {
        for (const [i, text] of chunks(speech.line).entries()) records.push({ ...base,
          id: `history:${identity}:speech:${hash(speech.speaker)}:${i}`, kind: 'dialogue', speaker: speech.speaker,
          actors: [speech.speaker], witnesses: [...new Set([pc, speech.speaker].filter(Boolean))], text });
      }
    }
    return records;
  }
  function grams(word) {
    const result = new Set();
    for (let i = 0; i + 2 < word.length; i++) result.add(word.slice(i, i + 3));
    return result;
  }
  function createIndex(runId, initial = [], maxRecords = MAX_RECORDS) {
    const records = new Map(), postings = new Map(), frequencies = new Map(), gramTerms = new Map();
    let totalLength = 0;
    const cap = Math.max(1, Math.min(MAX_RECORDS, maxRecords));
    function remove(id) {
      const previous = records.get(id), terms = frequencies.get(id);
      if (!previous) return;
      totalLength -= [...terms.values()].reduce((sum, count) => sum + count, 0);
      for (const term of terms.keys()) {
        const hits = postings.get(term); hits.delete(id);
        if (hits.size) continue;
        postings.delete(term);
        for (const gram of grams(term)) {
          const words = gramTerms.get(gram); words?.delete(term);
          if (!words?.size) gramTerms.delete(gram);
        }
      }
      records.delete(id); frequencies.delete(id);
    }
    function add(raw) {
      const record = normalize(raw, runId);
      if (!record) return null;
      const previous = records.get(record.id);
      // Restored client prose cannot overwrite server-committed evidence.
      if (!canReplace(previous, record)) return null;
      remove(record.id);
      const terms = new Map();
      for (const word of tokens([record.text, record.roomName, record.kind, record.speaker, ...record.actors].join(' '))) {
        terms.set(word, (terms.get(word) || 0) + 1);
      }
      records.set(record.id, record); frequencies.set(record.id, terms);
      totalLength += [...terms.values()].reduce((sum, count) => sum + count, 0);
      for (const term of terms.keys()) {
        if (!postings.has(term)) {
          postings.set(term, new Set());
          for (const gram of grams(term)) {
            if (!gramTerms.has(gram)) gramTerms.set(gram, new Set());
            gramTerms.get(gram).add(term);
          }
        }
        postings.get(term).add(record.id);
      }
      if (records.size > cap) remove(records.keys().next().value);
      return structuredClone(record);
    }
    function search(query, options = {}) {
      const words = [...new Set(tokens(clean(query, 1200)))].slice(0, 48), expanded = new Map(words.map(word => [word, 1]));
      for (const word of words) {
        for (const synonym of synonyms.get(word) || []) if (!expanded.has(synonym)) expanded.set(synonym, .3);
        if (postings.has(word) || word.length < 5) continue;
        const candidates = new Map();
        for (const gram of grams(word)) for (const term of gramTerms.get(gram) || []) {
          if (candidates.size >= 128 && !candidates.has(term)) continue;
          candidates.set(term, (candidates.get(term) || 0) + 1);
        }
        for (const [term, shared] of candidates) if (Math.abs(term.length - word.length) <= 2 && shared / Math.max(1, grams(word).size) >= .6) {
          if (!expanded.has(term)) expanded.set(term, .35);
        }
      }
      const hits = new Set();
      for (const term of expanded.keys()) for (const id of postings.get(term) || []) hits.add(id);
      const actors = names(options.actors).map(key), owner = key(options.owner), room = roomKey(options.roomKey);
      if (!words.length && room) for (const row of records.values()) if (row.roomKey === room) hits.add(row.id);
      const scored = [], average = totalLength / Math.max(1, records.size), phrase = key(query);
      for (const id of hits) {
        const row = records.get(id);
        if (options.excludeKinds?.includes(row.kind)) continue;
        if (options.excludeCurrentInput && row.kind === 'player-input' && row.turn === options.turn && key(row.text) === key(query)) continue;
        if (owner && !row.witnesses.some(name => key(name) === owner) && key(row.speaker) !== owner) continue;
        if (options.roomOnly && row.roomKey !== room || options.verifiedOnly && !['adjudicated', 'state'].includes(row.authority)) continue;
        const terms = frequencies.get(id), length = [...terms.values()].reduce((sum, count) => sum + count, 0);
        let score = 0;
        for (const [term, weight] of expanded) {
          const count = terms.get(term) || 0, df = postings.get(term)?.size || 0;
          if (count) score += weight * Math.log(1 + (records.size - df + .5) / (df + .5)) * count * 2.2 /
            (count + 1.2 * (.25 + .75 * length / Math.max(1, average)));
        }
        if (phrase.length > 3 && key(row.text).includes(phrase)) score += 3;
        if (row.roomKey === room) score += .6;
        if (row.actors.some(name => actors.includes(key(name))) || actors.includes(key(row.speaker))) score += .5;
        if (['adjudicated', 'state'].includes(row.authority)) score += .25;
        score += .15 / (1 + Math.max(0, (options.turn || 0) - row.turn));
        scored.push({ ...row, score: Math.round(score * 1000) / 1000 });
      }
      scored.sort((a, b) => b.score - a.score || b.turn - a.turn || b.at - a.at || a.id.localeCompare(b.id));
      const limit = Math.max(0, Math.min(12, options.limit ?? 6)), budget = Math.max(0, Math.min(MAX_CONTEXT, options.maxChars ?? MAX_CONTEXT));
      const result = []; let size = 2;
      for (const row of scored) {
        const bytes = JSON.stringify(row).length + (result.length ? 1 : 0);
        if (size + bytes > budget) continue;
        result.push(structuredClone(row)); size += bytes;
        if (result.length >= limit) break;
      }
      return limit ? result : [];
    }
    function recent(options = {}) {
      const owner = key(options.owner), room = roomKey(options.roomKey);
      const rows = [...records.values()].filter(row =>
        (!owner || row.witnesses.some(name => key(name) === owner) || key(row.speaker) === owner) &&
        (!options.roomOnly || row.roomKey === room) && !options.excludeKinds?.includes(row.kind) &&
        (!options.verifiedOnly || ['adjudicated', 'state'].includes(row.authority)));
      rows.sort((a, b) => b.turn - a.turn || b.at - a.at || b.id.localeCompare(a.id));
      const result = [], limit = Math.max(0, Math.min(12, options.limit ?? 4));
      const budget = Math.max(0, Math.min(MAX_CONTEXT, options.maxChars ?? MAX_CONTEXT));
      let size = 2;
      for (const row of rows) {
        if (result.length >= limit) break;
        const bytes = JSON.stringify(row).length + (result.length ? 1 : 0);
        if (size + bytes > budget) continue;
        result.push(structuredClone(row)); size += bytes;
      }
      return result;
    }
    for (const record of initial) add(record);
    return { runId, add, search, recent, get: id => records.has(id) ? structuredClone(records.get(id)) : null,
      all: () => [...records.values()].map(record => structuredClone(record)), size: () => records.size };
  }
  return { VERSION, MAX_TEXT, MAX_RECORDS, MAX_CONTEXT, clean, roomKey, normalize, canReplace, chunks, historyRecords, createIndex, hash };
});
