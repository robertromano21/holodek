'use strict';
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url');
const classical=process.argv.includes('--classical'),out=path.resolve(__dirname,'../.retort-data/'+(classical?'classical-interiors/gpu':'city-skyline'));fs.mkdirSync(out,{recursive:true});
const browser=process.env.GPU_PROBE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-skyline-probe-')),args=['--headless=new','--no-first-run',
  '--allow-file-access-from-files','--enable-logging=stderr','--window-size=1380,1280','--virtual-time-budget=15000',
  '--user-data-dir='+profile,'--screenshot='+path.join(out,'skyline.png'),'--dump-dom',pathToFileURL(path.join(__dirname,'city-skyline-probe.html')).href+(classical?'?classical':'')];
if(process.argv.includes('--software'))args.unshift('--disable-gpu','--use-angle=swiftshader','--enable-unsafe-swiftshader');
const result=spawnSync(browser,args,{windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
fs.writeFileSync(path.join(out,'browser.log'),result.stderr||'');fs.writeFileSync(path.join(out,'browser.html'),result.stdout||'');
let report;try{report=JSON.parse(result.stdout.match(/<pre id="results"[^>]*>([^<]*)<\/pre>/)[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));}
catch{report={pass:false,error:result.error?.message||'Browser did not finish the isolated probe.'};}
const output={...report,status:result.status,rendererErrors:result.stderr?.split(/\r?\n/).filter(s=>/Shader compilation|Shader linking|CONTEXT_LOST/.test(s)).slice(-10)};
fs.writeFileSync(path.join(out,'gpu.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));process.exitCode=report.pass?0:1;
