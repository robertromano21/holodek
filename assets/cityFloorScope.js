(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else{root.CityFloorScope=api;api.install();}})(typeof window==='object'?window:globalThis,function(root){
  'use strict';let token=null,context=null,installed=false;
  const identity=r=>r?`${r.hostKey}|${r.buildingId}|${r.floor}`:'street';
  function receive(event){if(typeof event?.floorToken==='string'){token=event.floorToken;context=event.floorContext||null;}}
  function cacheKey(key,dungeon){const ref=dungeon?dungeon.cityFloorContext:context;return ref?.hostKey===key?`${key}:building:${ref.buildingId}:floor:${ref.floor}`:key;}
  function install(){
    if(installed||!root.fetch)return;installed=true;const original=root.fetch.bind(root);
    root.fetch=function(input,init){
      const url=typeof input==='string'?input:input?.url;
      if(token&&typeof url==='string'&&(url.startsWith('/')&&!url.startsWith('//')||root.location&&new URL(url,root.location.href).origin===root.location.origin)){
        const headers=new Headers(init?.headers||input?.headers);headers.set('X-Holodek-Floor',token);init={...init,headers};
      }
      return original(input,init);
    };
    root.document?.addEventListener('DOMContentLoaded',()=>root.jQuery?.ajaxPrefilter?.((_settings,_original,xhr)=>{if(token)xhr.setRequestHeader('X-Holodek-Floor',token);}));
  }
  return{receive,install,identity,cacheKey,token:()=>token,context:()=>context};
});
