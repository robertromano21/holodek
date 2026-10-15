'use strict';
const { Layer } = require('./sid10582');
const { mult } = require('./sidMode');
function designs() {
  const out = new Map(), add = loop => (name, length, fn, options = {}) => out.set(name, { loop, length, fn, options });
  const api = { shot:add(false), loop:add(true), midi:n=>440*2**((n-69)/12), ad:(a,d)=>a<<4|d, sr:(s,r)=>s<<4|r,
    rng:seed=>{let n=seed>>>0||1;return()=>((n=Math.imul(n,1664525)+1013904223>>>0)/4294967296);} };
  require('../tools/sfx-build/effects')(api);
  require('../tools/sfx-build/keyedStems')(api);
  require('../tools/sfx-build/voices')(api);
  return out;
}
const names = [...designs().keys()];
function render(name, seconds, clock) {
  const design = designs().get(name);
  if (!design) throw Error('No 10582 register design for '+name);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 30) throw Error('Effect duration must be 0..30 seconds.');
  const profile = /chant|drone|howl/.test(name) ? 'spectral_choir' : /drip|coin|pickup|heal|quest|notice/.test(name) ? 'glass_halo' : 'ember_air';
  const palette = { profile, depth:.25, motion:design.loop?'breath':'still', transients:design.loop?'soft':'crisp' };
  const sampleRate=mult(clock)>1?44100:22050, samples=new Float32Array(Math.round(seconds*sampleRate)), layer=new Layer(sampleRate,mult(clock),palette);
  let peak=0;
  for(let tick=0,at=0;at<samples.length;tick++){
    const t=tick/100, row=design.fn(Math.floor(t*50),Math.round(seconds*50)), v=row.v?.[0]||{};
    layer.frame({time:t,frequency:v.hz||0,gate:!!v.gate,envelope:v.gate?1:0,noise:v.wave==='noise',bar:t/4});
    const end=Math.min(samples.length,Math.round((tick+1)*sampleRate/100));
    layer.render(samples.subarray(at,end));
    for(let i=at;i<end;i++){
      const edge=Math.min(1,i/(sampleRate*.12),(samples.length-1-i)/(sampleRate*.18));
      samples[i]*=Math.max(0,edge); peak=Math.max(peak,Math.abs(samples[i]));
    }
    at=end;
  }
  if(peak>.18)for(let i=0;i<samples.length;i++)samples[i]*=.18/peak;
  return { samples, sampleRate, report:layer.report() };
}
module.exports={names,render,designs};
