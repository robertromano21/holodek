'use strict';
const {Recorder,createEngine,withGain}=require('./registerScore'),{cutHz,CLK}=require('./jsid');
const SHAPES={sight:[.75,-3,4],pain:[.5,8,-1],death:[2.1,6,-12],attack:[.26,-2,-5],laugh:[.65,5,1],sigh:[.95,0,-4],grunt:[.22,-5,-7],hiss:[.8,0,0]};
function compile(P,what,{chip='10582',mode='2x'}={}){
  if(!Object.hasOwn(SHAPES,what))throw Error('Unknown SID vocalization');
  const [duration,start,end]=SHAPES[what],mult=mode==='1x'?1:mode==='4x'?4:2,rate=mult===1?22050:44100,hz=800,nTicks=Math.ceil((duration+.12)*hz),samples=Math.round(nTicks*rate/hz);
  const r=new Recorder({chips:3,model:chip,sampleRate:rate,clock:CLK*mult,cut:mult,hz,nTicks,samples,exact:true,fadeSamples:Math.round(.01*rate)});
  const centers=what==='grunt'?[350,800,2200]:what==='hiss'?[2500,4500,6500]:[700,1200,2600];
  function cutoff(hz){let lo=0,hi=2047;while(lo<hi){const m=(lo+hi)>>1;if(cutHz(m)*(1+(mult-1)*m/2047)<hz)lo=m+1;else hi=m;}return lo;}
  for(let n=0;n<nTicks;n++){
    const t=n/hz,p=Math.min(1,t/duration),frequency=P.f0*Math.pow(2,(start+(end-start)*p)/12),f=Math.min(65535,Math.round(frequency*16777216/(CLK*mult)));
    let level=t<duration?Math.min(1,t/.012)*Math.min(1,(duration-t)/.08):0;
    if(what==='laugh')level*=Math.max(0,Math.sin(t/.17*Math.PI));
    const writes=[];
    for(let c=0;c<3;c++){
      const center=Math.round(Math.min(10000,centers[c]*(P.fs||1)*(1-.15*p))),cut=cutoff(center);
      if(n===0)writes.push([c,5,0],[c,6,240],[c,23,0x71],[c,24,47]);
      writes.push([c,0,f&255],[c,1,f>>8],[c,4,what==='hiss'?129:33],[c,21,cut&7],[c,22,cut>>3]);
      if(chip==='10582'){
        if(what==='hiss'){const noise=Math.round(3800*16777216/(CLK*mult));writes.push([c,14,noise&255],[c,15,noise>>8],[c,18,128]);}
        writes.push([c,25,0],[c,31,what==='hiss'?3:1],[c,32,center&255],[c,33,center>>8],[c,34,40+c*15],[c,35,Math.round(55*level)]);
      }
      else writes.push([c,24,32|Math.round(12*level)]);
    }r.tick(writes);
  }
  const score=r.finish(),engine=createEngine(score,{sampleRate:rate});let peak=1e-9;
  for(let at=0;at<samples;at+=rate)for(const x of engine.read(Math.min(rate,samples-at)))peak=Math.max(peak,Math.abs(x));
  return{score:withGain(score,Math.min(4,.6/peak)),dur:samples/rate};
}
module.exports={compile,SHAPES};
