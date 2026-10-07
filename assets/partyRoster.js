(function(root) {
  function parseSheets(text, type) {
    const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const result = [];
    let start = 0;
    for (let end = 0; end < lines.length; end++) {
      // Magic terminates the existing sheet format; blank lines and labels are optional.
      if (!/^Magic:\s*-?\d+/i.test(lines[end])) continue;
      const block = lines.slice(start, end + 1);
      start = end + 1;
      while (/^(?:PC|NPCs|NPCs in Party):?$/i.test(block[0] || '')) block.shift();
      const name = (block[0] || '').replace(/^Name:\s*/i, '').trim();
      if (!name || /^none$/i.test(name)) continue;
      const entry = { name, Name: name, type, sheet: block.join('\n') };
      ['Sex', 'Race', 'Class'].forEach((key, index) => {
        entry[key] = (block[index + 1] || '').replace(new RegExp(`^${key}:\\s*`, 'i'), '');
      });
      block.forEach(line => {
        const match = /^(Level|AC|XP|HP|MaxHP|Attack|Damage|Armor|Magic):\s*(-?\d+)/i.exec(line);
        if (match) entry[match[1].toLowerCase()] = Number(match[2]);
      });
      result.push(entry);
    }
    return result;
  }

  function partyRoster(pcText, npcText, characters = []) {
    if (pcText === undefined && npcText === undefined) {
      return characters.filter(c => c && ['pc', 'npc'].includes(c.type));
    }
    const lookup = new Map(characters.map(c => [String(c.name || c.Name).toLowerCase(), c]));
    const seen = new Set();
    return [...parseSheets(pcText, 'pc'), ...parseSheets(npcText, 'npc')].filter(c => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(c => ({ ...lookup.get(c.name.toLowerCase()), ...c }));
  }
  const api = { parseSheets, partyRoster };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PartyRoster = api;
})(typeof window === 'undefined' ? globalThis : window);
