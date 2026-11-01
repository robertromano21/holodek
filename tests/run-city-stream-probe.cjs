'use strict';
// Invoked by run-city-stream-probe.ps1 after the native test-session confirmation.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.retort-data/city-streaming');fs.mkdirSync(out,{recursive:true});
const Blocks=require('../retort/cityBlocks'),size=384,d={geoKey:'0,0,30',generation:{seed:'stream-city'},layout:{width:size,height:size},start:{x:192,y:192},cells:{},tiles:{},sceneStructures:[],lighting:{intensity:.65}};
for(let y=0;y<size;y++)for(let x=0;x<size;x++)d.cells[`${x},${y}`]={tile:!x||!y||x===size-1||y===size-1?'wall':'floor',floorHeight:0};
const site={id:'stream-city',name:'Authored City',design:{verticality:{floors:120}}};
Blocks.apply(d,{city:{}},site,{genre:'cyberpunk',scale:'metropolis'});d._geometryStamp='city-before';const before=structuredClone(d);
Blocks.apply(d,{city:{}},site,{genre:'cyberpunk',scale:'metropolis',stream:true,observer:{x:332,y:192}});d._geometryStamp='city-after';
d.cityCrowd={version:1,revision:1,actors:Object.fromEntries([0,1].map(i=>['probe-'+i,{id:'probe-'+i,name:'Probe Citizen '+i,race:'Human',sex:i?'Female':'Male',genre:'cyberpunk',role:'resident',status:'ambient',position:{x:332+i,y:200+i*2},seed:100+i}]))};
const fixture=JSON.stringify({before,after:d});let child,report,stderr='';
const server=http.createServer((req,res)=>{
  if(req.url==='/fixture'){res.setHeader('content-type','application/json');res.end(fixture);return;}
  if(req.url==='/report'&&req.method==='POST'){
    let body='';req.on('data',b=>{body+=b;if(body.length>12*1024*1024)req.destroy();});req.on('end',()=>{try{report=JSON.parse(body);res.end('ok');child?.kill();}catch{res.writeHead(400);res.end();}});return;
  }
  const file=req.url==='/'?'tests/city-stream-probe.html':/^\/assets\/[\w.-]+\.js$/.test(req.url)?req.url.slice(1):null;
  if(!file){res.writeHead(404);res.end();return;}res.setHeader('content-type',file.endsWith('.html')?'text/html':'text/javascript');fs.createReadStream(path.join(root,file)).pipe(res);
});
server.listen(0,'127.0.0.1',()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-city-3d-')),args=['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--user-data-dir='+profile,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','http://127.0.0.1:'+server.address().port+'/'];
  if(process.argv.includes('--software'))args.unshift('--disable-gpu','--use-angle=swiftshader','--enable-unsafe-swiftshader');
  child=spawn(process.env.GPU_PROBE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args,{windowsHide:true});
  child.stderr.on('data',b=>stderr=(stderr+b).slice(-4000));const timer=setTimeout(()=>child.kill(),90000);
  child.on('error',e=>{stderr=e.message;});
  child.on('close',code=>{
    clearTimeout(timer);report||={pass:false,error:'No production renderer report',exitCode:code,stderr};
    if(report.png){fs.writeFileSync(path.join(out,'city-stream-3d.png'),Buffer.from(report.png.split(',')[1],'base64'));delete report.png;}
    fs.writeFileSync(path.join(out,'3d-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    process.exitCode=report.pass?0:1;server.closeAllConnections();server.close();
  });
});
