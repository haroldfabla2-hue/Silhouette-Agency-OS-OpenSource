// Authored HTTP/IPC fixture, NOT Silhouette app or product auth acceptance.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
(async()=>{
 const { ownDesktopBackend } = await import('../../server/desktop/ownedBackendSession.js');
 const mode = process.argv[2];
 await ownDesktopBackend({handshakeMs:200,bootMs:150,shutdownMs:400,openBackend:async options=>{
  process.send({type:'fixture-booting'});
  if(mode==='hang-boot')await new Promise(()=>{});
  if(mode==='slow-reject'){await new Promise(r=>setTimeout(r,75));throw null;}
  if (mode==='boot-fail') throw null;
  const marker=path.join(process.cwd(),'opened');fs.writeFileSync(marker,'fixture initialized');
  let admitting=true;
  const server=http.createServer((req,res)=>{
   if(!admitting){res.writeHead(503);res.end();return;}
   if(req.headers.authorization!=='Bearer '+options.apiToken){res.writeHead(401);res.end('denied');return;}
   res.end('authored-fixture');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port, options.host,resolve);});
  if (mode==='slow-boot') await new Promise(r=>setTimeout(r,100));
  return {server,stopAdmission:()=>{admitting=false;fs.writeFileSync(path.join(process.cwd(),'admission-stopped'),'stopped');},authenticationReady:mode!=='bad-auth',drain:async()=>{
   if(!fs.existsSync(path.join(process.cwd(),'admission-stopped')))throw Error('admission order');
   if(mode==='hang-drain')await new Promise(()=>{});
   if(mode==='bad-drain')throw 'private fixture error';
   fs.writeFileSync(path.join(process.cwd(),'drained'),'fixture drained');
  }};
 }});
 if(mode==='reentry'){
  try{await ownDesktopBackend({openBackend:async()=>{throw Error('must not execute');}});process.send({type:'fixture-reentry',rejected:false});}
  catch(error){process.send({type:'fixture-reentry',rejected:error.message==='DESKTOP_SESSION_ALREADY_OWNED'});}
 }
 process.send({type:'fixture-listening'});
})();
