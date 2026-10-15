'use strict';
const {createHash}=require('node:crypto');
const rank=(seed,value)=>createHash('sha256').update(seed+'|'+value).digest().readUInt32LE();
const identity=row=>(row.song||row).composition?.acceptedPlan||(row.song||row).plan||row.song||row;
function brief(seed,spec,recent=[]){
  const history=recent.slice(-8).map(identity),last=history.at(-1),allowed={};
  for(const [field,pool]of Object.entries({leadPatch:spec.leadPatches,bassPatch:spec.bassPatches,arpPatch:spec.arpPatches})){
    const use=value=>history.reduce((n,p,i)=>n+(p[field]===value?i+1:0),0);
    const candidates=pool.filter(p=>p!==last?.[field]).sort((a,b)=>use(a)-use(b)||rank(seed,a)-rank(seed,b));
    allowed[field]=candidates.slice(0,3);
  }
  const shapes=[[8,8,4,8,8,4],[4,8,8,4,4],[8,4,8,4,4],[4,4,8,8,4],[8,8,8,4,8,4],
    [4,8,16,16,4,4],[8,16,16,4,8,8,4],[16,8,16,4,4,4],[4,16,16,8,8,4,8],
    [8,4,16,16,8,4,8],[16,16,8,8,4,8,4],[8,8,4,16,16,8,4]];
  const motifRhythms=shapes.filter(r=>!history.some(p=>JSON.stringify(r)===JSON.stringify(p.motifRhythm)))
    .sort((a,b)=>rank(seed,a.join(','))-rank(seed,b.join(','))).slice(0,3);
  return{allowed,startingRhythms:motifRhythms,avoidLastRecipe:last?{phraseForm:last.phraseForm,progression:last.progression,
    groove:last.performance?.groove,bassStyle:last.bassStyle,arpStyle:last.arpStyle}:null};
}
function check(plan,recent,allowed){
  if(!plan.performance)return;
  if(allowed)for(const [field,choices]of Object.entries(allowed))if(!choices.includes(plan[field]))
    throw Error(field+': this room rotates the palette; choose '+choices.join(', ')+'.');
  for(const old of recent.slice(-3).map(identity)){
    if(plan.leadPatch===old.leadPatch&&plan.bassPatch===old.bassPatch)
      throw Error('Recent lead/bass pair repeated. Change the foreground and/or bass timbre, not only the arpeggio.');
    const fields=['phraseForm','progression','contrastProgression','bassStyle','arpStyle','texture'];
    const same=fields.filter(k=>plan[k]===old[k]).length;
    if(same>=5&&plan.performance.groove===(old.performance?.groove||'straight'))
      throw Error('Recent arrangement recipe repeated. Change groove, harmonic route, phrase shape or accompaniment.');
    const a=plan.motifContour,b=old.motifContour;
    if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||JSON.stringify(plan.motifRhythm)!==JSON.stringify(old.motifRhythm))continue;
    const close=a.slice(1).filter((n,i)=>Math.abs((n-a[i])-(b[i+1]-b[i]))<=1).length;
    if(close>=a.length-2)throw Error('Recent melody is too close in rhythm and intervals. Compose a new cell, not tiny pitch edits.');
  }
}
module.exports={brief,check,identity};
