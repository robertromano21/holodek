(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CurrencyLanguage=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const NAMES={fantasy:['crown','crowns'],'dark-fantasy':['obol','obols'],mythic:['drachma','drachmae'],
    'sci-fi':['credit','credits'],cyberpunk:['scrip','scrip'],'post-apocalyptic':['salvage token','salvage tokens'],
    steampunk:['sovereign','sovereigns'],western:['dollar','dollars'],modern:['cash unit','cash'],noir:['banknote','banknotes'],
    nautical:['doubloon','doubloons'],'cosmic-horror':['shilling','shillings'],'gothic-horror':['thaler','thalers'],
    solarpunk:['community credit','community credits'],dieselpunk:['ration mark','ration marks'],underwater:['pearl token','pearl tokens'],
    prehistoric:['trade bead','trade beads'],'desert-fantasy':['dinar','dinars']};
  const clean=value=>typeof value==='string'&&/^[\p{L}\p{N}][\p{L}\p{N} '-]{0,47}$/u.test(value.trim())?value.trim():null;
  const title=value=>value.replace(/\b\w/g,c=>c.toUpperCase());
  function forWorld(world){
    if(!world||world.kind!=='homebrew')return{singular:'silver piece',plural:'silver pieces',label:'Silver Pieces'};
    const defaults=NAMES[world.genres?.[0]]||NAMES.fantasy;
    const plural=clean(world.currency?.plural)||clean(world.currencyName)||defaults[1];
    const singular=clean(world.currency?.singular)||(plural===defaults[1]?defaults[0]:plural.replace(/s$/,''));
    return{singular,plural,label:title(plural)};
  }
  function relabelText(value,currency=forWorld(null)){
    const source=String(value),c=currency;
    if(!c?.plural||!c?.label||c.plural==='silver pieces')return source;
    return source.replace(/\bSilver Pieces(?=\s*:)/g,()=>c.label)
      .replace(/\b(\d+(?:\.\d+)?)\s+silver(?: pieces?\b|\b(?=\s*(?:[.,;:!?)]|$|remaining\b|left\b|each\b)))/gi,(_,n)=>n+' '+(Number(n)===1?c.singular:c.plural))
      .replace(/\bfor silver\b/gi,()=> 'for '+c.plural);
  }
  return{NAMES,forWorld,relabelText};
});
