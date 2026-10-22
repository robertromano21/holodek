'use strict';
const Flags=require('./worldFlags');
const VERSION='world1-trade-routes-1';
const Routes=require('../assets/outdoorRoutes');
function targets(db,key){
  const origin=Routes.coordinates(key),out=[];if(!origin)return out;
  const exits=db[key]?.exits||{};
  for(const {direction:dir,info:exit}of Routes.exitEntries(exits)){
    if(!dir)continue;
    if(dir==='portal'||exit?.kind==='portal')continue;
    const legacy=typeof exit==='string'&&/^-?\d+,-?\d+,-?\d+$/.test(exit);
    const normalized=legacy?{[dir]:{status:'open',targetCoordinates:exit}}:exits;
    const route=Routes.resolveExit(origin,dir,normalized);
    if(route.status==='open'&&route.targetKey&&db[route.targetKey]&&!out.includes(route.targetKey))out.push(route.targetKey);
  }
  return out;
}
function reachable(db,key){
  const seen=new Set([key]),q=[key],markets=[];
  for(let i=0;i<q.length&&i<128;i++){
    const k=q[i];if(k!==key&&db[k]?.market?.version==='world1')markets.push(k);
    for(const next of targets(db,k))if(!seen.has(next)){seen.add(next);q.push(next);}
  }
  return markets.slice(0,16);
}
function connect(db,key){
  if(!Flags.on('TRADE_ROUTES')||db[key]?.market?.version!=='world1')return [];
  const routes=reachable(db,key);
  db[key].market.routes={version:VERSION,rooms:routes};
  return routes;
}
function balance(db,key){
  const routes=connect(db,key),origin=db[key]?.market;
  if(!origin||!routes.length)return 0;
  let changes=0;
  for(const otherKey of routes){
    const other=db[otherKey].market;
    for(const category of Object.keys(origin.demand)){
      const a=origin.demand[category],b=other.demand[category];
      if(!Number.isFinite(a)||!Number.isFinite(b))continue;
      const flow=Math.max(-.025,Math.min(.025,(a-b)*.025));
      origin.demand[category]=Math.max(.3,Math.min(3,a-flow));
      other.demand[category]=Math.max(.3,Math.min(3,b+flow));
    }
    changes++;
  }
  // This propagates supply/demand pressure only: no free stock, currency, jobs or quest progress.
  origin.routeTrades=(origin.routeTrades||0)+1;
  return changes;
}
module.exports={VERSION,targets,reachable,connect,balance};
