(function(root){
  'use strict';
  const key='holodek-ended-run-menu';let menuRun=null,returningRun=null;
  function active(){return !!menuRun&&menuRun===root.dungeonRunId&&!!root._gameOver;}
  function menuText(){
    const homebrew=root.holodekHomebrewActive?.()??root.HolodekFlags?.HOMEBREW_ACTIVE;
    return 'Start Menu:\n\n'+(homebrew?'3) Create a new character in this world.':
      '1) Play as Mortacia, goddess of death.\n2) Play as Suzerain, knight of Atinus.\n3) Create a character and party.')+
      (root.HolodekFlags?.CAMPAIGN_BUILDER?'\n4) Campaign Builder: design a new world.':'')+
      '\n\nTo restore a saved adventure, use Menu > Save / Load Game. The previous adventure has ended.';
  }
  function returnToMenu(runId){
    if(!root._gameOver||runId!==root.dungeonRunId)return false;
    if(active()||returningRun===runId)return true;
    // A fresh page clears transient party/creation state, not saved adventures or the ended server run.
    try{
      root.sessionStorage.setItem(key,runId);
      root.localStorage.setItem('conversationId',root.crypto.randomUUID());
    }catch(error){
      try{root.sessionStorage.removeItem(key);}catch{}
      throw Error('Could not open a fresh start menu: '+error.message);
    }
    returningRun=runId;root.location.reload();return true;
  }
  function restore(data){
    if(!data.gameOver||data.runId!==root.dungeonRunId)return false;
    let saved;try{saved=root.sessionStorage.getItem(key);}catch{return false;}
    if(saved!==data.runId)return false;
    root.gamePaused=true;root._deathSceneActive=false;
    if(menuRun!==data.runId){
      menuRun=data.runId;root.displayMessage?.(menuText());
      root.document.getElementById('chatuserinput')?.focus();
    }
    return true;
  }
  function allowCommand({command='',creating=false,completed=false}={}){
    if(!active())return false;
    const options=root.HolodekFlags?.CAMPAIGN_BUILDER?/^(?:start|[1-4])$/i:/^(?:start|[1-3])$/i;
    if(completed||creating||options.test(command.trim()))return true;
    root.displayMessage?.(menuText());return false;
  }
  function beginRun(runId){if(menuRun&&menuRun!==runId)menuRun=null;if(returningRun&&returningRun!==runId)returningRun=null;}
  root.GameOverStartUi={returnToMenu,restore,active,allowCommand,beginRun};
})(window);
