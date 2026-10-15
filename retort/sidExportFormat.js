'use strict';
// Private, versioned metadata appended to unused PSID payload RAM. The C64
// player never references it; ordinary players play only the three-voice core.
const MAGIC='HDK10582',encoder=new TextEncoder(),decoder=new TextDecoder();
function split(input){
  const bytes=new Uint8Array(input.buffer||input,input.byteOffset||0,input.byteLength);
  if(bytes.length<12||decoder.decode(bytes.subarray(-8))!==MAGIC)return{core:bytes,extension:null};
  const size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(bytes.length-12,true);
  if(size>4096||size<2||size>bytes.length-130)throw Error('Invalid 10582 extension length');
  const at=bytes.length-12-size,extension=JSON.parse(decoder.decode(bytes.subarray(at,at+size)));
  if(extension.format!=='holodek-10582'||extension.version!==1)throw Error('Unsupported 10582 export version');
  return{core:bytes.subarray(0,at),extension};
}
function attach(input,metadata){
  const {core}=split(input),extra=encoder.encode(JSON.stringify({...metadata,format:'holodek-10582',version:1}));
  if(extra.length>4096)throw Error('10582 export metadata too large');
  const out=new Uint8Array(core.length+extra.length+12);out.set(core);out.set(extra,core.length);
  new DataView(out.buffer).setUint32(out.length-12,extra.length,true);out.set(encoder.encode(MAGIC),out.length-8);
  return out;
}
module.exports={split,attach};
