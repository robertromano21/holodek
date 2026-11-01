(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ProceduralNames=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // Original game.js syllables, shared by server and browser rather than rewritten identities.
  const LEGACY={"people":{"prefixes":["Al","Athr","Aec","Aed","Aer","Ba","Da","Fa","Ga","Ha","Ja","Ka","La","Ma","Na","Pa","Qa","Ra","Sa","Ta","Ua","Va","Wa","Xa","Ya","Za","Be","De","Fe","Ge","He","Je","Ke","Le","Me","Ne","Pe","Qe","Re","Se","Te","Ue","Ve","We","Xe","Ye","Ze","Bi","Di","Fi","Gi","Hi","Ji","Ki","Li","Mi","Ni","Pi","Qi","Ri","Si","Ti","Ui","Vi","Wi","Xi","Yi","Zi","Bo","Do","Fo","Go","Ho","Jo","Ko","Lo","Mo","No","Po","Qo","Ro","So","To","Uo","Vo","Wo","Xo","Yo","Zo","Bu","Du","Fu","Gu","Hu","Ju","Ku","Lu","Mu","Nu","Pu","Qu","Ru","Su","Tu","Uu","Vu","Wu","Xu","Yu","Zu","By","Dy","Fy","Gy","Hy","Jy","Ky","Ly","My","Ny","Py","Qy","Ry","Sy","Ty","Vy","Wy","Xy","Zy","Bre","Beck","Bel","Ca","Cat","Cadre","Dav","Dra","Drac","Drag","Draca","El","Thel","Ar","Bal","Ber","Cal","Cael","Dor","Eil","Fen","Gael","Hal","Ili","Kor","Lan","Mal","Nel","Ol","Pra","Plur","Quin","Ral","Rom","Romn","Sel","Tal","Urm","Var","Vor","Wil","Xan","Yel","Zel","Zal","Xera","Xena","Zul","Kaal","Maal","Now","Jack","Ver","Gor","Zog","Thrak","Skar","Morg","Drak","Vor","Xar","Nar","Grok","Zur","Krag","Hark","Grim","Lurk","Bor","Snag","Kor","Ral","Zar"],"middles":["a","e","i","o","u","ae","ei","ea","en","in","em","ou","ie","oo","ai","al","ui","ul","oi","na","gul","rok","ash","thok","mok","rak","gok","lug","murg"],"endings":["ar","en","on","an","or","ir","us","ad","el","ell","en","em","ia","ius","orin","ius","in","ius","th","ius","anor","as","elle","len","lyn","ion","ael","aela","ius","tas","or","on","ar","og","ok","orak","rak","ur","ogar","krag","rag","lur"],"female":["a","ina","elle","aia","ira"]},"creature":{"prefixes":["Gor","Zog","Thrak","Skar","Morg","Drak","Vor","Xar","Nar","Grok","Zur","Krag","Hark","Grim","Lurk","Bor","Snag","Kor","Ral","Zar"],"middles":["na","gul","rok","ash","thok","mok","rak","gok","lug","murg"],"endings":["or","on","ar","og","ok","orak","rak","ur","ogar","krag","rag","lur"],"female":["a","ia","ina"]}};
  const unique=values=>[...new Set(values)];
  for(const p of Object.values(LEGACY))for(const key of Object.keys(p))p[key]=unique(p[key]);
  function random(seed){let a=2166136261;for(const c of String(seed))a=Math.imul(a^c.charCodeAt(0),16777619);return()=>{a=(a+0x6D2B79F5)>>>0;let t=Math.imul(a^(a>>>15),a|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
  const key=name=>String(name).toLowerCase().replace(/\s+/g,' ').trim();
  function validProfile(profile){
    return ['prefixes','middles','endings'].every(field=>Array.isArray(profile?.[field])&&profile[field].length>=3&&profile[field].length<=24&&
      profile[field].every(s=>typeof s==='string'&&/^[A-Za-z]{1,12}$/.test(s))&&new Set(profile[field].map(s=>s.toLowerCase())).size>=3);
  }
  function palette(profile,fallback){
    const result={...fallback};
    if(validProfile(profile))for(const field of ['prefixes','middles','endings'])result[field]=unique(profile[field].map(s=>s.toLowerCase()));
    return result;
  }
  function generate({sex='',monster=false,seed,profile,used=[],isReserved=()=>false}={}){
    const rng=seed===undefined?Math.random:random(seed),p=palette(profile,monster?LEGACY.creature:LEGACY.people);
    const taken=new Set([...used,'__proto__','constructor','prototype'].map(key)),pick=rows=>rows[Math.min(rows.length-1,Math.floor(rng()*rows.length))];
    for(let attempt=0;attempt<128;attempt++){
      const count=1+(rng()<.72?1:0)+(rng()<.08?1:0),parts=[];
      for(let i=0;i<count;i++){
        let word=pick(p.prefixes)+(rng()<.35?pick(p.middles):'')+pick(p.endings);
        word=word.toLowerCase().replace(/([aeiou])\1{2,}/g,'$1$1');
        if(!validProfile(profile)&&String(sex).toLowerCase()==='female'&&i===0&&rng()<.35)word+=pick(p.female);
        parts.push(word[0].toUpperCase()+word.slice(1));
      }
      const name=parts.join(' ');
      if(new Set(parts).size===parts.length&&name.length<=70&&!taken.has(key(name))&&!isReserved(name))return name;
    }
    throw Error('No unused procedural name was found in the bounded generation budget.');
  }
  return{LEGACY,random,palette,validProfile,generate,key};
});

