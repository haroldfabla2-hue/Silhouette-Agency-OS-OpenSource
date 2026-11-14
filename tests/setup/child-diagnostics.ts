import type { ChildProcess } from 'node:child_process';
/** Diagnostics only. Never prints argv/env, never changes child/JSON verdict. */
export function retainChildDiagnostics(child: ChildProcess, label: string): void {
    let stderr='',observed=0,readFailure=!child.stderr;
    child.stderr?.on('data', (chunk: Buffer) => {observed+=chunk.length;stderr+=chunk.toString('utf8').slice(0,Math.max(0,8192-stderr.length));});
    child.stderr?.on('error', () => {readFailure=true;});
    child.once('close',(code,signal)=>{
        // Error output can echo command parameters. Redact every actual
        // argument, including the fixture symmetric key, before logging.
        let safe=stderr;
        for(const value of [...child.spawnargs].sort((a,b)=>b.length-a.length)) if(value) safe=safe.split(value).join('[ARG_REDACTED]');
        console.error('ORIGINAL_CHILD_DIAGNOSTIC',JSON.stringify({label,pid:child.pid??null,code,signal,stderr:safe,stderrBytesObserved:observed,truncated:observed>8192,captureStatus:readFailure?'MISSING_TELEMETRY':'CAPTURED',argv:'OMITTED',env:'OMITTED'}));
    });
}
