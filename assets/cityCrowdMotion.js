(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.CityCrowdMotion=api;})(typeof window==='object'?window:globalThis,function(root){
  'use strict';
  const rooms=new WeakMap(),same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
  const hash=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
  function state(d,row){
    let rows=rooms.get(d);if(!rows){rows=new Map();rooms.set(d,rows);}
    let s=rows.get(row.id);if(!s){s={base:{...row.position},position:{...row.position},home:{...(row.home||row.position)},reset:row.motionReset||0,path:[],steps:0,nextAt:0};rows.set(row.id,s);}
    return s;
  }
  function reconcile(d,crowd){
    const rows=rooms.get(d);if(!rows)return;
    for(const [id,s]of rows){const row=crowd.actors[id];if(!row||row.status!=='ambient'){rows.delete(id);continue;}
      if(s.reset!==(row.motionReset||0)){Object.assign(s,{base:{...row.position},position:{...row.position},reset:row.motionReset||0,path:[],nextAt:0});continue;}
      if(same(s.base,row.position))continue;
      const ack=s.path.findIndex(p=>same(p,row.position));
      if(ack>=0){s.path.splice(0,ack+1);s.base={...row.position};}
      else{Object.assign(s,{base:{...row.position},position:{...row.position},path:[],nextAt:0});}
    }
  }
  function position(d,row){return state(d,row).position;}
  function advance(d,row,player,occupied,now,{pinned=false}={}){
    const s=state(d,row),I=root.DungeonInhabitants;
    if(!s.nextAt){s.nextAt=now+1000+hash(row.id)%1800;return s.position;}
    if(!I||root.gamePaused||root.actionDiceState?.active||root._combatRoundActiveUntil>Date.now()||pinned||now<s.nextAt||s.path.length>=8)return s.position;
    const mode=row.occupation?.mode,delay=mode==='work'?2800:mode==='visit'?3500:1700,radius=mode==='work'?3:mode==='visit'?5:8;
    s.nextAt=now+delay+hash(row.id+':'+s.steps)%900;
    const options=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({x:s.position.x+dx,y:s.position.y+dy}));
    options.sort((a,b)=>hash(row.id+':'+s.steps+':'+a.x+','+a.y)-hash(row.id+':'+s.steps+':'+b.x+','+b.y));
    const next=options.find(p=>Math.hypot(p.x-s.home.x,p.y-s.home.y)<=radius&&!occupied.has(`${p.x},${p.y}`)&&
      Math.hypot(p.x+.5-player.x,p.y+.5-player.y)>1.3&&!d.cells[`${p.x},${p.y}`]?.navigationReserved&&I.canTraverse(d,s.position,p));
    s.steps++;if(next){occupied.delete(`${s.position.x},${s.position.y}`);s.position=next;s.path.push({...next});occupied.add(`${next.x},${next.y}`);}
    return s.position;
  }
  function observations(d){return[...(rooms.get(d)?.entries()||[])].filter(([,s])=>s.path.length).slice(0,32)
    .map(([id,s])=>({id,from:{...s.base},path:s.path.map(p=>({...p}))}));}
  return{position,advance,reconcile,observations};
});
