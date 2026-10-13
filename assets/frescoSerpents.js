(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FrescoSerpents=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  function paint(ctx,raw,traits,palette){
    const color=traits.palette?.skin||palette.secondary||'#b9a16c',shadow=palette.shadow||'#3b3030',light=palette.highlight||'#e6d3a7';
    const pose=raw.pose||'standing',coiled=['seated','kneeling','mourning','contemplative'].includes(pose)||traits.ringdrake,
      flying=['invocation','flying','ascending','benediction'].includes(pose),skeletal=traits.covering==='bone';
    ctx.save();ctx.scale(ctx.canvas.width/96,ctx.canvas.height/96);
    const path=(points,fill,stroke=shadow,width=1)=>{ctx.beginPath();points.forEach((p,i)=>{
      if(i===0)ctx.moveTo(...p);else if(p.length===6)ctx.bezierCurveTo(...p);else ctx.lineTo(...p);
    });if(fill){ctx.closePath();ctx.fillStyle=fill;ctx.fill();}ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();};
    if(traits.carapace){
      // Turthus is a massive turtle dragon, not a winged serpent or a human sage.
      for(const [x,y]of[[25,61],[62,62],[31,75],[68,75]]){
        path([[x,y],[x-5,y+7],[x-6,y+12],[x+4,y+12],[x+6,y+3]],color,shadow,1);
        for(let i=0;i<3;i++)path([[x-4+i*3,y+10],[x-5+i*3,y+13]],null,light,.8);
      }
      path([[25,67],[8,61,8,82,4,86],[18,83,23,74,32,74]],color);
      path([[62,54],[64,31,78,29,80,36],[80,48,74,55,72,64]],color);
      path([[75,31],[84,29],[94,37],[91,42],[80,43],[75,38]],color);
      path([[77,31],[75,23],[82,30]],null,light,1.2);ctx.fillStyle=light;ctx.fillRect(85,34,2,2);
      path([[20,67],[14,24,68,17,77,61],[81,77,40,87,20,67]],color,shadow,2);
      path([[26,62],[24,30,62,27,70,59],[64,74,38,80,26,62]],null,light,1.5);
      for(const[x,y]of[[36,47],[54,44],[44,62],[64,60]])path([[x-8,y],[x-4,y-9],[x+6,y-8],[x+10,y+1],[x+3,y+8],[x-6,y+7],[x-8,y]],null,shadow,1.2);
      path([[27,70],[39,78],[58,77],[73,69]],null,light,1);ctx.restore();return;
    }
    // Two shoulder wings replace forearms. Long neck, small wedge head and tapering tail.
    for(const side of[-1,1]){
      const x=v=>48+side*v;
      const reach=flying?44:38;
      const fan=[[48,47],[x(16),31],[x(reach-5),7],[x(reach),51],
        [x(reach-9),42,x(26),40,x(25),50],[x(24),56],[x(17),45,x(11),44,x(8),55],[48,47]];
      path(fan,traits.wings==='bone'?null:color,shadow,.7);
      for(const end of[[x(reach),51],[x(24),56],[x(8),55]])path([[48,47],[x(reach-5),7],end],null,light,.65);
    }
    const body=coiled?[[47,43],[39,54,39,63,47,69],[64,80,81,74,81,66],[76,88,30,93,29,73],[28,61,39,49,43,43],[47,43]]:
      [[48,44],[41,56,43,68,53,72],[68,82,90,69,91,55],[93,82,71,94,51,79],[35,73,36,53,43,43],[48,44]];
    if(!skeletal)path(body,color);
    path([[46,44],[41,55,46,67,54,72],[66,82,77,68,82,60]],null,skeletal?color:light,skeletal?2:.65);
    if(skeletal)for(let i=0;i<7;i++){
      const y=45+i*3,x=44+i*.8;
      path([[x,y],[x-14,y-4,x-12,y+4,x-1,y+4]],null,light,1.25);
      path([[x,y],[x+13,y-4,x+13,y+4,x+1,y+4]],null,color,1.25);
    }
    const neck=pose==='bowing'||pose==='mourning'?[[44,45],[34,35,38,20,53,25],[65,30,57,37,51,36],[56,30,48,29,46,35],[44,45]]:
      [[44,46],[28,32,37,13,53,13],[61,12,63,17,60,22],[55,24,54,19,51,21],[40,26,45,37,51,44],[44,46]];
    path(neck,skeletal?null:color,skeletal?light:shadow,skeletal?1.3:1);
    const hx=pose==='bowing'||pose==='mourning'?57:59,hy=pose==='bowing'||pose==='mourning'?30:16;
    path([[hx-5,hy-3],[hx+2,hy-4],[hx+13,hy+1],[hx+4,hy+3],[hx+10,hy+5],[hx-3,hy+4],[hx-5,hy-3]],color);
    path([[hx-5,hy-3],[hx-9,hy-11],[hx-1,hy-4]],null,light,.9);
    ctx.fillStyle=shadow;ctx.fillRect(hx+2,hy,1,1);path([[hx+7,hy+3],[hx+13,hy+3]],null,shadow,.65);
    if(skeletal){ctx.fillRect(hx,hy-1,3,3);for(let i=0;i<4;i++)ctx.fillRect(hx+5+i*2,hy+3,1,2);}
    for(const side of[-1,1]){
      const x=side<0?43:53,kneeX=x+side*8,heelX=x+side*12;
      path([[x,60],[kneeX,69],[heelX,78],[heelX+side*5,flying?74:85]],null,shadow,4);
      path([[x,60],[kneeX,69],[heelX,78],[heelX+side*5,flying?74:85]],null,color,2.5);
      for(let i=0;i<3;i++)path([[heelX+side*5,flying?74:85],[heelX+side*(8+i),flying?76+i:87+i*.5]],null,light,.65);
    }
    if(traits.markings!=='none')for(let i=0;i<10;i++)path([[40+i*.9,46+i*2],[44+i*.9,48+i*2]],null,light,.45);
    if(traits.spikes)for(let i=0;i<6;i++)path([[35+i*.9,40+i*4],[30+i*.9,37+i*4],[36+i*.9,43+i*4]],color,light,.5);
    if(traits.ringdrake){
      for(const [x,y]of[[35,79],[65,79]]){ctx.strokeStyle='#c5a353';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.stroke();}
    }
    ctx.restore();
  }
  return{paint};
});
