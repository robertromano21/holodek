'use strict';
// Generate the distributable source diff against the untouched local archive.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),tar=process.argv[2]||'C:/Program Files/C64/Vice/vice-3.1.tar.gz';
const files=['src/sid/sid.h','src/sid/sid.c','src/sid/resid.cc','src/sid/sid-resources.c','src/sid/sid-cmdline-options.c','src/sid/sid-snapshot.c','src/sound.c'];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vice-diff-'));let patch='';
for(const file of files){
  const before=spawnSync('tar',['-xOf',tar,'vice-3.1/'+file],{encoding:'utf8'});if(before.status)throw Error('Could not read original '+file);
  const original=path.join(temp,'old'),current=path.join(temp,'new');fs.writeFileSync(original,before.stdout.replace(/\r\n/g,'\n'));
  fs.writeFileSync(current,fs.readFileSync(path.join(root,'.retort-data/vice10582/vice-3.1',file),'utf8').replace(/\r\n/g,'\n'));
  const diff=spawnSync('git',['diff','--no-index','--no-ext-diff','--',original,current],{encoding:'utf8'});
  if(diff.status!==1)throw Error('Expected changes for '+file);
  patch+=diff.stdout.replace(/^diff --git .*$/m,'diff --git a/'+file+' b/'+file).replace(/^--- .*$/m,'--- a/'+file).replace(/^\+\+\+ .*$/m,'+++ b/'+file);
}
const out=path.join(root,'native/vice10582/vice-3.1.patch');fs.writeFileSync(out,patch);console.log(out);
