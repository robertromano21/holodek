(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(root);
  else root.CombatCharacterUi=factory(root);
})(typeof window==='object'?window:globalThis,function(root){
  'use strict';
  function pick(targets,x,y,sampleAlpha){
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    for(let i=targets.length-1;i>=0;i--){
      const t=targets[i];if(!t.character||!(t.size>0)||x<t.x||y<t.y||x>=t.x+t.size||y>=t.y+t.size)continue;
      const u=(x-t.x)/t.size,v=(y-t.y)/t.size;
      if(sampleAlpha&&sampleAlpha(t,t.flipped?1-u:u,v)===0)continue;
      return t.character;
    }
    return null;
  }
  function open(selected){
    const actor=(root.combatCharacters||[]).find(a=>a.name===selected.name);
    if(!actor||actor.discoveryState==='pending'||root.isDungeonActorPresent&&!root.isDungeonActorPresent(actor))return false;
    if(typeof root.openCombatCharacterSheet!=='function')return false;
    const type=actor.type;
    document.querySelectorAll('.popup-container').forEach(p=>p.remove());
    root.openCombatCharacterSheet(actor);
    if(actor.type==='pc')return true;
    const popup=document.createElement('div');popup.className='popup-container combat-character-actions';
    popup.style.cssText='position:static;transform:none;width:calc(100% - 16px);margin:8px;padding:8px';
    const text=document.createElement('p');text.textContent=actor.type==='npc'?'Remove '+actor.name+' from the party?':'What would you like to do with '+actor.name+'?';popup.appendChild(text);
    const close=()=>{popup.remove();root.centerPartySheet?.();};
    const button=(label,command)=>{
      const b=document.createElement('button');b.className='popup-button';b.textContent=label;popup.appendChild(b);
      b.addEventListener('click',()=>{
        if(command){
          const current=(root.combatCharacters||[]).find(a=>a.name===actor.name&&a.type===type);
          const input=document.getElementById('chatuserinput');
          if(!current||current.discoveryState==='pending'||root.isDungeonActorPresent&&!root.isDungeonActorPresent(current)||!input||input.value.trim()||root.GameCommandGate?.busy()||root._characterStartupPending||root._combatCommandPending||root.actionDiceState?.active||root.gamePaused)return;
          input.value=command;root.chatbotprocessinput();
        }
        close();
      });
    };
    if(actor.type==='npc')button('Remove','remove '+actor.name+' from party');
    else{
      button('Add to Party','add '+actor.name+' to party');button('Attack','attack '+actor.name);
      const give=document.createElement('button');give.className='popup-button';give.textContent='Give Item';
      give.addEventListener('click',()=>root.ItemGiveUi?.open(actor.name));popup.appendChild(give);
    }
    button('Cancel');document.getElementById('party-popup')?.appendChild(popup);root.centerPartySheet?.();
    return true;
  }
  return{pick,open};
});
