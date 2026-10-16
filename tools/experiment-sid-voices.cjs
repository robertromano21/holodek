'use strict';
// Offline one-factor experiments. Reuses hash-verified Piper takes, never the game.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{Worker,isMainThread,parentPort}=require('node:worker_threads');
// Keep the measured control fixed when production Soft evolves.
const BASELINE_K=Object.freeze({smoothLevels:true,gamH:1,gamH1:1,vtF:2400,vtilt:2});
const VARIANTS={
  soft:{factor:'listening-selected baseline',k:{},env:{}},
  release_bed:{factor:'stop release: fixed high-noise bed attenuation 11 -> 7 dB',k:{bedDb:7},env:{}},
  transition_gaps:{factor:'vowel/consonant boundary: preserve measured unvoiced gaps',k:{gapMin:0},env:{SIDVOICE_GAP:'0'}},
  noise_less:{factor:'harmonic/noise balance: noise gain 0.45 -> 0.36',k:{gNv:.36},env:{}},
  noise_more:{factor:'harmonic/noise balance: noise gain 0.45 -> 0.54',k:{gNv:.54},env:{}}
};
function workerEnvironment(variant,base=process.env){
  return{...base,...variant.env,SIDVOICE_K:JSON.stringify({...JSON.parse(base.SIDVOICE_K||'{}'),...variant.k})};
}
if(!isMainThread){
  const Voc=require('../retort/sidVoice/voc64');
  parentPort.on('message',item=>{
    try{const samples=Voc.render({...item,chip:'10582',mode:'2x',k:BASELINE_K,captureRegisters:true});
      parentPort.postMessage({samples,score:samples.registerScore,sr:samples.sr,articulation:samples.articulation,version:Voc.VERSION},[samples.buffer,samples.registerScore.buffer]);
    }catch(error){parentPort.postMessage({error:error.stack});}
  });
}else{
  const {readTake,pcm,page}=require('./audition-sid-voices.cjs'),Analysis=require('../retort/sidVoice/analyse'),Mood=require('../retort/sidVoice/mood'),Score=require('../retort/sidVoice/registerScore');
  function renderer(variant){
    const worker=new Worker(__filename,{env:workerEnvironment(variant)});
    return{worker,render:item=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{cleanup();reject(Error('Experiment render timed out'));},60000);
      const cleanup=()=>{clearTimeout(timer);worker.removeListener('message',done);worker.removeListener('error',fail);};
      const done=result=>{cleanup();result.error?reject(Error(result.error)):resolve(result);},fail=error=>{cleanup();reject(error);};
      worker.once('message',done);worker.once('error',fail);worker.postMessage(item);
    })};
  }
  async function main(){
    const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);if(i<0)return null;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing '+key+' value');return args[i+1];};
    const sourceFile=path.resolve(value('--manifest')||'sid/voice-auditions/smoothing-20261015/manifest-corpus.json');
    const out=path.resolve(value('--out')||'sid/voice-auditions/clarity-20261015'),selected=(value('--variants')||Object.keys(VARIANTS).join(',')).split(',');
    if(selected[0]!=='soft')throw Error('Soft baseline must be rendered first for matched levels.');
    if(selected.some(v=>!VARIANTS[v])||!selected.includes('soft'))throw Error('Select supported variants including soft: '+Object.keys(VARIANTS).join(','));
    if(fs.existsSync(out)&&fs.readdirSync(out).length)throw Error('Use an empty experiment directory: '+out);
    const source=JSON.parse(fs.readFileSync(sourceFile,'utf8'));if(!source.characters?.length)throw Error('No frozen takes');
    const takes=source.characters.map(c=>{if(!c.takeFile)throw Error('Manifest needs --save-takes sources');const file=path.resolve(path.dirname(sourceFile),c.takeFile);return{c,file,take:readTake(file,c.sourceHash)};});
    const rendererFiles=['voc64.js','analyse.js','articulation.js','cons.js','jsid.js','registerScore.js','timbre.js'];
    const rendererHashes=Object.fromEntries(rendererFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../retort/sidVoice',file))).digest('hex')]));
    const manifest={version:3,createdAt:new Date().toISOString(),synthesis:'oscillators-noise-filters-only; pre-promotion Soft baseline',mode:'2x',hasAnalysisReference:true,sourceManifest:sourceFile,rendererHashes,baselineControls:BASELINE_K,
      experiments:Object.fromEntries(selected.map(name=>[name,VARIANTS[name]])),characters:[]};
    fs.mkdirSync(out,{recursive:true});const renderers={};
    try{
      for(const name of selected)renderers[name]=renderer(VARIANTS[name]);
      for(const {c,file,take}of takes){
        const frames=Analysis.analyse(take.audio),noiseFrames=Analysis.analyseNoise(take.audio),cad=Mood.cadenceOf(c.text);
        const item={P:c.effectiveProfile,frames,noiseFrames,phones:take.phones,syl:take.syl,ph:take.ph,cad,final:/\?\s*$/.test(c.text)?'?':'.'};
        const stem=(c.name+'-'+c.line).toLowerCase().replace(/[^a-z0-9]+/g,'-'),character={...c,takeFile:path.relative(out,file),variants:{}};
        const reference=pcm(take.audio,take.sr),referenceFile=stem+'-reference.wav';fs.writeFileSync(path.join(out,referenceFile),reference.wav);
        character.variants.reference={file:referenceFile,...reference.metrics,synthesis:'Piper diagnostic reference only'};
        let target=c.variants.soft?.rms||c.variants.detail?.rms||null;
        for(const name of selected){
          const start=Date.now(),result=await renderers[name].render(item),output=pcm(result.samples,result.sr,c.effectiveProfile.loud,target);
          if(name==='soft'&&target==null)target=output.metrics.rms;
          const wav=stem+'-'+name+'.wav',liveFile=stem+'-'+name+'.sidvoice';fs.writeFileSync(path.join(out,wav),output.wav);
          fs.writeFileSync(path.join(out,liveFile),Score.withGain(result.score,output.metrics.gain));
          character.variants[name]={file:wav,liveFile,...output.metrics,rendererVersion:result.version,articulation:result.articulation,renderMs:Date.now()-start,matchedTo:'soft',rmsDifferenceDb:20*Math.log10(output.metrics.rms/target)};
          console.log(c.name+'/'+c.line+': '+name+' '+character.variants[name].renderMs+' ms');
        }
        manifest.characters.push(character);fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
      }
      const intro='<p>Frozen-source clarity experiments. Soft is the baseline; each other column changes only its named subsystem. These are not edits to the running game. All variants share the exact source hash and character profile. Compare consonant clarity, buzz and comfort, not only recognizer scores.</p><ul>'+selected.map(name=>'<li>'+name+': '+VARIANTS[name].factor+'</li>').join('')+'</ul>';
      fs.writeFileSync(path.join(out,'index.html'),page(manifest).replace('<h1>10582 Voice Auditions</h1>','<h1>Frozen Voice Clarity Tests</h1>'+intro));
      console.log('Experiment page: '+path.join(out,'index.html'));
    }finally{await Promise.all(Object.values(renderers).map(r=>r.worker.terminate()));}
  }
  if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
}
module.exports={VARIANTS,BASELINE_K,workerEnvironment};
