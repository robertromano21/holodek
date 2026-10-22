(function(root, factory) {
  const api=factory(typeof module==='object' && module.exports?require('./shrineIconography'):root.ShrineIconography,
    typeof module==='object' && module.exports?require('./renderCharacterProcedural'):root.ProceduralCharacters,
    typeof module==='object' && module.exports?require('./artCharacters'):root.ArtCharacters,
    typeof module==='object' && module.exports?require('./sculptureAnatomy'):root.SculptureAnatomy);
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.SculptureForms=api;
})(typeof window==='undefined'?globalThis:window,function(Iconography,Characters,People,Anatomy){
  'use strict';
  const poses=['offering','guardian','mourning','pointing','contemplative','invocation',...Anatomy.poses];
  const heads=['bare','helmet','hood','laurel','class'],robes=['pleated','toga','mantle','armor','shroud','class'],attributes=People.attributes;
  const forms=['human','dragon','skeleton','wraith','angel','demon'];
  const styles=['classical','renaissance'];
  const altarTypes=['horned_altar','stepped_altar','draconic_altar','canopied_altar','reredos_altar'];
  function validateShrines(rows){
    if(rows===undefined)return[];
    if(!Array.isArray(rows)||rows.length>1)throw Error('At most one focal altar assembly.');
    return rows.map(s=>{
      if(!altarTypes.includes(s?.type)||typeof s.label!=='string'||!s.label.trim()||s.label.length>70||/[<>\r\n]/.test(s.label)||
        s.deity!==undefined&&!Iconography.name(s.deity)||!Number.isInteger(s.candles)||s.candles<0||s.candles>3)throw Error('Invalid shrine assembly.');
      return{type:s.type,label:s.label.trim(),candles:s.candles,...(s.deity?{deity:Iconography.name(s.deity)}:{})};
    });
  }
  function normalize(s={}) {
    const deity=Iconography.name(s.deity) || (!(s.race||s.className||s.patron)&&Iconography.find(s.label)),canon=Iconography.pantheon[deity];
    const person=s.race||s.className?People.characterSpec(s):null,form=s.aspect==='avatar'&&canon?'human':canon?.form||(s.race?People.form(s):s.form)||'human';
    const patron=s.className?People.defaults(s).patron:null;
    return {...s,form,...(deity?{deity}:{}),...(patron?{patron}:{}),
      attribute:s.attribute??canon?.attribute??People.defaults(s).attribute,
      head:s.head==='class'?(person?.traits.outfit.hood?'hood':person&&person.traits.outfit.helm!=='none'?'helmet':'bare'):s.head,
      robe:s.robe==='class'?(['plate','mail'].includes(person?.traits.outfit.style)?'armor':person?.traits.outfit.style==='furs'?'mantle':'pleated'):s.robe,
      wings:canon?.wings||canon?.visual?.wings||person?.traits.wings||(['dragon','angel','demon'].includes(form)?'membrane':'none'),hair:canon?.hair || 'none'};
  }
  function validate(rows){
    if(rows===undefined)return[];
    if(!Array.isArray(rows)||rows.length>2)throw Error('At most two authored sculptures per room.');
    return rows.map(s=>{
      if(typeof s?.label!=='string'||!s.label.trim()||s.label.length>70||/[<>\r\n]/.test(s.label)||
        !poses.includes(s.pose)||!heads.includes(s.head)||!robes.includes(s.robe)||!attributes.includes(s.attribute)||
        s.form!==undefined&&!forms.includes(s.form)||s.deity!==undefined&&!Iconography.name(s.deity)||
        s.motif!==undefined&&(typeof s.motif!=='string'||s.motif.length>28||/[<>\r\n]/.test(s.motif))||
        s.workmanship!==undefined&&!['classic','carved'].includes(s.workmanship)||
        s.sculptureStyle!==undefined&&!styles.includes(s.sculptureStyle))throw Error('Invalid sculpture assembly.');
      const person=People.validate(s);
      if(Iconography.name(s.deity)&&Object.keys(person).length)throw Error('Invalid mortal overrides on a canonical deity.');
      const normalized=normalize({label:s.label.trim(),pose:s.pose,head:s.head,robe:s.robe,attribute:s.attribute,...person,
        ...(s.form?{form:s.form}:{}),...(s.deity?{deity:s.deity}:{}),...(s.motif?{motif:s.motif}:{}),...(s.workmanship?{workmanship:s.workmanship}:{}),
        ...(s.sculptureStyle?{sculptureStyle:s.sculptureStyle}:{}),
        ...(s.aspect==='avatar'?{aspect:'avatar'}:{}),...(s.dragonVariety&&typeof s.dragonVariety==='object'?{dragonVariety:{...s.dragonVariety}}:{})});
      // Saved definitions use their serialized order in the original mechanism hash.
      // Preserve that order after validating values, including an originally inferred form.
      if(typeof s.wings==='string'&&typeof s.hair==='string'){
        const stable={};for(const key of Object.keys(s))if(Object.hasOwn(normalized,key))stable[key]=normalized[key];
        for(const[key,value]of Object.entries(normalized))if(!Object.hasOwn(stable,key))stable[key]=value;
        return stable;
      }
      return normalized;
    });
  }
  // world1: every dragon deity gets a fixed, distinct carved variety so statues of different gods never look alike.
  function dragonVariety(deity){
    const n=Characters.hashString('dragon-variety:'+deity);
    return{horns:n%4,hornStyle:['straight','swept','curled'][(n>>>2)%3],crest:3+(n>>>4)%6,crestStyle:['spines','frill'][(n>>>7)%2],
      coils:(n>>>8)%3,ridges:!!((n>>>10)%2),wingSpan:['spread','raised','folded'][(n>>>11)%3],pose:['coiled','rearing','couchant'][(n>>>13)%3]};
  }
  function visualSpec(raw,enabled=true,seed=''){
    if(!raw)return raw;
    const result={...raw};
    if(!enabled||raw.workmanship==='classic'){delete result.sculptureStyle;return result;}
    result.workmanship='carved';
    result.sculptureStyle=raw.sculptureStyle||styles[Characters.hashString(raw.label||String(seed))%styles.length];
    if(raw.world1Variety&&raw.form==='dragon'&&raw.deity&&!raw.dragonVariety)result.dragonVariety=dragonVariety(raw.deity);
    delete result.world1Variety;
    return result;
  }
  function build(size,seed,raw={}){
    const n=parseInt(String(seed),16)||Number(seed)||17;
    const s=normalize({pose:poses[n%(raw.workmanship==='carved'?poses.length:6)],head:heads[(n>>>3)%4],robe:robes[(n>>>5)%3],attribute:attributes[(n>>>7)%5],...raw});
    if(s.workmanship==='carved'||s.sculptureStyle&&s.workmanship!=='classic'||s.deity==='Turthus'||s.deity==='Dantuea'||Anatomy.poses.includes(s.pose))return Anatomy.build(size,s,s.race?People.characterSpec(s).traits:{});
    const traits=s.race?People.characterSpec(s).traits:null,height=s.race?People.scale(s):1,width=traits?.build==='heavy'?1.13:traits?.build==='slender'?.85:1;
    const voxels=new Uint8Array(size**3), put=(x,y,z)=>{
      if(s.race&&z/size>.12){x=Math.round((x-size*.5)*width+size*.5);z=Math.round(size*.12+(z-size*.12)*Math.min(1,height));}
      if(x>=0&&y>=0&&z>=0&&x<size&&y<size&&z<size)voxels[x+y*size+z*size*size]=1;
    };
    const ellipsoid=(cx,cy,cz,rx,ry,rz)=>{
      for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)
        if(((x+.5)/size-cx)**2/rx**2+((y+.5)/size-cy)**2/ry**2+((z+.5)/size-cz)**2/rz**2<=1)put(x,y,z);
    };
    const limb=(a,b,r)=>{const steps=Math.ceil(Math.hypot(...a.map((v,i)=>v-b[i]))*size*2);for(let i=0;i<=steps;i++)ellipsoid(...a.map((v,j)=>v+(b[j]-v)*i/Math.max(1,steps)),r,r,r);};
    for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const xx=(x+.5)/size,yy=(y+.5)/size,zz=(z+.5)/size;
      if(zz<.11&&xx>.14&&xx<.86&&yy>.18&&yy<.82)put(x,y,z);
      if(zz>=.16&&zz<.67&&s.form!=='dragon'&&s.form!=='skeleton'){
        const hip=.51+.065*Math.sin((zz-.16)*5),radius=.22-(zz-.16)*.2;
        const angle=Math.atan2(yy-.5,xx-hip),fold=.016*Math.cos(angle*9+zz*(s.robe==='toga'?11:2));
        if((s.robe!=='armor'||zz>.43)&&Math.hypot((xx-hip),(yy-.5)*1.25)<(s.robe==='armor'?.16:radius+fold))put(x,y,z);
      }
    }
    limb([.39,.46,.13],[.49,.49,.47],.055);limb([.62,.53,.13],[.56,.49,.47],.05);
    ellipsoid(.51,.48,.65,.15,.105,.145);ellipsoid(.48,.47,.84,.09,.075,.105);
    if(s.form==='dragon'){
      ellipsoid(.47,.33,.84,.1,.15,.045);
      limb([.42,.48,.91],[.37,.55,.99],.023);limb([.55,.48,.91],[.62,.55,.99],.023);
      limb([.58,.54,.38],[.81,.71,.17],.065);limb([.81,.71,.17],[.88,.88,.2],.038);
      limb([.88,.88,.2],[.67,.91,.23],.022);
    }
    if(s.form==='skeleton'){
      for(let z=.48;z<.73;z+=.065){limb([.5,.5,z],[.35,.46,z+.03],.019);limb([.5,.5,z],[.65,.46,z+.03],.019);}
      // Hollow the rib cage and eye sockets rather than painting a solid torso.
      for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(
        z/size>.48&&z/size<.73&&Math.abs(x/size-.5)<.1&&Math.abs(y/size-.46)<.07||
        z/size>.82&&z/size<.88&&y/size<.43&&(Math.abs(x/size-.43)<.03||Math.abs(x/size-.53)<.03))voxels[x+y*size+z*size*size]=0;
      limb([.5,.55,.44],[.5,.55,.74],.022);
    }
    if(s.deity==='Mortacia'){
      const shape=Characters.mortaciaWingProfile();
      for(const side of[-1,1]){
        const map=p=>[.5+side*(.12+p[0]*.35),.62+p[0]*.06,.98-p[1]*.76];
        const membrane=Characters.renderMortaciaWingPixels(size*.35,size*.76);
        for(let y=0;y<membrane.h;y++)for(let x=0;x<membrane.w;x++)if(membrane.data[(x+y*membrane.w)*4+3]){
          const point=map([x/(membrane.w-1),y/(membrane.h-1)]);put(...point.map(v=>Math.round(v*size)));
        }
        for(const [a,b]of shape.ribs)limb(map(a),map(b),.019);
      }
    }else if(s.wings!=='none'||s.form==='dragon')for(const side of [-1,1]){
      const base=[.5+side*.13,.58,.68],tip=[.5+side*.46,.65,.94],low=[.5+side*.43,.68,.4];
      limb(base,tip,.023);limb(tip,low,.018);
      for(let i=0;i<4;i++)limb(base,tip.map((v,j)=>v+(low[j]-v)*i/3),.012);
      if(s.wings!=='skeletal')for(let i=0;i<16;i++)limb(base,tip.map((v,j)=>v+(low[j]-v)*i/15),.018);
    }
    if(s.hair==='blonde')for(const side of [-1,1])limb([.48+side*.085,.5,.9],[.49+side*.13,.53,.66],.027);
    if(traits&&s.form==='human'){
      if(traits.ears!=='human')for(const side of[-1,1])limb([.48+side*.085,.47,.87],[.48+side*(s.race==='Half-Elf'?.12:.16),.49,.91],.018);
      if(traits.beard)limb([.48,.39,.82],[.48,.43,.72],.044);
      if(traits.horns!=='none')for(const side of[-1,1])limb([.48+side*.06,.49,.91],[.48+side*.13,.5,.98],.017);
      if(traits.head==='reptile')ellipsoid(.48,.36,.84,.07,.12,.04);
      if(traits.head==='beast')ellipsoid(.48,.37,.82,.065,.065,.04);
    }
    limb([.5,.48,.72],[.48,.47,.78],.042);ellipsoid(.45,.389,.84,.032,.035,.025);
    const hands={offering:[[.14,.26,.58],[.78,.42,.55]],guardian:[[.28,.4,.49],[.72,.43,.67]],
      mourning:[[.42,.31,.83],[.61,.34,.64]],pointing:[[.08,.3,.75],[.72,.4,.53]],
      contemplative:[[.42,.31,.79],[.7,.4,.48]],invocation:[[.18,.4,.96],[.8,.4,.94]]}[s.pose];
    if(Number.isFinite(raw.activation))for(let i=0;i<hands.length;i++)hands[i]=hands[i].map((v,j)=>v+(j===2?.13*raw.activation:0));
    for(const [i,hand]of hands.entries()){
      const shoulder=[i?.65:.37,.48,.71],elbow=shoulder.map((v,j)=>(v+hand[j])/2+(j===1?-.055:0));
      limb(shoulder,elbow,.045);limb(elbow,hand,.035);ellipsoid(...hand,.045,.035,.025);
    }
    if(s.head==='helmet')ellipsoid(.48,.49,.9,.105,.087,.065);
    if(s.head==='hood')ellipsoid(.48,.51,.85,.112,.09,.115);
    if(s.head==='laurel')for(let i=0;i<7;i++){const a=i*Math.PI/6;ellipsoid(.48+.095*Math.cos(a),.47+.07*Math.sin(a),.9,.025,.022,.018);}
    if(s.attribute==='staff')limb([.75,.4,.14],[.75,.4,.94],.018);
    if(s.attribute==='shield')ellipsoid(.74,.33,.5,.11,.035,.17);
    if(s.attribute==='orb')ellipsoid(...hands[0],.065,.065,.065);
    if(s.attribute==='scroll')limb(hands[0],hands[0].map((v,i)=>v+(i===0?.15:0)),.04);
    const hand=hands[0],end=[hand[0],hand[1],Math.min(.96,hand[2]+.23)];
    if(['sword','dagger','spear','lance','harpoon','scythe','sickle','pick','halberd','mace','club','torch'].includes(s.attribute)){
      const short=['dagger','sickle','club'].includes(s.attribute);limb([hand[0],hand[1],Math.max(.14,hand[2]-.25)],short?hand.map((v,i)=>v+(i===2?.12:0)):end,.017);
      if(['sword','dagger','lance'].includes(s.attribute))limb([hand[0]-.05,hand[1],hand[2]],[hand[0]+.05,hand[1],hand[2]],.018);
      if(['scythe','sickle','pick','halberd'].includes(s.attribute))limb([end[0]-.02,end[1],end[2]],[end[0]+.17,end[1],end[2]-.08],.019);
      if(['mace','club','torch'].includes(s.attribute))ellipsoid(...end,.04,.035,.055);
    }
    if(s.attribute==='book')ellipsoid(...hand,.08,.026,.06);
    if(s.attribute==='bowl')ellipsoid(...hand,.08,.06,.03);
    if(s.attribute==='gauntlet')ellipsoid(...hand,.06,.05,.055);
    if(['bow','lyre','whip','chain','sling','net'].includes(s.attribute))for(let i=0;i<10;i++){
      const a=i*Math.PI/9,b=(i+1)*Math.PI/9;limb([hand[0]+.09*Math.sin(a),hand[1],hand[2]+.15*Math.cos(a)],
        [hand[0]+.09*Math.sin(b),hand[1],hand[2]+.15*Math.cos(b)],.011);
      if(s.attribute==='net'&&i%2===0)limb([hand[0],hand[1],hand[2]-.12+i*.025],[hand[0]+.09,hand[1],hand[2]-.12+i*.025],.009);
    }
    if(s.attribute==='lyre'||s.attribute==='bow')limb([hand[0],hand[1],hand[2]-.15],[hand[0],hand[1],hand[2]+.15],.008);
    if(s.attribute==='scales'){limb(hand,end,.013);for(const side of[-1,1]){limb(end,[end[0]+side*.09,end[1],end[2]],.011);ellipsoid(end[0]+side*.09,end[1],end[2]-.08,.045,.035,.015);}}
    if(s.attribute==='hourglass'){ellipsoid(...hand,.035,.025,.06);for(const z of[-.06,.06])ellipsoid(hand[0],hand[1],hand[2]+z,.05,.03,.014);}
    if(s.attribute==='catapult'){limb([.2,.3,.18],[.4,.3,.47],.022);ellipsoid(.28,.3,.18,.14,.06,.02);ellipsoid(.4,.3,.47,.04,.04,.02);}
    return voxels;
  }
  function characterSpec(raw,palette={}) {
    const s=normalize(raw),canon=Iconography.pantheon[s.deity],name=s.deity||s.label||s.form;
    if(!canon&&(s.race||s.className))return People.characterSpec(s,palette);
    const preset=s.deity==='Mortacia'?Characters.getPresetProceduralSpec('Mortacia'):null;
    const traits=preset?JSON.parse(JSON.stringify(preset.traits)):Characters.deriveFallbackTraits({name,race:s.form==='dragon'?'Celestial Dragon':s.form,sex:s.deity==='Mortacia'?'Female':'',class:'Guardian',level:1});
    traits.bodyPlan={human:'humanoid',dragon:'draconic',skeleton:'skeletal',wraith:'spectral',angel:'humanoid',demon:'humanoid'}[s.form];
    traits.covering=s.form==='dragon'?'scales':s.form==='skeleton'?'bone':s.form==='wraith'?'mist':'skin';
    traits.wings=s.wings==='skeletal'?'bone':s.form==='angel'?'feather':['dragon','demon'].includes(s.form)?'bat':'none';
    // Legacy "skeletal" metadata means prominent dragon ribs, not missing membranes.
    if(s.deity==='Mortacia'){traits.wings='bat';traits.wingShape='mortacia';}
    if(canon?.visual)Object.assign(traits,canon.visual);
    traits.aura={color:canon?.color||'#b6ab85',strength:0};traits.items=[];
    traits.palette={...traits.palette,skin:canon?.color||palette.secondary||'#c1b59c',skin2:palette.primary||'#81776a',
      outfit:palette.primary||'#766858',outfit2:palette.shadow||'#453f39',hair:s.hair==='blonde'?'#ddbb64':palette.secondary||'#c1b59c',glow:canon?.color||'#c1b59c'};
    return Characters.buildProceduralSpriteSpec({name,race:s.form,sex:s.deity==='Mortacia'?'Female':'',class:'Shrine effigy',level:1},traits,{signature:false,source:'shrine',salt:Characters.hashString(s.label||name)});
  }
  function paintFigure(ctx,raw,palette={},box={x:0,y:0,width:64,height:64}) {
    if(raw.workmanship==='carved'||raw.sculptureStyle&&raw.workmanship!=='classic'||['Turthus','Dantuea'].includes(normalize(raw).deity))return Anatomy.paint(ctx,normalize(raw),palette,box,64,raw.race?People.characterSpec(raw).traits:{});
    const image=Characters.createProceduralCharacterCanvas(characterSpec(raw,palette),{scale:1,frame:0});
    if(image){
      if(box.pigment){
        const c=image.getContext('2d'),pixels=c.getImageData(0,0,image.width,image.height),d=pixels.data;
        for(let i=0;i<d.length;i+=4)if(d[i+3]){
          const shade=(d[i]+d[i+1]+d[i+2])/3;
          if(shade<45){d[i]=78;d[i+1]=56;d[i+2]=49;}else for(let j=0;j<3;j++)d[i+j]=Math.min(255,d[i+j]*.84+[34,28,19][j]);
        }
        c.putImageData(pixels,0,0);
      }
      ctx.imageSmoothingEnabled=false;ctx.drawImage(image,box.x,box.y,box.width,box.height);
    }
  }
  return{poses,heads,robes,attributes,forms,styles,altarTypes,validateShrines,normalize,validate,visualSpec,dragonVariety,build,characterSpec,paintFigure,
    toolbox:()=>({poses,heads,robes,attributes,forms,workmanship:['classic','carved'],sculptureStyle:styles,altarTypes,deities:Iconography.toolbox(),people:People.toolbox()})};
});
