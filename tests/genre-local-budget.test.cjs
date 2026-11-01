'use strict';
process.env.HOLODEK_GENRE_EXPANSION = '1';
process.env.HOLODEK_ARCHITECTURE_EXPANSION = '1';
const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../retort/settingLayer'), L = require('../retort/levelSpec'), C = require('../retort/generationContracts');
const Models = require('../retort/gameModels'), Host = require('../retort/pcModelHost'), Runtime = require('../retort/gameRetort');
const Budget = require('../retort/holodekBudget');
function value(schema) {
  if (schema.enum) return schema.enum[0];
  const type = [].concat(schema.type || []).find(t => t !== 'null');
  if (type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([k,v]) => [k,value(v)]));
  if (type === 'array') return Array.from({length:schema.minItems ?? 1}, () => value(schema.items));
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return schema.minimum ?? 0;
  return schema.pattern?.includes('#') ? '#668899' : 'Authored scenery';
}
for (const genres of [['sci-fi'],['western','cosmic-horror'],['underwater']]) test(`${genres.join('/')} approved level contract fits actual 4096-token local work orders`, async () => {
  const prior = Models.current().id;
  const bible = S.localBible(genres.join(' '));
  bible.genres = genres; bible.genreWeights = genres.map(genre => ({genre,weight:1/genres.length}));
  S.setActive(bible); Models.restore('holodek-1');
  let calls = 0;
  const host = Host.createHost({fetchImpl:async (_url, init) => {
    calls++; const body = JSON.parse(init.body);
    assert.ok(Budget.tally(body.messages, [{response_format:body.response_format}]).total <= Budget.CEILING);
    const answer = value(body.response_format.json_schema.schema);
    return {ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(answer)}}]})};
  }});
  const app = Runtime.createRuntime({models:{...Models,getLocalClient:()=>Host.modelClient(host)},log(){}});
  try {
    const result = await app.run(app.retort($ => C.request($, {component:'genre-level-budget',parameters:L.parametersFor(),
      localWork:{brief:'Author scenery from the approved asset choices for a connected enclosed working room. Keep navigation and puzzle space clear.',
        arrays:{structures:{min:1,max:2,batch:1},decals:{min:0,max:1,batch:1},scatter:{min:0,max:1,batch:1}}},
      validate:raw=>{assert.deepEqual(L.validate(raw),[]);return L.normalize(raw);}})), null, {shouldSaveToLog:false});
    assert.ok(result.value,result.error?.message);assert.ok(calls>3);
    assert.ok(result.value.structures.every(s=>require('../retort/genreAssetPolicy').catalog().shapes.includes(s.shape)));
  } finally { Models.restore(prior); S.setActive(null); }
});
