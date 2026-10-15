'use strict';
const assert = require('node:assert/strict');
const C = require('../retort/campaignMemory'), S = require('../retort/memorySemantic').createService();
const store = require('../saveGames').createStore();
(async () => {
  const p = store.read(process.argv[2] || 1).payload, s = p.server;
  const state = { getDungeonRunId: () => p.runId, getCampaignMemory: () => s.campaignMemory,
    getRoomNameDatabase: () => s.roomNameDatabaseString,
    getUpdatedGameConsole: () => s.updatedGameConsole, getCombatCharactersString: () => s.combatCharactersString,
    getRoomDungeonForSimulation: () => s.roomDungeonDatabase[p.roomKey], getRoomPopulation: () => s.roomPopulations[p.roomKey] };
  const queries = process.argv.slice(3);
  if (!queries.length) queries.push('Who did we leave behind at the ruined temple?', 'Who is looking after the chronicle for us?');
  for (const query of queries) {
    await C.prepare(state, query, { semantic: S, waitMs: 30000 });
    let trace;
    const recalled = C.context(state, query, s.updatedGameConsole, null, { trace: value => trace = value });
    assert.ok(JSON.stringify(recalled).length <= require('../assets/campaignMemory').MAX_CONTEXT);
    console.log(JSON.stringify({ query, method: trace.method, chars: trace.chars,
      evidence: recalled.evidence.map(row => ({ id: row.id, turn: row.turn, text: row.text, witnesses: row.witnesses })),
      memories: recalled.memories, connections: recalled.connections }, null, 2));
  }
  console.log('Read-only verification complete. Live session and save files were not modified.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => S.close());
