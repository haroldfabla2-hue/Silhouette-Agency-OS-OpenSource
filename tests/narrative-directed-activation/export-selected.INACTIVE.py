"""Bounded technical evidence only; no logs, source data, provider or auth files."""
import json
from pathlib import Path
import re

OUTPUT=Path('/tmp/narrative-directed-evidence');OUTPUT.mkdir(mode=0o755,exist_ok=False)
ALLOWED_TEXT={'kind':{'DIRECTED_REAL_NARRATIVE','DIRECTED_HOST_DIAGNOSTICS'},
 'result':{'UNKNOWN','PREPARATION_REJECTED','PASS_DIRECTED_NARRATIVE_ONLY'},
 'phase':{'PREPARATION','ADMISSION','PRODUCT','TERMINAL_EVIDENCE','PRE_RELEASE','WRITE','READ'},
 'failurePhase':{'PREPARATION','ADMISSION','PRODUCT','TERMINAL_EVIDENCE'},
 'deadlineScope':{'CONTROLLER_LIVE_BEST_EFFORT_NOT_HARD_ADMISSION_BOUND'},
 'tmpfsByteInodeOwnershipEvidence':{'REQUESTED_ONLY_MOUNT_FLAGS_VERIFIED'},
 'mode':{'write','read'},'scope':{'Narrative-only-not-full-app-or-raw-memory-durability'}}
BOOLEAN_FIELDS={'forcedCleanup','productReleased','infrastructureStarted','cleanupUnknown','failedParentRetained',
 'deadlineFired','watchdogError','scratchImageRetainedUntilVMTeardown','retainedParentEmptyBeforeStop',
 'occupiedBeforeRelease','supervisorNaturalExit','externalProviderNetworkDisabled','allSilhouetteValidated',
 'sameOriginalIdsAndFields','providersOff','naturalExit','pipesClosed','namespaceCensusOnlySupervisor','truncated'}
NUMBER_FIELDS={'sequence','errno','exitCode','outputBytes','memory','swapTotal','tasks','cpuPeriod','cpuQuota',
 'workBytes','workInodes','tmpBytes'}
OBJECT_FIELDS={'profile','batch','decisiveFailure','decisiveOrigin','supervisorFailure'}
HASH_FIELDS={'closureSha256','preparationSha256','journalSha256','recoveredSha256'}

def project(value,depth=0):
 if depth>8 or not isinstance(value,dict):return {'projectionInvalid':True}
 result={}
 for key,item in value.items():
  if key in BOOLEAN_FIELDS and type(item) is bool:result[key]=item
  elif key in NUMBER_FIELDS and type(item) in (int,float):result[key]=item
  elif key in ALLOWED_TEXT and item in ALLOWED_TEXT[key]:result[key]=item
  elif key in HASH_FIELDS and isinstance(item,str) and re.fullmatch('[a-f0-9]{64}',item):result[key]=item
  elif key=='imageConfigId' and isinstance(item,str) and re.fullmatch('sha256:[a-f0-9]{64}',item):result[key]=item
  elif key in ('operation','failureCode','code','reason','state') and isinstance(item,str) and re.fullmatch('[A-Z][A-Z0-9_]{0,95}',item):result[key]=item
  elif key in ('failureClass','exceptionClass') and item in ('RuntimeError','ValueError','OSError','FileNotFoundError','PermissionError','TimeoutExpired','TimeoutError','JSONDecodeError','AssertionError','Error','TypeError','SyntaxError','RangeError','OtherException','Exception'):result[key]=item
  elif key in OBJECT_FIELDS:result[key]=project(item,depth+1)
  elif key in ('phases','events') and isinstance(item,list):result[key]=[project(row,depth+1) for row in item[:256]]
 return result

for name,source in [('receipt','/tmp/narrative-directed-result.json'),('host-diagnostics','/tmp/narrative-directed-result.json.host-diagnostics.json')]:
 try:
  file=Path(source);assert file.is_file() and file.stat().st_size<=262144
  value=project(json.loads(file.read_text()))
 except FileNotFoundError:value={'evidenceState':'CONTROLLER_RECEIPT_MISSING' if name=='receipt' else 'HOST_DIAGNOSTICS_NOT_WRITTEN','cleanTerminationEstablished':False}
 except Exception:value={'evidenceState':'UNREADABLE_OR_INVALID','cleanTerminationEstablished':False}
 raw=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode();assert len(raw)<=262144
 (OUTPUT/(name+'.json')).write_bytes(raw)
