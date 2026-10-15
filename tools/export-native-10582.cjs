'use strict';
const fs=require('node:fs'),path=require('node:path'),Archive=require('../retort/sidArchive'),Native=require('../retort/sid10582Native');
const input=process.argv[2]||path.join(Archive.DIRECTORY,'the-ashen-lullaby-6a0f67dcc72885a5');
const manifest=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'))),classic=fs.readFileSync(path.join(input,'8580.sid'));
const song=Native.compile(fs.readFileSync(path.join(input,'song_sid.asm'),'utf8').replace(/\r\n/g,'\n'),classic,manifest.palette),proof=Native.proof(classic);
const out=path.resolve('.retort-data/vice10582/auditions',manifest.id);fs.mkdirSync(out,{recursive:true});
for(const [name,entry]of [['10582-native',song],['register-only-proof',proof]]){fs.writeFileSync(path.join(out,name+'.sid'),entry.sid);fs.writeFileSync(path.join(out,name+'.asm'),entry.assembly);}
fs.copyFileSync(path.join(input,'8580.sid'),path.join(out,'8580.sid'));
console.log(JSON.stringify({directory:out,title:manifest.title,seconds:manifest.seconds,nativeBytes:song.sid.length,requires:'VSID experimental model 261 (-sidenginemodel 261 -keepenv)'},null,2));
