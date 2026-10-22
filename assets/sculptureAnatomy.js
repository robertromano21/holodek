(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./renderCharacterProcedural'):root.ProceduralCharacters);if(typeof module==='object'&&module.exports)module.exports=api;else root.SculptureAnatomy=api;
})(typeof window==='undefined'?globalThis:window,function(Characters){
  'use strict';
  const poses=['contrapposto','kneeling','seated','orator','processional','benediction','laureate','mantled_scholar','victorious','lyrist'];
  function build(size,s,traits={}){
    const out=new Uint8Array(size**3),dwarf=traits.size==='small',height=dwarf?.82:traits.size==='tiny'?.68:1,wide=traits.build==='heavy'?1.15:traits.build==='slender'?.92:1;
    const refined=['classical','renaissance'].includes(s.sculptureStyle)&&s.workmanship!=='classic',renaissance=s.sculptureStyle==='renaissance';
    let headTransform=null;
    const put=(x,y,z,value=1)=>{
      if(headTransform){
        const [cx,cy,cz]=headTransform.map(v=>v*size),dz=z-cz;
        x=Math.round(cx+(x-cx)*.88+dz*(renaissance?.09:.045));y=Math.round(cy+(y-cy)*.9);z=Math.round(cz+dz*.88);
      }
      if(z/size>.12){x=Math.round(size*.5+(x-size*.5)*wide);z=Math.round(size*.12+(z-size*.12)*height);}
      if(x>=0&&y>=0&&z>=0&&x<size&&y<size&&z<size)out[x+y*size+z*size*size]=value;
    };
    const egg=(p,r,value=1)=>{
      const low=p.map((v,i)=>Math.max(0,Math.floor((v-r[i])*size))),high=p.map((v,i)=>Math.min(size-1,Math.ceil((v+r[i])*size)));
      for(let z=low[2];z<=high[2];z++)for(let y=low[1];y<=high[1];y++)for(let x=low[0];x<=high[0];x++)
        if(p.reduce((n,v,i)=>n+((( [x,y,z][i]+.5)/size-v)/r[i])**2,0)<=1)put(x,y,z,value);
    };
    const tube=(a,b,r0,r1=r0,minRadius=.68/size)=>{
      const steps=Math.max(1,Math.ceil(Math.hypot(...a.map((v,i)=>v-b[i]))*size*2));
      for(let i=0;i<=steps;i++){const t=i/steps,r=Math.max(minRadius,r0+(r1-r0)*t);egg(a.map((v,j)=>v+(b[j]-v)*t),[r,r,r]);}
    };
    const curve=(a,b,c,r0,r1)=>{let prev=a;for(let i=1;i<=22;i++){const t=i/22,p=a.map((v,j)=>(1-t)**2*v+2*(1-t)*t*b[j]+t*t*c[j]);tube(prev,p,r0+(r1-r0)*t);prev=p;}};
    const triangle=(a,b,c)=>{
      for(let i=0;i<=size;i++){const t=i/size;tube(a.map((v,j)=>v+(b[j]-v)*t),a.map((v,j)=>v+(c[j]-v)*t),.011);}
    };
    // Molded plinth with a recessed die and a thin overhanging cornice.
    for(let z=0;z<size*.12;z++){
      const inset=z/size>.035&&z/size<.09?.025:0;
      for(let y=size*(.18+inset)|0;y<size*(.82-inset);y++)for(let x=size*(.14+inset)|0;x<size*(.86-inset);x++)put(x,y,z);
    }
    if(refined)for(let x=size*.22|0;x<size*.78;x++){
      const u=(x+.5)/size,groove=renaissance?Math.abs(Math.sin(u*Math.PI*16))<.35:u>.29&&u<.71;
      if(groove)for(const y of[.205,.785])put(x,Math.floor(y*size),Math.floor(size*.062),0);
    }
    function wings(origin,bone=false){
      if(s.deity==='Mortacia'){
        const shape=Characters.mortaciaWingProfile();
        for(const side of[-1,1]){
          const map=p=>[origin[0]+side*(.11+p[0]*.34),.6+p[0]*.1,.98-p[1]*.77],points=shape.outline.map(map);
          for(let i=2;i<points.length;i++)triangle(points[1],points[i],points[(i+1)%points.length]);
          for(const [a,b]of shape.ribs){const from=map(a),to=map(b);from[1]-=.016;to[1]-=.016;tube(from,to,.018,.012);}
          tube([origin[0]+side*.07,...origin.slice(1)],map(shape.outline[0]),.02);
        }
        return;
      }
      for(const side of[-1,1]){
        const elbow=[origin[0]+side*.2,.63,origin[2]+.1],tip=[origin[0]+side*.43,.61,.94];
        tube(origin,elbow,.019);tube(elbow,tip,.015);
        for(const[z,y]of[[.45,.5],[.39,.65],[.48,.78]]){
          const end=[origin[0]+side*.35,y,z];tube(tip,end,.012);tube(origin,end,.012);
          if(!bone)triangle(origin,tip,end);
        }
      }
    }
    if(s.deity==='Turthus'){
      for(const side of[-1,1])for(const y of[.35,.66]){
        tube([.5+side*.16,y,.34],[.5+side*.28,y-.02,.16],.065,.037);
        for(let i=0;i<3;i++)tube([.5+side*.28,y-.02,.16],[.5+side*(.25+i*.028),y-.1,.13],.018,.009);
      }
      egg([.5,.55,.35],[.245,.28,.14]);egg([.5,.56,.44],[.235,.26,.24]);
      for(let row=0;row<3;row++)for(let col=0;col<3;col++){
        const x=.35+col*.15,y=.39+row*.15,z=.5+.13*(1-((x-.5)/.3)**2-((y-.54)/.34)**2);
        egg([x,y,z],[.068,.075,.042]);
      }
      curve([.5,.33,.37],[.48,.14,.42],[.52,.18,.69],.068,.045);
      egg([.52,.17,.71],[.068,.084,.05]);tube([.52,.15,.69],[.52,.04,.68],.037,.022);
      for(const side of[-1,1]){tube([.52+side*.045,.21,.74],[.52+side*.064,.3,.81],.019,.009);egg([.52+side*.052,.105,.727],[.014,.014,.012],0);}
      curve([.5,.79,.3],[.74,.9,.2],[.82,.91,.15],.055,.012);return out;
    }
    if(s.form==='dragon'){
      const skeletal=s.deity==='Dantuea';
      if(skeletal){
        tube([.5,.56,.43],[.5,.5,.69],.018);
        for(let i=0;i<6;i++)for(const side of[-1,1])curve([.5,.54,.48+i*.03],[.5+side*.15,.5,.48+i*.03],[.5+side*.025,.39,.49+i*.03],.012,.009);
      }else{egg([.5,.52,.49],[.09,.11,.13]);egg([.5,.47,.61],[.07,.09,.1]);}
      curve([.5,.47,.64],[.35,.35,.76],[.56,.29,.85],skeletal?.02:.055,skeletal?.017:.033);
      egg([.57,.27,.87],[.045,.065,.042]);tube([.57,.24,.865],[.63,.13,.85],.031,.015);
      curve([.5,.6,.46],[.9,.87,.28],[.74,.87,.18],skeletal?.02:.065,skeletal?.015:.029);curve([.74,.87,.18],[.5,.96,.14],[.25,.8,.22],skeletal?.015:.029,.011);
      for(const side of[-1,1]){
        const hip=[.5+side*.06,.53,.46],knee=[.5+side*.16,.4,.3],heel=[.5+side*.16,.55,.16];
        tube(hip,knee,skeletal?.024:.05,skeletal?.019:.035);tube(knee,heel,skeletal?.016:.03,skeletal?.015:.023);
        for(let i=0;i<3;i++)tube(heel,[heel[0]+(i-1)*.035,.35,.13],.018,.011);
        tube([.57+side*.03,.29,.89],[.57+side*(s.deity==='Atinus'?.15:.06),.39,.97],.014,.011);
      }
      if(s.deity==='Atricles'){
        const ring=(cx,cy,cz,r,axis)=>{let prev;for(let i=0;i<=24;i++){
          const a=i*Math.PI/12,p=axis==='z'?[cx+r*Math.cos(a),cy+r*Math.sin(a),cz]:[cx+r*Math.cos(a),cy,cz+r*Math.sin(a)];
          if(prev)tube(prev,p,.01);prev=p;
        }};
        for(const side of[-1,1])ring(.5+side*.16,.35,.19,.05,'y');
        for(let i=0;i<3;i++)ring(.5-i*.013,.415-i*.022,.695+i*.027,.045-i*.003,'z');
        curve([.25,.8,.22],[.12,.72,.39],[.27,.7,.4],.018,.012);
        curve([.27,.7,.4],[.39,.74,.36],[.3,.78,.31],.012,.008);
      }
      // world1: per-deity dragon variety (horns, crest, coils, scale ridges, wing span, raised or lowered head).
      const v=s.dragonVariety;
      if(v){
        const h=[.57,.27,.87];
        for(let i=0;i<(v.horns||0);i++)for(const side of[-1,1]){const k=i*.022,sweep=v.hornStyle==='swept'?.09:v.hornStyle==='curled'?.03:.05;
          if(v.hornStyle==='curled')curve([h[0]+side*(.025+k),h[1]+.01,h[2]+.02],[h[0]+side*(.08+k),h[1]+.07,h[2]+.08],[h[0]+side*(.05+k),h[1]+.03,h[2]+.03],.011,.007);
          else tube([h[0]+side*(.025+k),h[1]+.01,h[2]+.02],[h[0]+side*(.03+k+sweep*.4),h[1]+sweep,h[2]+.07+i*.02],.012,.006);}
        for(let i=0;i<(v.crest||0);i++){const t=i/Math.max(1,v.crest-1),x=.5,y=.5+t*.35,z=.66-t*.4;tube([x,y,z],[x,y+.01,z+.035+(v.crestStyle==='frill'?.02:0)],.012,.004);}
        for(let i=0;i<(v.coils||0);i++){const r=.08-i*.015;let prev;for(let j=0;j<=16;j++){const a=j*Math.PI/8,p=[.5+r*Math.cos(a),.82+i*.03,.18+r*Math.sin(a)*.6+i*.03];if(prev)tube(prev,p,.022-i*.003);prev=p;}}
        if(v.ridges)for(let i=0;i<5;i++)for(const side of[-1,1])egg([.5+side*.07,.5+i*.02,.45+i*.04],[.012,.02,.01]);
        if(v.pose==='rearing')tube([.5,.5,.6],[.5,.42,.75],.05,.04);
      }
      if(!v||v.wingSpan!=='folded')wings([.5,.52,.64],s.wings==='skeletal'||s.wings==='bone');
      egg([.552,.224,.885],[.012,.012,.009],0);egg([.605,.218,.885],[.012,.012,.009],0);
      // Wyvern anatomy: wings and two hind legs, never a second pair of arms.
      return out;
    }
    const sitting=['kneeling','seated','mantled_scholar'].includes(s.pose),seated=['seated','mantled_scholar'].includes(s.pose),hipZ=sitting?.37:.48,shoulderZ=sitting?.61:.71,headZ=sitting?.78:.865;
    const weighted=refined&&!sitting&&s.pose!=='invocation',tilt=weighted?(renaissance?.018:.012):0;
    const sway=weighted?(renaissance?.04:.025):['contrapposto','processional','offering','laureate','victorious'].includes(s.pose)?.035:0;
    const bodyX=refined?.5+sway*.15:.5-sway;
    const hips=[[.44+sway,.5,hipZ-tilt],[.56+sway,.5,hipZ+tilt]],neck=[bodyX,.49,shoulderZ+.08],head=[bodyX,.48,headZ];
    const knees=seated?[[.4,.25,.3],[.6,.25,.3]]:s.pose==='kneeling'?[[.4,.28,.17],[.61,.58,.18]]:
      weighted?[[.4,.44,renaissance?.285:.3],[.565+sway*.35,.51,.31]]:[[.41,.47,.3],[.6,.54,.31]];
    const heels=seated?[[.4,.28,.16],[.6,.28,.16]]:s.pose==='kneeling'?[[.37,.55,.14],[.64,.74,.14]]:
      weighted?[[.415,.57,.16],[.54+sway*.4,.51,.16]]:[[.38,.48,.16],[.62,.56,.16]];
    if(seated){
      egg([.5,.54,.31],[.145,.14,.035]);
      for(const side of[-1,1])tube([.5+side*.11,.63,.12],[.5+side*.11,.63,.52],.025);
      egg([.5,.64,.43],[.12,.023,.11]);
    }
    for(let i=0;i<2;i++){
      tube(hips[i],knees[i],.043,.031);egg(knees[i],[.033,.033,.03]);tube(knees[i],heels[i],.029,.023);
      if(refined){
        const calf=knees[i].map((v,j)=>v*.65+heels[i][j]*.35);calf[1]+=.012;
        egg(calf,[.033,.036,.053]);tube(calf,heels[i],.027,.018);
      }
      egg([heels[i][0],heels[i][1]-.045,.145],[.03,.065,.023]);
    }
    if(s.form==='skeleton'){
      tube([.5+sway,.52,hipZ],[.5-sway,.52,shoulderZ],.02);
      for(let z=hipZ+.05;z<shoulderZ;z+=.04)for(const side of[-1,1])curve([.5,.52,z],[.5+side*.12,.4,z+.025],[.5+side*.03,.41,z-.01],.012,.012);
    }else{
      egg([.5+sway,.5,hipZ],[.105,.068,.055]);egg([.5,.5,hipZ+.09],[.07,.06,.09]);egg([bodyX,.5,shoulderZ-.05],[.115,.065,.095]);
      for(const side of[-1,1]){
        egg([bodyX+side*.048,.447,shoulderZ-.035-side*tilt],[.047,.023,.035]);
        tube([bodyX+side*.02,.44,shoulderZ+.005],[bodyX+side*.1,.467,shoulderZ+.012-side*(tilt||sway*.35)],.013);
      }
    }
    tube([bodyX,.49,shoulderZ+.015],neck,.035,refined?.023:.028);
    if(refined)headTransform=head;
    egg(head,[.057,.055,.068]);egg([head[0],head[1]-.02,head[2]-.041],[.037,.039,.03]);
    egg([head[0],head[1]-.06,head[2]-.004],[.013,.022,.025]);
    for(const side of[-1,1]){
      egg([head[0]+side*.06,head[1],head[2]],[.015,.016,.025]);
      egg([head[0]+side*.033,head[1]-.045,head[2]-.016],[.023,.019,.023]);
      egg([head[0]+side*.024,head[1]-.047,head[2]+.018],[.016,.026,.009],0);
      tube([head[0]+side*.014,head[1]-.053,head[2]+.033],[head[0]+side*.04,head[1]-.041,head[2]+.029],.011);
      if(traits.ears==='pointed'||traits.ears==='long')tube([head[0]+side*.05,head[1],head[2]+.01],[head[0]+side*.09,head[1]+.02,head[2]+.053],.016,.011);
    }
    egg([head[0],head[1]-.06,head[2]-.029],[.025,.01,.008]);
    egg([head[0],head[1]-.058,head[2]-.045],[.021,.009,.009]);
    egg([head[0],head[1]-.063,head[2]-.036],[.023,.014,.006],0);
    egg([head[0],head[1]-.048,head[2]-.057],[.023,.018,.013]);
    for(const side of[-1,1])egg([head[0]+side*.011,head[1]-.074,head[2]-.02],[.006,.012,.006],0);
    if(traits.beard)egg([head[0],head[1]-.041,head[2]-.067],[.04,.033,.054]);
    if(traits.horns&&traits.horns!=='none')for(const side of[-1,1])tube([head[0]+side*.04,head[1],head[2]+.05],[head[0]+side*.075,head[1]+.04,head[2]+.11],.014,.011);
    if(traits.head==='beast'||traits.head==='reptile')egg([head[0],head[1]-.067,head[2]-.016],[.041,.05,.027]);
    headTransform=null;
    if(s.robe==='armor'){
      egg([bodyX,.447,shoulderZ-.047],[.112,.031,.085]);for(const side of[-1,1])egg([.5+side*.125,.51,shoulderZ],[.048,.047,.027]);
      if(refined)egg([bodyX,.448,hipZ+.075],[.076,.035,.09]);
    }
    const hands={offering:[[.29,.27,.57],[.71,.28,.57]],guardian:[[.3,.44,.45],[.68,.4,.62]],
      mourning:[[.46,.35,headZ],[.66,.4,.56]],pointing:[[.14,.33,.73],[.67,.43,.47]],
      contemplative:[[.46,.34,headZ-.02],[.66,.4,.44]],invocation:[[.27,.4,.94],[.74,.4,.94]],
      contrapposto:[[.32,.42,.47],[.67,.46,.48]],kneeling:[[.31,.3,.5],[.68,.3,.5]],seated:[[.33,.26,.35],[.67,.26,.35]],
      orator:[[.19,.3,.72],[.7,.42,.58]],processional:[[.3,.36,.58],[.69,.48,.43]],benediction:[[.31,.38,.5],[.68,.31,.84]],
      laureate:[[.38,.39,.62],[.65,.43,.47]],mantled_scholar:[[.43,.26,.46],[.58,.27,.47]],
      victorious:[[.28,.38,.9],[.68,.46,.48]],lyrist:[[.35,.28,.58],[.53,.25,.56]]}[s.pose]||[[.3,.4,.5],[.7,.4,.5]];
    for(let i=0;i<2;i++){
      const hand=hands[i].map((v,j)=>v+(j===2?Math.max(0,Math.min(1,s.activation||0))*.05:0)),shoulder=[(i?.62:.38)+(refined?sway*.15:0),.5,shoulderZ+(i?-tilt:tilt)];
      const elbow=shoulder.map((v,j)=>(v+hand[j])/2+(j===0?(i?.025:-.025):j===1?-.045:0));
      egg(shoulder,[.043,.042,.045]);tube(shoulder,elbow,.038,.025);egg(elbow,[.027,.027,.027]);tube(elbow,hand,.026,.017);
      const spacing=.012;
      egg(hand,[.024,.016,.024]);for(let f=0;f<4;f++)tube([hand[0]+(f-1.5)*spacing,hand[1]-.006,hand[2]-.008],
        [hand[0]+(f-1.5)*spacing,hand[1]-.018,hand[2]-.065+(f===0||f===3?.012:0)],.009,.008,.34/size);
      tube([hand[0]-.024,hand[1]-.005,hand[2]+.01],[hand[0]-.034,hand[1]-.028,hand[2]-.018],.01);
    }
    if(s.robe!=='armor'&&s.form!=='skeleton'){
      for(let z=size*.16|0;z<(hipZ+.07)*size;z++)for(let y=size*.27|0;y<size*.73;y++)for(let x=size*.25|0;x<size*.79;x++){
        const zz=(z+.5)/size,dx=(x+.5)/size-(.5+sway),dy=((y+.5)/size-.5)*1.35,a=Math.atan2(dy,dx);
        const r=.155-(zz-.16)*.16+(refined?(renaissance?.03:.026):.02)*Math.cos(a*(s.robe==='toga'?7:11)+zz*8);
        if(Math.hypot(dx,dy)<r)put(x,y,z);
      }
      if(s.robe==='toga'||s.robe==='mantle'){
        // Overlapping catenary folds: chest sling, hip swags, and the hanging mantle.
        for(let fold=0;fold<4;fold++)curve([.37,.43,shoulderZ+.02-fold*.025],[.46,.357,hipZ+.03-fold*.015],[.63,.44,hipZ+.1-fold*.023],.012,.016);
        for(let fold=0;fold<4;fold++)curve([.36,.46,hipZ+.03-fold*.015],[.47,.34,hipZ-.13-fold*.034],[.65,.49,hipZ-.04-fold*.025],.013,.01);
        for(let fold=0;fold<4;fold++)curve([.37+fold*.018,.53,shoulderZ],[.34+fold*.015,.6,hipZ+.07],[.34+fold*.025,.58,.2+fold*.01],.021,.013);
      }
      else for(let fold=0;fold<4;fold++)curve([.37+fold*.05,.44,shoulderZ-.005-fold*.01],
        [.48+fold*.025,.411,shoulderZ-.12],[.53+fold*.03,.437,hipZ+.065],.012,.016);
      if(refined){
        // Fold ridges converge on a fastening; spaces between them are real undercuts.
        egg([.39,.426,shoulderZ],[.019,.013,.018]);
        const folds=renaissance?6:4;
        for(let f=0;f<folds;f++)curve([.39,.435,shoulderZ-.016],
          [.45+f*.024,.38,hipZ+.09-f*.021],[.56+f*.018,.444,hipZ+.045-f*.022],.01,.009);
        for(let f=0;f<5;f++)curve([.36+f*.052+sway,.46,hipZ+.02],
          [.34+f*.056+sway,.375,hipZ-.12],[.35+f*.056+sway,.44,.17],.013,.009);
      }
    }
    if(refined)headTransform=head;
    if(s.head==='helmet'){
      egg([head[0],head[1]+.01,head[2]+.045],[.067,.06,.043]);
      curve([head[0],head[1]-.035,head[2]+.066],[head[0],head[1]+.02,head[2]+.105],[head[0],head[1]+.075,head[2]+.046],.016,.011);
      for(const side of[-1,1])tube([head[0]+side*.055,head[1]-.015,head[2]+.025],[head[0]+side*.052,head[1]-.019,head[2]-.035],.013);
    }
    if(s.head==='hood')egg([head[0],head[1]+.025,head[2]+.015],[.072,.049,.08]);
    if(s.head==='laurel')for(let i=0;i<9;i++){const a=i*Math.PI/8;egg([head[0]+.06*Math.cos(a),head[1]+.05*Math.sin(a),head[2]+.045],[.017,.015,.012]);}
    if(!['helmet','hood'].includes(s.head)&&!['skeleton','wraith'].includes(s.form)){
      for(let i=0;i<11;i++){
        const a=i*Math.PI*2/11;egg([head[0]+.046*Math.cos(a),head[1]+.038*Math.sin(a),head[2]+.054],[.02,.018,.02]);
        if(Math.sin(a)>-.4)egg([head[0]+.055*Math.cos(a),head[1]+.052*Math.sin(a),head[2]+.027],[.015,.016,.02]);
      }
    }
    headTransform=null;
    if(s.wings!=='none')wings([.5,.57,shoulderZ],s.wings==='skeletal'||s.wings==='bone');
    if(s.hair==='blonde')for(const side of[-1,1])curve([head[0]+side*.045,.51,headZ+.04],[head[0]+side*.07,.54,headZ-.04],[head[0]+side*.08,.53,shoulderZ],.018,.014);
    const hand=hands[0],top=[hand[0],hand[1],Math.min(.96,hand[2]+.22)];
    if(['staff','sword','spear','lance','halberd','scythe','pick','club','mace','torch','dagger','sickle','harpoon'].includes(s.attribute)){
      tube([hand[0],hand[1],.13],top,.012);
      if(['scythe','sickle'].includes(s.attribute))curve(top,[top[0]+.14,top[1],top[2]+.01],[top[0]+.17,top[1],top[2]-.1],.014,.011);
      if(s.attribute==='pick')tube([top[0]-.1,top[1],top[2]-.04],[top[0]+.11,top[1],top[2]+.02],.013);
      if(['sword','dagger','lance'].includes(s.attribute))tube([hand[0]-.045,hand[1],hand[2]],[hand[0]+.045,hand[1],hand[2]],.012);
      if(['mace','club','torch'].includes(s.attribute))egg(top,[.028,.027,.045]);
    }
    if(s.attribute==='orb'||s.attribute==='bowl')egg(hand,[.055,.045,s.attribute==='orb'?.055:.02]);
    if(s.attribute==='book'){
      for(const side of[-1,1])for(let i=0;i<5;i++)tube([hand[0],hand[1]-.02,hand[2]-.03+i*.013],
        [hand[0]+side*.064,hand[1]-.036,hand[2]-.014+i*.013],.007);
    }
    if(s.attribute==='scroll')egg(hand,[.065,.022,.046]);
    if(s.attribute==='shield')egg([.7,.33,.54],[.09,.025,.13]);
    if(['bow','lyre','whip','chain','sling','net'].includes(s.attribute))curve([hand[0],hand[1],hand[2]-.15],[hand[0]+.15,hand[1],hand[2]],top,.012,.012);
    return out;
  }
  function paint(ctx,s,palette,box,size=64,traits={}){
    const voxels=build(size,s,traits),faces=[],project=([x,y,z])=>[(x+y-size)*.75,(x-y)*.24-z*.9];
    const base=palette.primary||'#c6bca6',rgb=base.match(/\w\w/g)?.map(v=>parseInt(v,16))||[198,188,166];
    for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(voxels[x+y*size+z*size*size]){
      for(const[axis,sign]of[[0,1],[1,-1],[2,1]]){
        const n=[x,y,z];n[axis]+=sign;if(n.every(v=>v>=0&&v<size)&&voxels[n[0]+n[1]*size+n[2]*size*size])continue;
        const u=(axis+1)%3,v=(axis+2)%3,points=[];
        for(const[a,b]of[[0,0],[1,0],[1,1],[0,1]]){const p=[x,y,z];p[axis]+=sign>0?1:0;p[u]+=a;p[v]+=b;points.push(project(p));}
        faces.push({points,depth:x-y+z*.533,shade:axis===2?1.15:axis===1?.94:.67});
      }
    }
    faces.sort((a,b)=>a.depth-b.depth);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const f of faces)for(const[x,y]of f.points){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    const width=maxX-minX,height=maxY-minY,scale=Math.min(box.width/width,box.height/height);
    ctx.save();ctx.translate(box.x+(box.width-width*scale)/2-minX*scale,box.y+box.height-height*scale-minY*scale);ctx.scale(scale,scale);
    for(const f of faces){ctx.fillStyle='rgb('+rgb.map(v=>Math.min(255,Math.round(v*f.shade))).join(',')+')';ctx.beginPath();f.points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
    ctx.restore();
  }
  return{poses,build,paint};
});
