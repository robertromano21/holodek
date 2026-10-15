'use strict';
// Score externally supplied human/ASR transcripts. Does not invent recognition results.
const fs=require('node:fs');
const words=s=>String(s).toLowerCase().replace(/[\u2018\u2019]/g,"'").match(/[a-z]+(?:'[a-z]+)?/g)||[];
function score(reference,hypothesis,targets=[]){
  const a=words(reference),b=words(hypothesis),rows=Array.from({length:a.length+1},()=>new Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++)rows[i][0]=i;
  for(let j=0;j<=b.length;j++)rows[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)rows[i][j]=Math.min(rows[i-1][j]+1,rows[i][j-1]+1,rows[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  const errors=rows[a.length][b.length];
  return{referenceWords:a.length,errors,wer:a.length?errors/a.length:null,
    targetHits:Object.fromEntries(targets.map(t=>[t,b.includes(words(t)[0])])),
    caveat:'Word matching is not naturalness. Proper names require a separate phonetic/listener assessment.'};
}
function evaluate(manifest,transcripts){
  const results=[],missing=[],pairedFiles=new Set();
  for(const c of manifest.characters)if(Object.values(c.variants).every(v=>typeof transcripts[v.file]==='string'))
    Object.values(c.variants).forEach(v=>pairedFiles.add(v.file));
  for(const c of manifest.characters)for(const [variant,v]of Object.entries(c.variants)){
    if(typeof transcripts[v.file]!=='string'){missing.push(v.file);continue;}
    results.push({character:c.name,line:c.line,variant,file:v.file,...score(c.text||manifest.text,transcripts[v.file],c.targets||[])});
  }
  const summary={};
  for(const r of results){if(!pairedFiles.has(r.file))continue;const g=summary[r.variant]||={files:0,errors:0,words:0};g.files++;g.errors+=r.errors;g.words+=r.referenceWords;}
  for(const g of Object.values(summary))g.wer=g.words?g.errors/g.words:null;
  return{summary,pairedOnly:true,results,missing,complete:missing.length===0,
    comparison:'Compare only matched character/line triplets. Missing transcripts are not scored as failures or successes.'};
}
if(require.main===module){
  try{
    if(!process.argv[2]||!process.argv[3])throw Error('Usage: node tools/score-sid-voices.cjs <manifest.json> <transcripts.json>; transcripts maps WAV filename to heard text.');
    console.log(JSON.stringify(evaluate(JSON.parse(fs.readFileSync(process.argv[2],'utf8')),JSON.parse(fs.readFileSync(process.argv[3],'utf8'))),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={words,score,evaluate};
