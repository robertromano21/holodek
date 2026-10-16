(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(root);
  else root.CombatCharacterUi=factory(root);
})(typeof window==='object'?window:globalThis,function(root){
  'use strict';
  function confirmAttackCommand(input, actors = root.combatCharacters || []) {
    const name = /^\s*attack\s+(.+?)\s*$/i.exec(String(input))?.[1]?.toLowerCase();
    if (!name) return true;
    const matches = actors.filter(a => String(a.name || '').toLowerCase() === name);
    const candidate = matches.length ? matches : actors.filter(a => String(a.name || '').toLowerCase().startsWith(name));
    if (candidate.length !== 1 || candidate[0].type !== 'npc') return true;
    return !!root.confirm?.(`Attack Party Member?\n\nAttack ${candidate[0].name}? They will leave your party and become hostile.\n\nAre you sure?`);
  }
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
  function pickScene(scene,x,y){
    let targets=scene.combatActorHitTargets||[];
    if(!scene._lastDungeonDraw?.dungeon)targets=Object.entries(scene.characters||{}).filter(([,v])=>v.sprite?.visible).map(([name,v])=>({
      character:(root.combatCharacters||[]).find(c=>c.name===name),texKey:v.sprite.texture?.key,frameName:v.sprite.frame?.name,
      flipped:!!v.sprite.flipX,x:v.sprite.x-v.sprite.displayWidth/2,y:v.sprite.y-v.sprite.displayHeight/2,size:v.sprite.displayWidth}));
    return pick(targets,x,y,(t,u,v)=>{
      if(!t.texKey||!scene.textures?.getPixelAlpha)return 255;
      const f=scene.textures.getFrame(t.texKey,t.frameName),w=f?.cutWidth||96,h=f?.cutHeight||96;
      return scene.textures.getPixelAlpha(Math.min(w-1,Math.floor(u*w)),Math.min(h-1,Math.floor(v*h)),t.texKey,t.frameName);
    });
  }
  function openConsoleTarget(target){
    if(root.actionDiceState?.active?.kind!=='combat')return false;
    const link=target?.closest?.('#phaser-container .clickable-pc, #phaser-container .clickable-npc, #phaser-container .clickable-monster');
    if(!link)return false;
    const name=link.getAttribute('data-pc')||link.getAttribute('data-npc')||link.getAttribute('data-monster');
    if(name)open({name});
    return true;
  }
  function open(selected){
    const actor=(root.combatCharacters||[]).find(a=>a.name===selected.name);
    if(!actor||actor.discoveryState==='pending'||root.isDungeonActorPresent&&!root.isDungeonActorPresent(actor))return false;
    if(root.actionDiceState?.active?.kind==='combat'){
      document.querySelectorAll('.popup-container').forEach(p=>p.remove());
      const sheet=document.getElementById('party-popup');if(sheet)sheet.style.display='none';
      const popup=document.createElement('section');popup.className='popup-container combat-character-actions combat-target-actions';
      popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Combat actions for '+actor.name);
      const heading=document.createElement('p');heading.textContent='What would you like to do with '+actor.name+'?';popup.appendChild(heading);
      root.CombatTurnUi?.addCharacterActions?.(popup,actor);
      const cancel=document.createElement('button');cancel.type='button';cancel.className='popup-button';cancel.textContent='Cancel';
      cancel.addEventListener('click',()=>popup.remove());popup.appendChild(cancel);document.body.appendChild(popup);
      positionActions(popup);return true;
    }
    if(typeof root.openCombatCharacterSheet!=='function')return false;
    const type=actor.type;
    document.querySelectorAll('.popup-container').forEach(p=>p.remove());
    root.openCombatCharacterSheet(actor);
    if(actor.type==='pc'){
      const sheet=document.getElementById('party-popup');
      if(!root.CombatTurnUi?.addCharacterActions?.(sheet,actor))root.CombatLifeUi?.addAction(sheet,actor.name);
      return true;
    }
    const popup=document.createElement('div');popup.className='popup-container combat-character-actions';
    popup.style.cssText='position:static;transform:none;width:calc(100% - 16px);margin:8px;padding:8px';
    const text=document.createElement('p');text.textContent='What would you like to do with '+actor.name+'?';popup.appendChild(text);
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
    const combatActions=root.CombatTurnUi?.addCharacterActions?.(popup,actor);
    if(!combatActions) {
      if(actor.type==='npc') { button('Remove','remove '+actor.name+' from party'); button('Attack','attack '+actor.name); }
      else{
        if (actor.recruitable !== false && (root.PantheonCharacters?.canRecruit(actor) ?? true)) button('Add to Party','add '+actor.name+' to party');
        button('Attack','attack '+actor.name);
        const give=document.createElement('button');give.className='popup-button';give.textContent='Give Item';
        give.addEventListener('click',()=>root.ItemGiveUi?.open(actor.name));popup.appendChild(give);
      }
      root.QuestSceneUi?.addAction(popup,actor.name);
      root.CommerceUi?.addAction(popup,actor.name);
      root.CombatLifeUi?.addAction(popup,actor.name);
    }
    button('Cancel');document.getElementById('party-popup')?.appendChild(popup);root.centerPartySheet?.();
    return true;
  }
  function positionActions(popup){
    const rect=popup.getBoundingClientRect();
    const zoom=Number(root.getComputedStyle?.(document.body)?.zoom)||(popup.offsetWidth?rect.width/popup.offsetWidth:1);
    const consolePanel=document.getElementById('phaser-popup'),consoleBox=consolePanel?.getBoundingClientRect();
    const visible=consoleBox?.width>0&&consoleBox.height>0&&root.getComputedStyle?.(consolePanel)?.visibility!=='hidden';
    const width=Math.min(200*zoom,root.innerWidth-24);
    const left=Math.max(12,Math.min(visible?consoleBox.right-width:root.innerWidth-width-12,root.innerWidth-width-(visible?0:12)));
    const top=Math.max(12,Math.min(visible?consoleBox.bottom+5*zoom:72,root.innerHeight-100));
    Object.assign(popup.style,{left:left/zoom+'px',top:top/zoom+'px',width:width/zoom+'px',maxHeight:(root.innerHeight-top-12)/zoom+'px'});
  }
  root.addEventListener?.('resize',()=>document.querySelectorAll('.combat-target-actions').forEach(positionActions));
  return{pick,pickScene,open,openConsoleTarget,confirmAttackCommand};
});
