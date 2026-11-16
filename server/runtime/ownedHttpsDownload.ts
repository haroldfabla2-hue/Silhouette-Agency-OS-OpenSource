import https from 'node:https';
import { createWriteStream,promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ResourceScope } from './resourceScope';

export interface DownloadReceipt {
    state:'PENDING'|'FAILED_NO_COMMIT'|'COMMIT_UNKNOWN'|'FILE_APPLIED_METADATA_PENDING'|'METADATA_READBACK';
    temporaryPath?:string;
    destination:string;
    requestCount:number;
    requestsClosed:number;
    responsesClosed:number;
    fileClosed:boolean;
    fileFinished:boolean;
    fileApplied:boolean;
    error?:unknown;
    poolRelease:'UNVERIFIED';
    crashDurability:'UNVERIFIED';
}
/** A real request/response chain and physical file-close receipt, not fetch dispatch
 * or writable-finish success. No global Agent/socket is destroyed or certified.
 * Stage bytes separately so a failed download never truncates the prior target.
 * Uncertain partial files remain attributed; no blind unlink/replay on failure. */
export function downloadOwnedHttpsFile(scope:ResourceScope,url:string,receipt:DownloadReceipt):Promise<void>{
    return scope.run('voice-download-request-response-file',async()=>{
        let current=url;
        try{
            while(true){
                const outcome=await new Promise<string|undefined>((resolve,reject)=>{
                    let failure:unknown;
                    let failed=false;
                    let request:ReturnType<typeof https.get>|undefined;
                    let response:import('node:http').IncomingMessage|undefined;
                    let file:ReturnType<typeof createWriteStream>|undefined;
                    let requestClosed=false,responseClosed=false,fileClosed=true;
                    let gotResponse=false,redirect:string|undefined;
                    const fail=(error:unknown)=>{
                        if(!failed){failed=true;failure=error;}
                        // Initiation is NOT release. All actual close listeners below
                        // remain attached and keep this operation pending until close.
                        if(response&&!response.destroyed)response.destroy();
                        if(file&&!file.destroyed)file.destroy();
                        if(request&&!request.destroyed)request.destroy();
                    };
                    const maybeDone=()=>{
                        if(!requestClosed||(gotResponse&&!responseClosed)||!fileClosed)return;
                        if(!gotResponse&&!failed){failed=true;failure=new Error('HTTPS request closed without response');}
                        failed?reject(failure):resolve(redirect);
                    };
                    try{
                        request=https.get(current,actual=>{
                            response=actual;gotResponse=true;
                            const responseError=(error:Error)=>fail(error);
                            actual.on('error',responseError);
                            actual.once('close',()=>{
                                responseClosed=true;receipt.responsesClosed++;
                                if(!actual.complete)fail(new Error('HTTPS response closed before complete body'));
                                actual.off('error',responseError);maybeDone();
                            });
                            if(failed){actual.destroy();return;}
                            try{
                            if([301,302,307,308].includes(actual.statusCode||0)&&actual.headers.location){
                                redirect=actual.headers.location;
                                // Consume the actual redirect response and await its
                                // close and request close BEFORE opening the next hop.
                                actual.resume();return;
                            }
                            if(actual.statusCode!==200){fail(new Error(`HTTP ${actual.statusCode}`));return;}
                            try{
                                const temporaryPath=receipt.destination+'.voice-partial-'+randomUUID();
                                receipt.temporaryPath=temporaryPath;
                                file=createWriteStream(temporaryPath,{flags:'wx',autoClose:true,emitClose:true,flush:true});
                                fileClosed=false;
                                const fileError=(error:Error)=>fail(error);
                                file.on('error',fileError);
                                file.once('finish',()=>{receipt.fileFinished=true;});
                                file.once('close',()=>{
                                    fileClosed=true;receipt.fileClosed=true;
                                    if(!receipt.fileFinished&&!failed)fail(new Error('Download file closed before finish'));
                                    file!.off('error',fileError);maybeDone();
                                });
                                if(failed){file.destroy();return;}
                                actual.pipe(file);
                            }catch(error){fail(error);maybeDone();}
                            }catch(error){fail(error);maybeDone();}
                        });
                        receipt.requestCount++;
                        const requestError=(error:Error)=>fail(error);
                        request.on('error',requestError);
                        request.once('close',()=>{requestClosed=true;receipt.requestsClosed++;request!.off('error',requestError);maybeDone();});
                    }catch(error){
                        // A synchronous https.get validation failure acquired no
                        // returned request. Existing acquisitions still must close.
                        fail(error);if(!request)requestClosed=true;maybeDone();
                    }
                });
                if(outcome!==undefined){current=outcome;continue;}
                break;
            }
            if(!receipt.temporaryPath||!receipt.fileClosed||!receipt.fileFinished)throw new Error('No completed download file receipt');
            receipt.state='COMMIT_UNKNOWN';
            await fs.rename(receipt.temporaryPath,receipt.destination);
            receipt.fileApplied=true;receipt.state='FILE_APPLIED_METADATA_PENDING';
            // File flush/close plus successful rename is not directory fsync,
            // cross-process exclusion, restart journal, metadata or pool release.
        }catch(error){
            receipt.error=error;
            if(!receipt.fileApplied&&receipt.state!=='COMMIT_UNKNOWN')receipt.state='FAILED_NO_COMMIT';
            scope.recordFailure('voice-download-outcome-or-cleanup',error);
            throw error;
        }
    });
}
