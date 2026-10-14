(function(root) {
  'use strict';
  let pending=false,serial=0,currentClose=null;
  const blocked=()=>pending||root.GameCommandGate?.busy()||root.gamePaused||root.actionDiceState?.active||root._combatCommandPending||root._characterStartupPending;
  function observer() {
    const ctx=root.getDungeonLifeContext?.();
    if(!ctx?.dungeon||!ctx.player)return null;
    return {runId:root.dungeonRunId,geoKey:ctx.dungeon.geoKey,player:ctx.player,
      actors:ctx.actors.map(a=>({name:a.name,mazeX:a.mazeX,mazeY:a.mazeY,mazePoint:a.mazePoint,discoveryRevision:a.discoveryRevision}))};
  }
  async function post(path,body) {
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'The quest scene is unavailable.');return result;
  }
  function notice(message) {
    root.DungeonActionNotices?.receive?.({id:'quest-error:'+Date.now(),runId:root.dungeonRunId,geoKey:root.currentDungeon?.geoKey,
      kind:'quest-scene',title:'Quest conversation',message});
  }
  async function open(actor,options={}) {
    if(blocked())return false;
    const context=observer();if(!context)return false;
    const token=++serial;pending=true;
    try {
      const result=await post('/quest-scenes/view',{...context,actor});
      if(token!==serial||context.runId!==root.dungeonRunId||context.geoKey!==root.currentDungeon?.geoKey)return false;
      currentClose?.();
      document.querySelectorAll('.popup-container').forEach(p=>p.remove());
      const scene=result.scene,popup=document.createElement('div');popup.className='popup-container quest-scene-actions';
      popup.setAttribute('role','dialog');popup.setAttribute('aria-label',scene.title);
      popup.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:17000;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto';
      const title=document.createElement('h3');title.textContent=scene.title;
      const text=document.createElement('p');text.textContent=scene.text;text.style.whiteSpace='pre-wrap';
      const goal=document.createElement('p');goal.textContent=scene.description;goal.style.cssText='font-size:.85em;color:#d3ad64';
      popup.append(title,text,goal);
      const buttons=[];
      for(const option of scene.options) {
        const button=document.createElement('button');button.className='popup-button';button.type='button';button.textContent=option.label;
        buttons.push(button);popup.appendChild(button);
        button.addEventListener('click',async()=>{
          if(blocked())return;
          if(option.action==='attack'&&document.getElementById('chatuserinput')?.value.trim()) {
            goal.textContent='Your command draft was preserved. Submit or clear it before attacking.';return;
          }
          pending=true;buttons.forEach(b=>b.disabled=true);
          try {
            const live=observer();if(!live||live.geoKey!==context.geoKey||live.runId!==context.runId)throw Error('That scene belongs to another room or game.');
            const event=await post('/quest-scenes/choose',{...live,storyId:scene.storyId,stageId:scene.stageId,revision:scene.revision,optionId:option.id});
            if(context.runId!==root.dungeonRunId||context.geoKey!==root.currentDungeon?.geoKey)return;
            close();
            if(event.command) {
              const input=document.getElementById('chatuserinput');
              if(input&&!input.value.trim()){input.value=event.command;root.chatbotprocessinput();}
            } else {
              await root.applyRealtimeCombatResult?.(event);
              pending=false;
              await open(null,{silent:true});
            }
          } catch(error) {goal.textContent=error.message;}
          finally {pending=false;buttons.forEach(b=>b.disabled=false);}
        });
      }
      const cancel=document.createElement('button');cancel.className='popup-button';cancel.type='button';cancel.textContent='Later';
      cancel.addEventListener('click',()=>{if(!pending){serial++;close();}});popup.appendChild(cancel);
      const escape=event=>{if(event.key==='Escape'&&!pending){serial++;close();}};
      function close(){popup.remove();document.removeEventListener?.('keydown',escape);if(currentClose===close)currentClose=null;}
      currentClose=close;
      document.addEventListener?.('keydown',escape);
      document.body.appendChild(popup);return true;
    } catch(error) {if(!options.silent)notice(error.message);return false;}
    finally {pending=false;}
  }
  function addAction(popup,name) {
    if(!popup||!root.getQuestSceneParticipants?.().includes(name))return null;
    const button=document.createElement('button');button.type='button';button.className='popup-button';button.textContent='Quest Conversation';
    button.addEventListener('click',()=>open(name));popup.appendChild(button);return button;
  }
  root.QuestSceneUi={open,addAction};
})(window);
