import { createReadStream } from 'node:fs';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { runHttpWork } from './ownedHttpIngress';

/** Actual file stream belongs to the admitted request before it is created.
 * Read EOF, response handoff and descriptor closure are different receipts.
 * This owns source close; ingress separately owns the actual response lifetime.
 * No fd/stream claim is inferred from res.finish, unpipe, destroy or a timeout. */
export function pipeOwnedHttpFile(request:IncomingMessage,response:ServerResponse,filePath:string):Promise<void>{
    return runHttpWork(request,'http-file-source-close',()=>new Promise<void>((resolve,reject)=>{
        const source=createReadStream(filePath,{autoClose:true,emitClose:true});
        let failure:unknown;
        const sourceError=(error:Error)=>{failure??=error;};
        const responseClosed=()=>{
            if(!source.readableEnded)failure??=new Error('HTTP response closed before file EOF');
            source.unpipe(response);
            // Initiation only. Resolution still waits the actual source close.
            source.destroy();
        };
        const sourceClosed=()=>{
            source.off('error',sourceError);response.off('close',responseClosed);
            if(!source.readableEnded)failure??=new Error('HTTP file closed before EOF');
            failure?reject(failure):resolve();
        };
        source.on('error',sourceError);source.once('close',sourceClosed);
        response.once('close',responseClosed);
        if(response.destroyed){responseClosed();return;}
        try{source.pipe(response);}catch(error){
            failure??=error;source.unpipe(response);source.destroy();
        }
    }));
}
