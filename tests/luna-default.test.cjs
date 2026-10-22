'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = process.env.HOLODEK_LUNA_TEST_ROOT || path.resolve(__dirname, '..');
const filename = path.join(root, 'retort/gameModels.js');
const compiled = new Module(filename);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(fs.readFileSync(process.env.HOLODEK_LUNA_SOURCE || filename, 'utf8'), filename);
const Models = compiled.exports;
const client = {models:{list:async()=>({data:[{id:'gpt-6-luna'}]})}};
const create = () => Models.createModelService({clientFor:()=>client,localProbe:async()=>Models.catalog.filter(r=>r.local)});

test('Luna stays default even when both local models are installed', async () => {
  const m = create(); let probed = false;
  const current = await Models.chooseStartupDefault(m, {env:{},probe:async()=>{probed=true;return Models.catalog.filter(r=>r.local);},log:()=>{}});
  assert.equal(current.id,'gpt-6-luna'); assert.equal(probed,false);
  assert.doesNotMatch(Models.catalog.find(r=>r.id==='holodek-1').name,/default/i);
});

test('explicit selections and configured startup overrides still work', async () => {
  const m = create(); m.restore('gpt-oss-20b');
  assert.equal((await Models.chooseStartupDefault(m,{env:{},log:()=>{}})).id,'gpt-oss-20b');
  assert.equal((await Models.chooseStartupDefault(create(),{env:{HOLODEK_DEFAULT_MODEL:'holodek-1'},log:()=>{}})).id,'holodek-1');
});

test('generation routes requested legacy model names through Luna without calling Ollama', async () => {
  const Transport = require(path.join(root,'retort/modelTransport'));
  const m = create(); let body;
  const fake = {chat:{completions:{create:async value=>{body=value;return {choices:[{finish_reason:'stop',message:{content:'A timber-fronted saloon.'}}]};}}}};
  const service = {...m,getClient:()=>fake,getLocalClient:()=>{throw Error('Unexpected local model');}};
  await m.withSnapshot(()=>Transport.complete(fake,{model:'gpt-4.1-mini',messages:[{role:'user',content:'Describe the frontier street.'}]},{models:service}));
  assert.equal(body.model,'gpt-6-luna');
});

test('playtest launchers pin Luna and first-launch picker does not prefer a local model', () => {
  const sourceRoot=process.env.HOLODEK_LUNA_FILES || root;
  for(const file of ['run.ps1','run-visible.ps1','start-pm2.ps1'])assert.match(fs.readFileSync(path.join(sourceRoot,'tools/playtest',file),'utf8'),/HOLODEK_DEFAULT_MODEL = 'gpt-6-luna'/);
  const ui=fs.readFileSync(path.join(sourceRoot,'assets/modelSelectUi.js'),'utf8');
  assert.doesNotMatch(ui,/const gm =/);
  assert.match(ui,/const pick = ids.includes\('gpt-6-luna'\) \? 'gpt-6-luna' : null/);
  assert.match(ui,/rowsOf\(\).filter\(m=>m.id!=='holodek-1'\)/);
  assert.doesNotMatch(ui,/const pick =[^;]*(?:data.current.id|localStorage)/);
});
