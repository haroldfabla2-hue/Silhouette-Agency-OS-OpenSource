"""Direct receipt only. Never upload raw logs, journals, environment or auth."""
import json,re
from pathlib import Path
BOOL={'productAttempted','forcedCleanup','allSilhouetteValidated','pipeEOFObserved','contextValidated','cleanupUnknown',
 'temporaryRootRetainedUntilVMTeardown','naturalMainExit','managerReportedWholeCgroupExited','sameOriginalIdsAndFields',
 'providersOff','afterStopConfirmed','partial','copyIsNaturalExitEvidence','runtimePerFileCap',
 'cleanupBeforeStopStateUnavailable','publicEvidenceCopyUnavailable'}
NUM={'runId','jobId','exitCode','logBytes','totalBytes','copiedBytes','bytesCopied','collectionLimitBytes'}
TEXT={'kind':{'DIRECT_REAL_NARRATIVE_SYSTEMD'},'result':{'UNKNOWN','PASS_DIRECTED_NARRATIVE_ONLY'},
 'mode':{'write','read'},'scope':{'Narrative-only-not-full-app-or-raw-memory-durability'},
 'terminalModel':{'SYSTEMD_EXITTYPE_CGROUP_REMAIN_AFTER_EXIT'},
 'naturalTreeExitModel':{'SYSTEMD_EXITTYPE_CGROUP_NOT_DOCKER_PID1_CENSUS'},
 'executableIdentity':{'ABSOLUTE_PINNED_FILE_NOT_PROC_OBSERVATION'}}
HASH={'journalSha256','recoveredSha256','originalArchiveSha256','originalManifestSha256','derivedManifestSha256','derivedGuardSha256','productEntrySha256'}
OBJECT={'instrumentationProvenance','terminalJournalCopy','logCollection','write','read'}
UNIT={'LoadState','ActiveState','SubState','Result','ExecMainCode','ExecMainStatus','MainPID','ControlPID','Type','ExitType',
 'RemainAfterExit','User','Group','PrivateNetwork','PrivateDevices','NoNewPrivileges','MemoryMax','MemorySwapMax',
 'TasksMax','CPUQuotaPerSecUSec','CPUQuotaPeriodUSec','KillMode','Restart'}
def state(value):
 return {k:v for k,v in value.items() if k in UNIT and isinstance(v,str) and re.fullmatch('[a-zA-Z0-9_.-]{0,80}',v)}
def project(value,depth=0):
 assert isinstance(value,dict) and depth<=5
 out={}
 for k,v in value.items():
  if k in BOOL and type(v)is bool:out[k]=v
  elif k in NUM and type(v)is int and 0<=v<10**15:out[k]=v
  elif k in TEXT and isinstance(v,str) and v in TEXT[k]:out[k]=v
  elif k in HASH and isinstance(v,str) and re.fullmatch('[a-f0-9]{64}',v):out[k]=v
  elif k=='failureCode' and isinstance(v,str) and re.fullmatch('[A-Z][A-Z0-9_]{0,95}',v):out[k]=v
  elif k=='failureClass' and v in {'RuntimeError','ValueError','OSError','FileNotFoundError','PermissionError','TimeoutExpired','JSONDecodeError','AssertionError','TypeError','KeyError'}:out[k]=v
  elif k in OBJECT and isinstance(v,dict):out[k]=project(v,depth+1)
  elif k=='phases' and isinstance(v,list):out[k]=[project(x,depth+1) for x in v[:2]]
  elif k=='unitStates' and isinstance(v,list):out[k]=[state(x) for x in v[:4] if isinstance(x,dict)]
  elif k in {'lastUnitState','cleanupBeforeStopState','cleanupAfterStopState'} and isinstance(v,dict):out[k]=state(v)
 return out
if __name__=='__main__':
 output=Path('/tmp/narrative-direct-selected');output.mkdir(mode=0o755,exist_ok=False)
 try:
  source=Path('/tmp/narrative-direct-result.json')
  if not source.exists():value={'evidenceState':'DIRECT_RECEIPT_NOT_WRITTEN','cleanTerminationEstablished':False}
  else:
   assert source.is_file() and source.stat().st_size<=262144
   value=project(json.loads(source.read_text()))
 except Exception:value={'evidenceState':'UNREADABLE_OR_INVALID','cleanTerminationEstablished':False}
 raw=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode();assert len(raw)<=262144
 (output/'receipt.json').write_bytes(raw)
