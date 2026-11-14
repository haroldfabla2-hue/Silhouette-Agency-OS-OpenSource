import type { IncomingMessage, ServerResponse } from 'node:http';
/** Source-only diagnostic. No auth/header/body reads or alternate request path.
 * Disabled outside the explicitly isolated validation entry. No lifecycle fix.
 */
type Stage = 'INGRESS' | 'AUTH_ENTERED' | 'IDENTITY_IMPORT_STARTED' | 'IDENTITY_IMPORT_FULFILLED' | 'IDENTITY_READY' | 'HANDLER_ENTERED' | 'RESPONSE_FINISHED' | 'RESPONSE_CLOSED';
const enabled=process.env.SILHOUETTE_FINITE_IDENTITY_BOUNDARY==='source-fixed-v1';
const fixedPaths:Readonly<Record<string,string>>=Object.freeze({'/v1/identity/setup-status':'SETUP_STATUS','/v1/identity/current-session':'CURRENT_SESSION','/v1/identity/auto-login':'AUTO_LOGIN'});
const requests=new WeakMap<IncomingMessage,{id:number;path:string;method:string}>();
let sequence=0,nextRequest=0,overflow=false;
function output(value:object):void {try{console.error('[IDENTITY_BOUNDARY] '+JSON.stringify(value));}catch{/* diagnostic failure cannot alter auth */}}
if(enabled)output({kind:'ENABLED',version:1});
function exceeded():void {if(!overflow){overflow=true;output({kind:'OVERFLOW',version:1});}}
export function markIdentityBoundary(req:IncomingMessage,stage:Stage,status:number|null=null):void {
 if(!enabled)return;
 const row=requests.get(req);if(!row)return;
 if(sequence>=256){exceeded();return;}
 output({kind:'REQUEST',version:1,event:sequence++,request:row.id,path:row.path,method:row.method,stage,status,at:Date.now()});
}
export function observeIdentityIngress(req:IncomingMessage,res:ServerResponse):void {
 if(!enabled)return;
 // Exact fixed route selection only. Query, fragment and full URL never retained.
 const path=(req.url??'').split('?',1)[0];if(!Object.hasOwn(fixedPaths,path))return;
 if(nextRequest>=32){exceeded();return;}
 requests.set(req,{id:++nextRequest,path:fixedPaths[path],method:req.method==='GET'?'GET':req.method==='POST'?'POST':'OTHER'});
 markIdentityBoundary(req,'INGRESS');
 res.once('finish',()=>markIdentityBoundary(req,'RESPONSE_FINISHED',res.statusCode));
 res.once('close',()=>markIdentityBoundary(req,'RESPONSE_CLOSED',res.statusCode));
}
