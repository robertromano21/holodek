(function(root){
  'use strict';
  const installed=new WeakMap();
  function processorModule(){
  class SidQueueProcessor extends AudioWorkletProcessor {
    constructor(){
      super();this.queue=[];this.offset=0;this.fraction=0;this.paused=true;this.epoch=0;this.end=false;this.played=0;this.pending=0;this.started=false;this.rates=[{frame:0,value:1}];this.stopFrame=Infinity;
      this.port.onmessage=({data:d})=>{
        if(d.action==='connect'){this.synthesis=d.port;this.synthesis.onmessage=({data:chunk})=>this.receive(chunk);}
        if(d.action==='reset'){this.queue=[];this.offset=0;this.fraction=0;this.epoch=d.epoch;this.played=0;this.end=false;this.paused=true;this.pending=0;this.started=false;this.stopFrame=Infinity;}
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
    state(){this.port.postMessage({consumed:true,epoch:this.epoch,played:this.played,queued:this.queue.length,pending:this.pending});}
    receive(d){
      if(d.epoch!==this.epoch)return;
      if(d.error){this.started=false;this.paused=true;this.port.postMessage(d);return;}
      if(d.chunk){this.pending--;if(d.chunk.length)this.queue.push(d.chunk);this.end=d.end;this.fill();this.state();}
    }
    process(inputs,outputs){
      const out=outputs[0][0];if(this.paused)return true;
      while(this.rates.length>1&&this.rates[1].frame<=currentFrame)this.rates.shift();
      for(let i=0;i<out.length;i++){
        if(currentFrame+i<this.startFrame)continue;
        if(currentFrame+i>=this.stopFrame){this.paused=true;this.port.postMessage({ended:true,epoch:this.epoch});break;}
        const chunk=this.queue[0];if(!chunk)break;
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
        if(d.epoch!==this.epoch||this.disposed)return;
        if(d.error){this.fail(Error(d.error));return;}
        if(d.consumed){this.played=d.played;this.queued=d.queued;this.pending=d.pending;}
        if(d.ended){this.paused=true;this.played=Math.round((this.duration-this.base)*context.sampleRate);this.onended?.();}
      };
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
    fail(error){if(this.disposed||this.failed)return;this.failed=true;this.reject?.(error);this.resolve=this.reject=null;this.pause();this.worker.terminate();this.onError(error);}
    dispose(){if(this.disposed)return;this.disposed=true;this.reject?.(new DOMException('SID player closed','AbortError'));this.resolve=this.reject=null;this.worker.terminate();this.node.disconnect();this.node.port.close();this.gain.disconnect();}
  }
  root.HolodekSidPlayer={open:Player.open,Player};
})(typeof window==='object'?window:globalThis);
