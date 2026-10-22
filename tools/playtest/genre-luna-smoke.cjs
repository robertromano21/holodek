'use strict';
// Invoked only after the native permission dialog; no game state or service is changed.
if(process.env.HOLODEK_GENRE_SMOKE_APPROVED!=='1')throw Error('Run genre-luna-smoke.ps1 and approve the native dialog first.');
for(const flag of ['GENRE_EXPANSION','ARCHITECTURE_EXPANSION','CITY_COMPLETE','CITY_SITES','TRADE_ROUTES'])process.env['HOLODEK_'+flag]='1';
process.env.HOLODEK_DEFAULT_MODEL='gpt-6-luna';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');process.chdir(root);
const Models=require('../../retort/gameModels'),Setting=require('../../retort/settingLayer'),Runtime=require('../../retort/gameRetort');
const Transport=require('../../retort/modelTransport'),Level=require('../../retort/levelSpec'),Builder=require('../../retort/campaignBuilder');
const client=Models.getClient();if(!client)throw Error('OpenAI key unavailable; no test calls made.');
Models.restore('gpt-6-luna');let calls=0;
const sent=[];
const wrapped={...client,chat:{completions:{create:(body,...args)=>{
  assert.equal(body.model,'gpt-6-luna');if(++calls>24)throw Error('Live test call limit reached.');
  sent.push({model:body.model,structured:!!body.tools||!!body.response_format});return client.chat.completions.create(body,...args);
}}}};
const runtime=Runtime.createRuntime({models:Models,client:wrapped,log:()=>{},timeoutMs:90000});
const runner=work=>runtime.run(runtime.retort(async $=>work($)));
const output=path.join(root,'verification');fs.mkdirSync(output,{recursive:true});
async function main(){
  const results=[];
  for(const [genre,prompt]of [['western','A grounded frontier town with timber saloons, a rail depot and competing cattle ranches. No magic or gods.'],['sci-fi','A pressure-sealed orbital habitat with airlocks, fabrication bays, synthetic residents and a failing oxygen economy. No magic or gods.'],['underwater','An original undersea pressure-dome city with reef gardens, submersible docks and disputes over clean water. No imported mythology.']]){
    const bible=await Setting.generate(prompt,{runner,picked:[genre],worldSeed:'finish-'+genre});
    await Setting.withDraft(bible,async()=>{
      const master=await Setting.generateMaster(bible,prompt,{runner});Setting.setMaster(bible,master.text);
      Object.assign(bible,await Setting.generateRoster(bible,{runner}));
      assert.deepEqual(Builder.lintGenerated(bible),[]);
      const start=Setting.startRoomProfile(bible),map=require('../../retort/campaignMap').compose('luna-smoke',Setting.campaignPlan('smoke',bible));
      assert.deepEqual(Builder.lint({start,map}),[]);
      const messages=Level.buildMessages({roomName:start.name,description:start.description});
      messages.push({role:'user',content:`Include one modest, appropriate native structure using x_${genre}_utility, count 1, placement walls, assembly generic. Do not fill the room with giant buildings.`});
      const reply=await Models.withSnapshot(()=>Transport.complete(wrapped,{model:'gpt-6-luna',messages,response_format:{type:'json_object'}},{models:Models,client:wrapped,timeoutMs:90000}));
      const raw=JSON.parse(reply.choices[0].message.content);assert.deepEqual(Level.validate(raw),[]);
      const level=Level.normalize(raw);assert.ok(level.structures.some(s=>s.shape.startsWith('x_'+genre+'_')));
      const report={genre,name:bible.name,firstRoom:start,classes:bible.classes.map(c=>c.name),races:bible.races.map(r=>r.name),cities:map.cities.map(c=>c.name),structures:level.structures.map(s=>s.shape),model:'gpt-6-luna'};
      results.push(report);console.log(JSON.stringify(report));fs.writeFileSync(path.join(output,'luna-genre-smoke.json'),JSON.stringify({model:'gpt-6-luna',calls,sent,results},null,2));
    });
  }
  console.log(`PASS: ${results.length} live Luna world/roster/scene checks, ${calls} paid calls; no game save modified.`);
}
main().catch(e=>{console.error('FAIL: '+e.message);process.exitCode=1;});
