"""INACTIVE bounded public preparation log capture, no inherited file rlimit.
Own process-group absence is measured, not inferred from leader exit/pipe EOF.
Escaped sessions remain outside this narrow preparation group's guarantee.
"""
from pathlib import Path
import errno,os,selectors,signal,subprocess,time,math
CAP=1048576

def run_public_command(argv,*,cwd,env,log_path,timeout_seconds):
    result={'logCapBytes':CAP,'bytesObserved':0,'bytesStored':0,'logOverflow':False,'wallTimeout':False,'killRequests':[],'reaped':False,'pipeEOF':False,'returnCode':None,'descendantsUnknown':False,'groupAbsent':False,'primaryFailure':None,'cleanupFailures':[],'successful':False,'pgid':None}
    child=None;selector=None;output=None;pgid=None;term_at=None;kill_at=None;cleanup_deadline=None;deadline=None
    def fail(code,error=None):
        if result['primaryFailure'] is None:result['primaryFailure']={'code':code,'errorType':type(error).__name__ if error else None}
    def group_state():
        if pgid is None:return 'absent'
        try:os.killpg(pgid,0);return 'present'
        except ProcessLookupError:return 'absent'
        except OSError as error:
            result['descendantsUnknown']=True;result['cleanupFailures'].append({'operation':'group-probe','errorType':type(error).__name__});return 'unknown'
    def send(sig,cause):
        request={'signal':signal.Signals(sig).name,'cause':cause,'accepted':False}
        try:os.killpg(pgid,sig);request['accepted']=True
        except ProcessLookupError:request['groupAlreadyAbsent']=True
        except OSError as error:request['errorType']=type(error).__name__;result['descendantsUnknown']=True;result['cleanupFailures'].append({'operation':'group-signal','errorType':type(error).__name__})
        result['killRequests'].append(request)
    def drain_once(wait):
        if selector is None:return
        for key,_ in selector.select(wait):
            chunk=os.read(key.fd,65536)
            if not chunk:selector.unregister(key.fileobj);result['pipeEOF']=True;continue
            result['bytesObserved']+=len(chunk)
            stored=chunk[:max(0,CAP-result['bytesStored'])]
            if stored:
                written=output.write(stored)
                if written!=len(stored):raise OSError('short log write')
                result['bytesStored']+=written
            if result['bytesObserved']>CAP:result['logOverflow']=True;fail('LOG_OVERFLOW')
    try:
        if not isinstance(argv,(list,tuple)) or not argv or not all(isinstance(v,str) and v for v in argv):raise ValueError('argv')
        if not isinstance(timeout_seconds,(int,float)) or not math.isfinite(timeout_seconds) or timeout_seconds<=0:raise ValueError('timeout')
        # Fail before acquisition whenever log/cwd inputs are unusable.
        if not Path(cwd).is_dir() or not isinstance(env,dict):raise ValueError('cwd/env')
        output=Path(log_path).open('xb',buffering=0)
        child=subprocess.Popen(argv,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
        pgid=child.pid;result['pgid']=pgid;deadline=time.monotonic()+timeout_seconds
        selector=selectors.DefaultSelector();selector.register(child.stdout,selectors.EVENT_READ)
        while True:
            now=time.monotonic();leader=child.poll();group=group_state()
            if leader is not None:result['returnCode']=leader;result['reaped']=True
            if now>=deadline:result['wallTimeout']=True;fail('WALL_TIMEOUT')
            if leader is not None and result['pipeEOF'] and group=='absent':result['groupAbsent']=True;break
            # A detached same-group writer after leader/EOF is not success.
            if leader is not None and result['pipeEOF'] and group!='absent':fail('GROUP_SURVIVED_LEADER')
            if result['primaryFailure'] is not None:
                if term_at is None:send(signal.SIGTERM,result['primaryFailure']['code']);term_at=now;cleanup_deadline=now+5
                if now-term_at>=2 and kill_at is None:send(signal.SIGKILL,'bounded-group-cleanup');kill_at=now
                if now>=cleanup_deadline:
                    if group!='absent' or leader is None or not result['pipeEOF']:result['descendantsUnknown']=True
                    break
            drain_once(.1)
        output.flush();os.fsync(output.fileno())
    except BaseException as error:
        fail('CAPTURE_EXCEPTION',error)
    finally:
        # Shared remaining budget across all exception/normal cleanup paths.
        if child is not None:
            if cleanup_deadline is None:cleanup_deadline=time.monotonic()+5
            while True:
                leader=child.poll();group=group_state();now=time.monotonic()
                if leader is not None:result['returnCode']=leader;result['reaped']=True
                if group=='absent' and leader is not None:result['groupAbsent']=True;break
                if term_at is None:send(signal.SIGTERM,'exception-or-survivor-cleanup');term_at=now
                if now-term_at>=2 and kill_at is None:send(signal.SIGKILL,'bounded-group-cleanup');kill_at=now
                if now>=cleanup_deadline:result['descendantsUnknown']=True;break
                try:drain_once(.05)
                except BaseException as error:result['cleanupFailures'].append({'operation':'drain','errorType':type(error).__name__});time.sleep(.05)
            # No extra independent wait budget after deadline.
            if child.poll() is None:result['descendantsUnknown']=True
            else:result['returnCode']=child.returncode;result['reaped']=True
            try:child.stdout.close()
            except BaseException as error:result['cleanupFailures'].append({'operation':'pipe-close','errorType':type(error).__name__})
        if selector is not None:
            try:selector.close()
            except BaseException as error:result['cleanupFailures'].append({'operation':'selector-close','errorType':type(error).__name__})
        if output is not None:
            try:output.close()
            except BaseException as error:fail('LOG_CLOSE_EXCEPTION',error)
    result['successful']=child is not None and result['returnCode']==0 and result['reaped'] and result['pipeEOF'] and result['groupAbsent'] and result['primaryFailure'] is None and not result['killRequests'] and not result['cleanupFailures'] and not result['descendantsUnknown']
    return result
if __name__=='__main__':raise SystemExit('INACTIVE: no execution authority')
