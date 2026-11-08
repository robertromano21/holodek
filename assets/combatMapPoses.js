(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(root,require('./characterMotion3d'));
  else root.CombatMapPoses=factory(root,null);
})(typeof window==='object'?window:globalThis,function(root,motion){
  'use strict';
  const attacks=new Map(),clock=()=>root.performance?.now?.()??Date.now();
  const api=()=>motion||root.CharacterMotion3D;
  function actor(name){return(root.combatCharacters||[]).find(a=>a.name===name);}
  function cue(name,target,now=clock()){
    if(!name)return false;
    attacks.set(name,{at:now,target});
    if(attacks.size>256)attacks.delete(attacks.keys().next().value);
    return true;
  }
  function observe(line,names,now=clock()){
    // The same ordered names and combat grammar as the shared 3D action system.
    const who=(names||[]).filter(Boolean);if(!who.length)return false;
    if(/is killed by|is slain|falls before/i.test(line))return who[1]?cue(who[1],who[0],now):false;
    if(/\bhits\b.*\bfor \d+|critical|\bmisses\b|\battacks\b|\bswings\b|\blunges\b|\bcasts?\b/i.test(line))return cue(who[0],who[1],now);
    return false;
  }
  function frameFor(character,now=clock()){
    const event=attacks.get(character?.name);if(!event)return null;
    let elapsed=now-event.at;if(elapsed<0)return null;
    const timing=api()?.timingFor?.('attack')||[230,70,150,190];
    for(let i=0;i<timing.length;i++){if(elapsed<timing[i])return 'attack'+i;elapsed-=timing[i];}
    attacks.delete(character.name);return null;
  }
  function facingFlip(character,angle=0,now=clock()){
    if(!frameFor(character,now))return null;
    const target=actor(attacks.get(character.name)?.target);if(!target)return null;
    const x=a=>Number.isFinite(a.mazeX)?a.mazeX:a.x,y=a=>Number.isFinite(a.mazeY)?a.mazeY:a.y;
    const dx=x(target)-x(character),dy=y(target)-y(character),screenX=dx*Math.cos(angle)-dy*Math.sin(angle);
    if(!Number.isFinite(screenX)||Math.abs(screenX)<.001)return null;
    // Keep the approved profile and weapon hand, rather than substituting front-facing art.
    return /^(mortacia|suzerain)\b/i.test(character.name)?screenX>0:screenX<0;
  }
  function tick(scene,now=clock()){
    let changed=false;const signatures=scene._combatPoseSignatures||(scene._combatPoseSignatures=new Map());
    for(const character of root.combatCharacters||[]){
      const frame=frameFor(character,now),old=signatures.get(character.name)||null;
      if(frame!==old){changed=true;signatures.set(character.name,frame);}
      if(frame||old)root.applyCombatVisualFrame?.(scene.characters?.[character.name]?.sprite,character);
    }
    if(changed)scene.redrawCombatRT?.();
  }
  function clear(){attacks.clear();}
  return{cue,observe,frameFor,facingFlip,tick,clear};
});
