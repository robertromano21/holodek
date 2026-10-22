'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const I=require('../assets/dungeonInhabitants');
const names=['Boro Nettlecap','Veyra of the Quiet Bell'];
const payload={spoken:[],replies:[{name:names[0],line:'Future one.'},{name:names[0],line:'Future two.'},{name:'Unknown',line:'Reject me.'}],exchanges:[]};
test('actual Unicode packaging stays out of narration and groups future replies',()=>{
 const r=I.extractDialogue('The wind settles. ⟦CHARACTER_DIALOGUE⟧'+JSON.stringify(payload)+'⟦/CHARACTER_DIALOGUE⟧ Veyra of the Quiet Bell says, "We remember."',names);
 assert.ok(!r.content.includes('CHARACTER_DIALOGUE'));assert.ok(!r.content.includes('Future one'));
 assert.ok(r.content.includes('The wind settles.'));assert.ok(r.content.includes('We remember.'));
 assert.deepEqual(r.replies,[{speaker:names[0],lines:['Future one.','Future two.']}]);
 assert.ok(r.dialogue.every(row=>row.speaker===names[1]));
 assert.ok(r.dialogueProtocolWarnings.includes('unicode-marker'));
});
for(const [open,close] of [['[[CHARACTER_DIALOGUE]]','[[/CHARACTER_DIALOGUE]]'],['[CHARACTER_DIALOGUE]','[/CHARACTER_DIALOGUE]'],['⟦CHARACTER_DIALOGUE⟧','[[/CHARACTER_DIALOGUE]]']])test('strips packaging '+open,()=>{
 const r=I.extractDialogue('Before. '+open+JSON.stringify({replies:[{speaker:names[0],lines:['Cached.']} ]})+close+' After.',names);
 assert.equal(r.content,'Before.   After.');assert.equal(r.replies[0].lines[0],'Cached.');assert.deepEqual(r.dialogue,[]);
});
test('missing closing marker preserves prose after balanced JSON',()=>{
 const r=I.extractDialogue('Before. [[CHARACTER_DIALOGUE]]'+JSON.stringify(payload)+' After.',names);
 assert.ok(r.content.endsWith('After.'));assert.ok(!r.content.includes('Future one.'));
});
test('malformed and truncated metadata never appears to the player',()=>{
 for(const raw of ['Story. ⟦CHARACTER_DIALOGUE⟧{"replies":','Story. [[CHARACTER_DIALOGUE]]bad json[[/CHARACTER_DIALOGUE]] After.']){
 const r=I.extractDialogue(raw,names);assert.ok(!r.content.includes('replies'));assert.ok(!r.content.includes('bad json'));assert.deepEqual(r.replies,[]);
 }
});
test('quoted braces and closing tokens inside JSON do not end the block',()=>{
 const line='Quote " and } and [[/CHARACTER_DIALOGUE]] stay cached.';
 const r=I.extractDialogue('Before. [[CHARACTER_DIALOGUE]]'+JSON.stringify({replies:[{speaker:names[0],lines:[line]}]})+'[[/CHARACTER_DIALOGUE]] After.',names);
 assert.ok(r.content.endsWith('After.'));assert.equal(r.replies[0].lines[0],line);
});
test('ordinary Unicode prose and unmarked JSON remain untouched',()=>{
 const raw='An inscription reads ⟦remember⟧. {"name":"stone"}';assert.equal(I.extractDialogue(raw,names).content,raw);
});
test('canonical packaging has no warning or alias change',()=>{
 const r=I.extractDialogue('Story. [[CHARACTER_DIALOGUE]]'+JSON.stringify({spoken:[],replies:[{speaker:names[0],lines:['One.']}]})+'[[/CHARACTER_DIALOGUE]]',names);
 assert.equal(r.content,'Story.');assert.equal(r.dialogueProtocolWarnings,undefined);
});
