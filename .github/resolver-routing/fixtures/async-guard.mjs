import boundary from './load-boundary.cjs';
import controls from './boundary-controls.cjs';
let port;let count=0;
export function initialize(data){
 port=data.port;boundary.install({asyncThread:true});port.postMessage({kind:'ASYNC_GUARD_READY'});
 port.on('message',message=>{if(message==='SNAPSHOT'){
  let result;try{result=controls.run();}catch{port.postMessage({kind:'ASYNC_GUARD_SNAPSHOT',controlsMatched:false,violations:boundary.snapshot()});return;}
  port.postMessage({kind:'ASYNC_GUARD_SNAPSHOT',controlsMatched:true,readCompileControls:result,violations:boundary.snapshot(),loads:boundary.loaded});
 }});
 port.unref();
}
export function load(url,context,nextLoad){
 if(++count>512)boundary.deny('ASYNC_LOAD_CAP','loads','R_ASYNC_LOAD_CAP',url);
 if(!url.startsWith('node:'))boundary.allowLoad(url);
 return nextLoad(url,context);
}
