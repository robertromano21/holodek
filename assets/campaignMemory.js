(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dungeonInhabitants'));
  else root.CampaignMemory = factory(root.DungeonInhabitants);
})(typeof window === 'object' ? window : globalThis, function(Inhabitants) {
  'use strict';
  const VERSION = 2, MAX_TEXT = 1400, MAX_RECORDS = 8192, MAX_CONTEXT = 4800;
  const stop = new Set('a about an and are as at be been but by can could did do does for from had has have how i if in is it its me my of on or our say so that the their them there these they this to us was we were what when where which who will with would you your'.split(' '));
  const clusters = ['promise vow oath pledge', 'missing vanished lost disappearance', 'key seal lock unlock',
    'puzzle riddle mechanism sequence', 'defeat kill slain dead killed', 'deliver return give handed',
    'search investigate inspect examine', 'gate door entrance', 'clue hint inscription rune', 'help assist protect rescue',
    'depart departure leave leaving left farewell stay stayed remain remained behind guardian',
    'book tome chronicle codex journal', 'keep keeping kept tend tending care protect watch guard guardian'];
  const queryStop = new Set('ask asked tell told say said party remember remembered recall recollect please'.split(' '));
  const synonyms = new Map();
  const inflections = new Map();
  for (const family of ['promise promised promises promising', 'vow vowed vows', 'kill killed kills killing',
    'defeat defeated defeats defeating', 'search searched searches searching', 'investigate investigated investigating',
    'deliver delivered delivering delivery', 'unlock unlocked unlocking', 'key keys', 'clue clues', 'rune runes',
    'gate gates', 'door doors', 'puzzle puzzles', 'remain remains remained remaining', 'stay stays stayed staying',
    'leave left leaving leaves', 'depart departed departing departure', 'companion companions']) {
    const [root, ...forms] = family.split(' '); forms.forEach(form => inflections.set(form, root));
  }
  const clean = (value, max = MAX_TEXT) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const key = value => clean(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  function tokens(value) {
    return (key(value).match(/[\p{L}\p{N}]+/gu) || []).filter(word => word.length > 1 && !stop.has(word))
      .map(word => inflections.get(word) || word);
  }
  for (const cluster of clusters) {
    const words = [...new Set(cluster.split(' ').map(word => inflections.get(word) || word))];
    for (const word of words) synonyms.set(word, words);
  }
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
    if (clean(raw.topic, 240)) record.topic = clean(raw.topic, 240);
    if (raw.excerpted === true) record.excerpted = true;
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
    if (previous && record.excerpted && !previous.excerpted) return false;
    return !previous || JSON.stringify(previous) !== JSON.stringify(record) &&
      (!['background', 'adjudicated', 'state'].includes(previous.authority) || ['background', 'adjudicated', 'state'].includes(record.authority));
  }
  function linkEpisodes(initial) {
    const inputs = new Map();
    const episode = row => `${row.runId}:${row.roomKey}:${row.turn}`;
    for (const row of initial) if (row.kind === 'player-input' && row.source === 'player-command' && row.authority === 'statement') {
      const id = episode(row);
      if (!inputs.has(id)) inputs.set(id, []);
      inputs.get(id).push(row);
    }
    for (const rows of inputs.values()) rows.sort((a, b) => a.at - b.at);
    return initial.map(row => {
      if (!(row.kind === 'room-history' && row.source === 'room-turn-narrative' ||
          row.kind === 'dialogue' && row.authority === 'statement')) return row;
      const candidates = inputs.get(episode(row)) || [];
      const input = candidates.filter(input => input.at <= row.at).at(-1) ||
        (candidates.length === 1 && (!row.at || !candidates[0].at) ? candidates[0] : null);
      if (!input) return row;
      // Repair legacy public scenes using the audience recorded at that exchange, never today's party.
      return { ...row, topic: row.topic || clean(input.text, 240),
        witnesses: row.kind === 'room-history' ? names([...row.witnesses, ...input.witnesses]) : row.witnesses };
    });
  }
  function historyRecords(row, context) {
    if (!row || row.runId && row.runId !== context.runId || !row.runId && context.allowLegacy === false ||
        row.conversationId && row.conversationId !== context.conversationId) return [];
    const geo = roomKey(row.geoKey || context.roomKey || clean(row.gameConsole, 100000).match(/^Coordinates:[ \t]*(.*)$/m)?.[1]);
    if (!geo && row.kind !== 'ambient-dialogue') return [];
    const roomName = row.roomName || clean(row.gameConsole, 100000).match(/^Room Name:[ \t]*(.*)$/m)?.[1];
    const pc = clean(row.gameConsole, 100000).match(/^PC:[ \t]*(?:\r?\n[ \t]*)?([^\r\n]+)/m)?.[1]?.trim();
    const base = { runId: context.runId, roomKey: geo, roomName, authority: 'reported', source: 'indexeddb-room-history',
      actors: pc ? [pc] : [], witnesses: names([pc, ...(row.witnesses || [])].filter(Boolean)), at: row.at || 0,
      turn: row.turn ?? Number(clean(row.gameConsole, 100000).match(/^Turns:[ \t]*(\d+)/m)?.[1] || 0) };
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
        records.push({ ...base, id: `history:${identity}:${kind}:${i}`, kind, text: excerpt,
          ...(kind === 'room-history' ? { topic: clean(unwrap(row.prompt), 240) } : {}) });
      }
    }
    if (Inhabitants && row.gameConsole) {
      const cast = [...Inhabitants.parseSheets(row.gameConsole, 'NPCs in Party'), ...Inhabitants.parseSheets(row.gameConsole)].map(actor => actor.name);
      for (const speech of Inhabitants.extractAttributedSpeech(unwrap(row.response), cast)) {
        for (const [i, text] of chunks(speech.line).entries()) records.push({ ...base,
          id: `history:${identity}:speech:${hash(speech.speaker)}:${i}`, kind: 'dialogue', speaker: speech.speaker,
          actors: [speech.speaker], witnesses: names([...base.witnesses, speech.speaker]), text,
          topic: clean(unwrap(row.prompt), 240) });
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
      for (const word of tokens([record.text, record.topic, record.roomName, record.kind, record.speaker, ...record.actors].join(' '))) {
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
      const focused = clean(query, 1200).replace(/\b(?:look(?:ing)? after|tak(?:e|ing) care of)\b/gi, 'keep protect');
      const words = [...new Set(tokens(focused).filter(word => !queryStop.has(word)))].slice(0, 48);
      const expanded = new Map(words.map(word => [word, 1]));
      for (const word of words) {
        for (const synonym of synonyms.get(word) || []) if (!expanded.has(synonym)) expanded.set(synonym, .5);
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
      const semantic = options.semantic instanceof Map ? options.semantic : new Map();
      for (const [id, similarity] of semantic) if (Number.isFinite(similarity) && similarity >= .25 && records.has(id)) hits.add(id);
      const actors = names(options.actors).map(key), owner = key(options.owner), room = roomKey(options.roomKey);
      if (!words.length && room) for (const row of records.values()) if (row.roomKey === room) hits.add(row.id);
      const scored = [], average = totalLength / Math.max(1, records.size), phrase = key(query);
      for (const id of hits) {
        const row = records.get(id);
        if (options.excludeKinds?.includes(row.kind)) continue;
        if (options.excludeCurrentInput && row.kind === 'player-input' && row.turn === options.turn && key(row.text) === key(query)) continue;
        if (owner && !row.witnesses.some(name => key(name) === owner) && key(row.speaker) !== owner) continue;
        if (options.qualified && !row.witnesses.some(name => actors.includes(key(name))) && !actors.includes(key(row.speaker))) continue;
        if (options.roomOnly && row.roomKey !== room || options.verifiedOnly && !['adjudicated', 'state'].includes(row.authority)) continue;
        const terms = frequencies.get(id), length = [...terms.values()].reduce((sum, count) => sum + count, 0);
        let score = 0;
        for (const [term, weight] of expanded) {
          const count = terms.get(term) || 0, df = postings.get(term)?.size || 0;
          if (count) score += weight * Math.log(1 + (records.size - df + .5) / (df + .5)) * count * 2.2 /
            (count + 1.2 * (.25 + .75 * length / Math.max(1, average)));
        }
        // Questions identify an episode; its answer is normally more useful than the old question alone.
        if (row.kind === 'player-input') score *= .55;
        if (row.kind === 'room-history') score *= 1.25;
        if (phrase.length > 3 && key(row.text).includes(phrase)) score += 3;
        if (row.roomKey === room) score += .6;
        if (row.actors.some(name => actors.includes(key(name))) || actors.includes(key(row.speaker))) score += .5;
        if (['adjudicated', 'state'].includes(row.authority)) score += .25;
        score += .15 / (1 + Math.max(0, (options.turn || 0) - row.turn));
        scored.push({ ...row, score: Math.round(score * 1000) / 1000 });
      }
      scored.sort((a, b) => b.score - a.score || b.turn - a.turn || b.at - a.at || a.id.localeCompare(b.id));
      if (semantic.size) {
        const semanticOrder = [...scored].filter(row => semantic.has(row.id)).sort((a, b) => semantic.get(b.id) - semantic.get(a.id));
        const semanticRanks = new Map(semanticOrder.map((row, i) => [row.id, i + 1]));
        const lexical = scored.filter(row => [...expanded.keys()].some(term => frequencies.get(row.id).has(term)));
        const anchor = lexical[0]?.id;
        const lexicalRanks = new Map(lexical.map((row, i) => [row.id, i + 1]));
        for (const row of scored) {
          const lexicalRank = lexicalRanks.get(row.id), semanticRank = semanticRanks.get(row.id);
          const exactName = [...row.actors, row.speaker].some(name => key(name).length > 3 && phrase.includes(key(name)));
          row.keywordScore = row.score;
          row.score = 1000 * ((lexicalRank ? 1 / (60 + lexicalRank) : 0) +
            (semanticRank ? 1 / (60 + semanticRank) : 0) + (exactName ? 1 / 61 : 0));
          if (semanticRank) row.semanticSimilarity = semantic.get(row.id);
        }
        // Semantic search is additive: it cannot displace the strongest existing keyword result.
        scored.sort((a, b) => Number(b.id === anchor) - Number(a.id === anchor) || b.score - a.score || b.turn - a.turn || a.id.localeCompare(b.id));
      }
      const limit = Math.max(0, Math.min(12, options.limit ?? 6)), budget = Math.max(0, Math.min(MAX_CONTEXT, options.maxChars ?? MAX_CONTEXT));
      const result = []; let size = 2;
      for (const row of scored) {
        const available = budget - size - (result.length ? 1 : 0);
        const selected = excerptRecord(row, expanded, Math.min(options.maxText ?? MAX_TEXT, available), available);
        if (!selected) continue;
        const bytes = JSON.stringify(selected).length + (result.length ? 1 : 0);
        if (size + bytes > budget) continue;
        result.push(selected); size += bytes;
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
    for (const record of linkEpisodes(initial.map(raw => normalize(raw, runId)).filter(Boolean))) add(record);
    return { runId, add, search, recent, get: id => records.has(id) ? structuredClone(records.get(id)) : null,
      all: () => [...records.values()].map(record => structuredClone(record)), size: () => records.size };
  }
  function excerptRecord(row, terms, maxText, budget) {
    if (row.text.length <= maxText && JSON.stringify(row).length <= budget) return structuredClone(row);
    const result = { ...row, text: '', excerpted: true };
    const available = Math.min(maxText, budget - JSON.stringify(result).length);
    if (available < 80) return null;
    const sentences = row.text.match(/[^.!?\n]+(?:[.!?]+["'\u201d\u2019]*|$)/gu) || [row.text];
    const ranked = sentences.map((text, i) => ({ text: text.trim(), i,
      score: tokens(text).reduce((sum, term) => sum + (terms.get(term) || 0), 0) }));
    ranked.sort((a, b) => b.score - a.score || a.i - b.i);
    const selected = []; let size = 0;
    for (const sentence of ranked) {
      if (size + sentence.text.length + (selected.length ? 1 : 0) > available) continue;
      selected.push(sentence); size += sentence.text.length + (selected.length > 1 ? 1 : 0);
    }
    if (!selected.length) return null;
    result.text = selected.sort((a, b) => a.i - b.i).map(sentence => sentence.text).join(' ');
    return JSON.stringify(result).length <= budget ? result : null;
  }
  return { VERSION, MAX_TEXT, MAX_RECORDS, MAX_CONTEXT, clean, roomKey, normalize, canReplace, chunks, historyRecords, createIndex, hash };
});
