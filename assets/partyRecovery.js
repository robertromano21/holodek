(function(root) {
  'use strict';
  const I = typeof module !== 'undefined' && module.exports ? require('./dungeonInhabitants') : root.DungeonInhabitants;
  function restorePartyHealth(consoleText) {
    let value = String(consoleText || '');
    const restored = [];
    for (const [label, type, end] of [['PC', 'pc', 'NPCs in Party|Monsters in Room'], ['NPCs in Party', 'npc', 'Monsters in Room']]) {
      const pattern = new RegExp(`(^${label}:)([\\s\\S]*?)(?=^(?:${end}):|(?![\\s\\S]))`, 'm');
      value = value.replace(pattern, (_, header, block) => {
        const raw = block.split(/\r?\n/), eol = block.includes('\r\n') ? '\r\n' : '\n';
        for (const actor of I.parseBlocks(block, type)) {
          if (!(actor.maxHp > 0)) continue;
          let index = actor.magicIndex - 6;
          while (index >= 0 && !/^\s*HP:/.test(raw[index])) index--;
          if (index < 0) continue;
          raw[index] = raw[index].replace(/(HP:\s*)-?\d+/, (_, prefix) => prefix + actor.maxHp);
          if (actor.stateIndex !== null) raw[actor.stateIndex] = raw[actor.stateIndex].replace(/State:.*/, `State: ${type === 'pc' ? 'Alive' : 'Friendly'}`);
          restored.push({ name: actor.name, type, hp: actor.maxHp, previousHp: actor.hp });
        }
        return header + raw.join(eol);
      });
    }
    return { consoleText: value, restored };
  }
  async function reviveDungeonParty() {
    if (!I || typeof db === 'undefined' || !db) throw Error('Open the running game before restoring the party.');
    if (root.actionDiceState?.active || root._combatCommandPending) throw Error('Finish the pending combat action first.');
    const conversationId = localStorage.getItem('conversationId');
    const history = await root.getPromptsAndResponsesForConversation(conversationId);
    const latest = history.filter(row => row.gameConsole).at(-1);
    if (!latest) throw Error('No saved Game Console was found.');
    const repair = restorePartyHealth(latest.gameConsole);
    if (!repair.restored.length) throw Error('No valid PC or companion sheets were found.');
    const response = await fetch('/updateState7', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedGameConsole: repair.consoleText }) });
    if (!response.ok) throw Error(`Health repair was rejected (HTTP ${response.status}).`);
    await new Promise((resolve, reject) => {
      const tx = db.transaction('conversation', 'readwrite');
      tx.objectStore('conversation').put({ ...latest, gameConsole: repair.consoleText });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    const roster = Array.isArray(root.combatCharacters) ? root.combatCharacters : [];
    const pcEntry = roster.find(a => a.type === 'pc');
    for (const row of repair.restored) {
      const source = row.type === 'pc' ? (typeof characters !== 'undefined' ? characters : []) : (typeof npcs !== 'undefined' ? npcs : []);
      const character = source.find(a => (a.Name || a.name) === row.name);
      if (character) { character.HP = row.hp; character.State = row.type === 'pc' ? 'Alive' : 'Friendly'; }
      let actor = roster.find(a => a.name === row.name);
      if (!actor) { actor = { name: row.name, type: row.type, x: pcEntry?.x, y: pcEntry?.y }; roster.push(actor); }
      actor.type = row.type; actor.hp = row.hp; actor.state = row.type === 'pc' ? 'Alive' : 'Friendly'; actor.allegiance = 'Friendly';
    }
    root.combatCharacters = roster; root.lastServerGameConsole = repair.consoleText;
    const pc = repair.consoleText.match(/PC:([\s\S]*?)(?=NPCs in Party:)/)?.[1]?.trim();
    const party = repair.consoleText.match(/NPCs in Party:([\s\S]*?)(?=Monsters in Room:)/)?.[1]?.trim() || 'None';
    if (root.latestUpdatedData) { root.latestUpdatedData = { ...root.latestUpdatedData, pc, npcs: party }; root.game?.scene?.getScene('MainScene')?.scene.restart(root.latestUpdatedData); }
    root.updatePartyInfoSource?.('pc', pc); root.updatePartyInfoSource?.('npcs', party);
    root.updateCombatScene?.(roster); root.renderPartyIconDock?.(); root.refreshPartyDungeonPresence?.(false); root.renderDungeonView?.();
    console.info('[PartyRecovery]', repair.restored);
    return repair.restored;
  }
  const api = { restorePartyHealth, reviveDungeonParty };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.PartyRecovery = api; root.reviveDungeonParty = reviveDungeonParty; }
})(typeof window === 'undefined' ? globalThis : window);
