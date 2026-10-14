(function(root,factory) {
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WritingDiscovery=api;
})(typeof window==='object'?window:globalThis,function(root) {
  'use strict';
  function update(dungeon,targets) {
    if(root.gamePaused||root.actionDiceState?.active||root.GameCommandGate?.busy()||root._characterStartupPending||root._combatCommandPending||!root.dungeonRunId)return [];
    dungeon.writingDiscoveries ||= {version:1,ids:[]};
    const fresh=[];
    for(const target of targets) {
      const record=target.inscription;
      if(!target.enabled||!record?.questStoryId||!record.chapters?.[0]?.text||dungeon.writingDiscoveries.ids.includes(record.id))continue;
      const chunks=root.DungeonInhabitants?.splitSpeech(record.chapters[0].text,600,100)||record.chapters[0].text.match(/[\s\S]{1,600}/g);
      let received=false;
      for(const [part,text] of chunks.entries())if(root.DungeonActionNotices?.receive) {
        const accepted=root.DungeonActionNotices.receive({id:'writing:'+dungeon.geoKey+':'+record.id+':'+part,runId:root.dungeonRunId,geoKey:dungeon.geoKey,
          kind:'writing-discovered',title:record.title,message:text+(part===chunks.length-1?'\nClick the writing to read and respond.':'')});
        received ||= accepted!==false;
      }
      if(received){dungeon.writingDiscoveries.ids.push(record.id);fresh.push(record.id);}
    }
    if(fresh.length)root.persistDungeonObjectDiscoveries?.(dungeon);
    return fresh;
  }
  return {update};
});
