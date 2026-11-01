'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');let child,report,stderr='';
const server=http.createServer((req,res)=>{
  if(req.url==='/report'&&req.method==='POST'){
    let text='';req.on('data',b=>text+=b);req.on('end',()=>{try{report=JSON.parse(text);res.end('ok');child?.kill();}catch{res.writeHead(400);res.end();}});return;
  }
  const file=req.url==='/'?'tests/genre-lighting-probe.html':/^\/assets\/[\w.-]+\.js$/.test(req.url)?req.url.slice(1):null;
  if(!file){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',file.endsWith('.html')?'text/html':'text/javascript');fs.createReadStream(path.join(root,file)).pipe(res);
});
server.listen(0,'127.0.0.1',()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'holodek-fixtures-'));
  const args=['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--user-data-dir='+profile,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','http://127.0.0.1:'+server.address().port+'/'];
  if(process.argv.includes('--software'))args.unshift('--disable-gpu','--use-angle=swiftshader','--enable-unsafe-swiftshader');
  child=spawn(process.env.GPU_PROBE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args,{windowsHide:true});
  child.stderr.on('data',b=>stderr=(stderr+b).slice(-4000));const timer=setTimeout(()=>child.kill(),90000);
  child.on('error',e=>{clearTimeout(timer);console.error(e.message);server.close();process.exitCode=1;});
  child.on('close',()=>{
    clearTimeout(timer);
    if(report?.png){const dir=path.join(root,'logs/probes');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'genre-lighting.png'),Buffer.from(report.png.split(',')[1],'base64'));delete report.png;}
    console.log(JSON.stringify(report||{pass:false,error:'No renderer report',stderr},null,2));
    process.exitCode=report?.pass?0:1;server.closeAllConnections();server.close();
  });
});
