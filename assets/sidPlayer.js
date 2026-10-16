(function(root){
  'use strict';
  const installed=new WeakMap();
  const players=new Set(),lifecycle={opened:0,disposed:0,failed:0,retired:0};
  function processorModule(){
  class SidQueueProcessor extends AudioWorkletProcessor {
    constructor(){
      super();this.queue=[];this.offset=0;this.fraction=0;this.paused=true;this.epoch=0;this.end=false;this.played=0;this.pending=0;this.started=false;this.rates=[{frame:0,value:1}];this.stopFrame=Infinity;
      this.port.onmessage=({data:d})=>{
        if(d.action==='close'){
          this.closed=true;this.started=false;this.paused=true;this.queue=[];this.pending=0;
          if(this.synthesis){this.synthesis.onmessage=null;this.synthesis.close();this.synthesis=null;}
          this.port.postMessage({closed:true});return;
        }
        if(this.closed)return;
        if(d.action==='connect'){this.synthesis=d.port;this.synthesis.onmessage=({data:chunk})=>this.receive(chunk);}
        if(d.action==='reset'){this.queue=[];this.offset=0;this.fraction=0;this.epoch=d.epoch;this.played=0;this.end=false;this.paused=true;this.pending=0;this.started=false;this.stopFrame=Infinity;this.underruns=0;this.missing=0;this.starved=false;this.reportFrame=0;}
        if(d.action==='start'&&d.epoch===this.epoch){this.started=true;this.fill();}
        if(d.action==='pause'){this.paused=d.value;this.startFrame=d.at||0;}
        if(d.action==='stop')this.stopFrame=d.at;
        if(d.action==='rate'){
          if(d.cancel!==undefined)this.rates=this.rates.filter(e=>e.frame<d.cancel);
          else this.rates.push(d.event);
          this.rates.sort((a,b)=>a.frame-b.frame);
        }
      };
    }
    fill(){while(this.synthesis&&this.started&&!this.end&&this.pending+this.queue.length<12){this.pending++;this.synthesis.postMessage({action:'pull',epoch:this.epoch});}}
    state(){this.port.postMessage({consumed:true,epoch:this.epoch,played:this.played,queued:this.queue.length,pending:this.pending,underruns:this.underruns||0,missing:this.missing||0});}
    receive(d){
      if(this.closed||d.epoch!==this.epoch)return;
      if(d.error){this.started=false;this.paused=true;this.port.postMessage(d);return;}
      if(d.chunk){this.pending--;if(d.chunk.length)this.queue.push(d.chunk);this.end=d.end;this.fill();this.state();}
    }
    process(inputs,outputs){
      // Disconnecting a node is not enough: false permanently retires its processor.
      if(this.closed)return false;
      const out=outputs[0][0];if(this.paused)return true;
      while(this.rates.length>1&&this.rates[1].frame<=currentFrame)this.rates.shift();
      for(let i=0;i<out.length;i++){
        if(currentFrame+i<this.startFrame)continue;
        if(currentFrame+i>=this.stopFrame){this.paused=true;this.port.postMessage({ended:true,epoch:this.epoch});break;}
        const chunk=this.queue[0];if(!chunk){
          if(!this.end){if(!this.starved){this.underruns=(this.underruns||0)+1;this.starved=true;}
            this.missing=(this.missing||0)+out.length-i;
            if(currentFrame-(this.reportFrame||0)>=sampleRate){this.reportFrame=currentFrame;this.state();}}
          break;
        }
        this.starved=false;
        const next=this.offset+1<chunk.length?chunk[this.offset+1]:this.queue[1]?.[0]??chunk[this.offset];
        out[i]=chunk[this.offset]+(next-chunk[this.offset])*this.fraction;
        let previous={frame:0,value:1},upcoming;
        for(const event of this.rates){if(event.frame>currentFrame+i){upcoming=event;break;}previous=event;}
        const rate=upcoming?.linear?previous.value+(upcoming.value-previous.value)*(currentFrame+i-previous.frame)/(upcoming.frame-previous.frame):previous.value;
        this.fraction+=rate;
        while(this.fraction>=1&&this.queue.length){this.fraction--;this.offset++;this.played++;
          if(this.offset===this.queue[0].length){this.queue.shift();this.offset=0;this.fill();this.state();}}
        if(!this.queue.length)this.fraction=0;
      }
      if(!this.queue.length&&this.end){this.paused=true;this.port.postMessage({ended:true,epoch:this.epoch});}
      return true;
    }
  }
  registerProcessor('holodek-sid-queue',SidQueueProcessor);
  }
  // The processor class is serialized, not evaluated on the page's main thread.
  const workletSource='('+processorModule.toString()+')();';
  async function install(context){
    if(!context.audioWorklet)throw Error('Live SID needs AudioWorklet. Open this page on localhost or HTTPS in a modern browser.');
    if(!installed.has(context)){
      // data: modules also load when the self-contained workshop has an opaque file: origin.
      const promise=context.audioWorklet.addModule('data:text/javascript;charset=utf-8,'+encodeURIComponent(workletSource));installed.set(context,promise);
      promise.catch(()=>installed.delete(context));
    }
    await installed.get(context);
  }
  class RateParam{
    constructor(player){this.player=player;this.events=[];}
    get value(){const time=this.player.context.currentTime;let previous={time:0,value:1};for(const e of this.events){if(e.time>time)return e.linear?previous.value+(e.value-previous.value)*(time-previous.time)/(e.time-previous.time):previous.value;previous=e;}return previous.value;}
    set value(value){this.setValueAtTime(value,this.player.context.currentTime);}
    event(value,time,linear){if(!Number.isFinite(value)||value<.25||value>4||!Number.isFinite(time))throw Error('SID playback rate must be 0.25-4');
      this.events.push({value,time,linear});this.events.sort((a,b)=>a.time-b.time);this.player.node.port.postMessage({action:'rate',event:{value,frame:Math.round(time*this.player.context.sampleRate),linear}});return this;}
    setValueAtTime(value,time){return this.event(value,time,false);}
    linearRampToValueAtTime(value,time){return this.event(value,time,true);}
    cancelScheduledValues(time){this.events=this.events.filter(e=>e.time<time);this.player.node.port.postMessage({action:'rate',cancel:Math.round(time*this.player.context.sampleRate)});return this;}
  }
  class Player {
    static async open(bytes,{context,destination,source,seconds,subtune=1,loop=true,time=0,clock,model='auto',onError=()=>{}}={}){
      await install(context);
      const player=new Player(context,destination||context.destination,source,onError);
      try{await player.request({action:'open',bytes,seconds,subtune,loop,time,clock,model,sampleRate:context.sampleRate});return player;}
      catch(error){player.dispose();throw error;}
    }
    constructor(context,destination,source,onError){
      this.context=context;this.paused=true;this.disposed=false;this.duration=0;this.base=0;this.played=0;this.epoch=0;this.pending=0;this.volume=1;this.info=null;
      this.underruns=0;this.missing=0;this.lastUpdate=0;
      this.gain=context.createGain();this.gain.connect(destination);
      this.node=new AudioWorkletNode(context,'holodek-sid-queue',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});this.node.connect(this.gain);
      this.playbackRate=new RateParam(this);
      const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));this.worker=new Worker(url);URL.revokeObjectURL(url);
      this.onError=onError;
      // Buffer demand bypasses the main/UI thread, which can be busy constructing a room.
      const channel=new MessageChannel();this.node.port.postMessage({action:'connect',port:channel.port1},[channel.port1]);this.worker.postMessage({action:'connect',port:channel.port2},[channel.port2]);
      this.worker.onerror=e=>this.fail(Error(e.message));
      this.node.onprocessorerror=()=>this.fail(Error('SID audio processor failed'));
      this.worker.onmessage=({data:d})=>{
        if(this.disposed||this.failed||d.epoch!==this.epoch)return;
        if(d.error){this.fail(Error(d.error));return;}
        if(d.ready){this.duration=d.seconds;this.info=d.info;this.model=d.model;this.base=d.position/context.sampleRate;this.played=0;this.pending=0;this.end=false;this.resolve?.();this.resolve=this.reject=null;this.fill();this.node.port.postMessage({action:'pause',value:this.paused});}
      };
      this.node.port.onmessage=({data:d})=>{
        if(d.closed){this.processorClosed=true;lifecycle.retired++;this.node.port.close();return;}
        if(d.epoch!==this.epoch||this.disposed)return;
        if(d.error){this.fail(Error(d.error));return;}
        if(d.consumed){this.played=d.played;this.queued=d.queued;this.pending=d.pending;this.underruns=d.underruns||0;this.missing=d.missing||0;this.lastUpdate=Date.now();}
        if(d.ended){this.paused=true;this.played=Math.round((this.duration-this.base)*context.sampleRate);this.onended?.();}
      };
      players.add(this);lifecycle.opened++;
    }
    get currentTime(){return this.duration?Math.min(this.duration,(this.base+this.played/this.context.sampleRate)%this.duration):0;}
    set currentTime(time){this.seek(time).catch(error=>{if(error.name!=='AbortError')this.fail(error);});}
    get volume(){return this._volume??1;}
    set volume(value){this._volume=Math.max(0,Math.min(1,value));if(this.gain)this.gain.gain.setTargetAtTime(this._volume,this.context.currentTime,.02);}
    fill(){if(!this.disposed&&!this.seeking)this.node.port.postMessage({action:'start',epoch:this.epoch});}
    request(message){
      if(this.disposed)return Promise.reject(Error('SID player closed'));
      this.reject?.(new DOMException('SID seek superseded','AbortError'));
      this.epoch++;this.queued=0;this.pending=0;this.seeking=true;
      this.node.port.postMessage({action:'reset',epoch:this.epoch});
      return new Promise((resolve,reject)=>{
        this.resolve=()=>{this.seeking=false;resolve();};this.reject=reject;
        this.worker.postMessage({...message,epoch:this.epoch});
      });
    }
    seek(time){return this.request({action:'seek',time});}
    async play(at=this.context.currentTime){if(this.disposed)throw Error('SID player closed');this.context.resume().catch(error=>this.fail(error));this.paused=false;this.node.port.postMessage({action:'pause',value:false,at:Math.round(at*this.context.sampleRate)});}
    pause(){this.paused=true;this.node.port.postMessage({action:'pause',value:true});}
    stop(at=this.context.currentTime){this.node.port.postMessage({action:'stop',at:Math.round(at*this.context.sampleRate)});}
    stats(){return{kind:this.info?.kind||'sid-music',model:this.model,paused:this.paused,failed:!!this.failed,time:this.currentTime,queued:this.queued||0,pending:this.pending||0,bufferMs:Math.round((this.queued||0)*2048/this.context.sampleRate*1000),underruns:this.underruns,missingMs:Math.round(this.missing/this.context.sampleRate*1000),lastUpdateMs:this.lastUpdate?Date.now()-this.lastUpdate:null};}
    fail(error){if(this.disposed||this.failed)return;this.failed=true;lifecycle.failed++;this.error=error.message;this.reject?.(error);this.resolve=this.reject=null;this.dispose();this.onError(error);}
    dispose(){if(this.disposed)return;this.disposed=true;this.paused=true;players.delete(this);lifecycle.disposed++;this.reject?.(new DOMException('SID player closed','AbortError'));this.resolve=this.reject=null;this.worker.terminate();this.node.port.postMessage({action:'close'});this.node.disconnect();this.gain.disconnect();}
  }
  // Short effects are synthesized from registers once, then triggered from RAM.
  // Music, ambience and speech continue to use the streaming Player above.
  class EffectCache {
    constructor(context,source,{maxBytes=12*1024*1024}={}){
      if(!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)throw Error('Invalid SID effect cache budget');
      this.context=context;this.maxBytes=maxBytes;this.bytes=0;this.sequence=0;this.buffers=new Map();this.loading=new Map();this.pending=new Map();this.builds=0;this.hits=0;
      const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));this.worker=new Worker(url);URL.revokeObjectURL(url);
      this.worker.onerror=e=>this.dispose(Error(e.message||'SID effect worker failed'));
      this.worker.onmessage=({data:d})=>{
        const job=this.pending.get(d.id);if(!d.effectBuffer||!job)return;this.pending.delete(d.id);clearTimeout(job.timer);
        if(d.error){job.reject(Error(d.error));return;}
        try{
          if(d.sampleRate!==context.sampleRate||!Number.isFinite(d.seconds)||d.seconds<=0||d.seconds>8||!d.samples?.byteLength||d.samples.byteLength%4||d.samples.byteLength!==Math.round(d.seconds*d.sampleRate)*4)throw Error('Invalid cached SID effect samples');
          const samples=new Float32Array(d.samples);if(!samples.every(Number.isFinite))throw Error('Non-finite SID effect samples');
          const buffer=context.createBuffer(1,samples.length,d.sampleRate);buffer.copyToChannel(samples,0);this.builds++;
          if(d.samples.byteLength<=this.maxBytes){this.buffers.set(job.key,buffer);this.bytes+=d.samples.byteLength;
            while(this.bytes>this.maxBytes||this.buffers.size>64){const key=this.buffers.keys().next().value;this.bytes-=this.buffers.get(key).length*4;this.buffers.delete(key);}}
          job.resolve(buffer);
        }catch(error){job.reject(error);}
      };
    }
    get(key,bytes){
      if(this.disposed)return Promise.reject(Error('SID effect cache closed'));
      if(this.buffers.has(key)){const buffer=this.buffers.get(key);this.buffers.delete(key);this.buffers.set(key,buffer);this.hits++;return Promise.resolve(buffer);}
      if(this.loading.has(key))return this.loading.get(key);
      const id=++this.sequence,promise=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('SID effect preparation timed out'));},15000);
        this.pending.set(id,{key,resolve,reject,timer});try{this.worker.postMessage({action:'effect-buffer',id,bytes,sampleRate:this.context.sampleRate});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
      });
      this.loading.set(key,promise);const done=()=>this.loading.delete(key);promise.then(done,done);return promise;
    }
    stats(){return{entries:this.buffers.size,bytes:this.bytes,building:this.pending.size,builds:this.builds,hits:this.hits};}
    dispose(error=new DOMException('SID effect preparation cancelled','AbortError')){
      if(this.disposed)return;this.disposed=true;this.worker.terminate();
      for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(error);}this.pending.clear();this.loading.clear();this.buffers.clear();this.bytes=0;
    }
  }
  root.HolodekSidPlayer={open:Player.open,Player,EffectCache,stats:()=>({...lifecycle,active:players.size,players:[...players].map(p=>p.stats())})};
})(typeof window==='object'?window:globalThis);
