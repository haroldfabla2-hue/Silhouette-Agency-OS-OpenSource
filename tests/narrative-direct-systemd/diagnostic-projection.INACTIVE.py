"""Closed schema shared by collector and exporter. No messages or raw stacks."""
CHECKPOINTS={'IMPORT_ENTRY','RUN_PHASE','GUARD','RUNTIME_IMPORT','NARRATIVE_IMPORT','OWNERS_IMPORT','ADMISSIONS',
 'ADMISSIONS_SETTLED','PRESERVE_RECEIPT','OWNERS_CLOSE','MEMORY_CLOSE','NERVOUS_CLOSE','GRAPH_CLOSE','REDIS_CLOSE','SQLITE_CLOSE','COMPLETE'}
SITES={'TOP_LEVEL','ADMISSION_0','ADMISSION_1','ORACLE_PRIMARY','OWNERS_CLOSE','MEMORY_CLOSE','NERVOUS_CLOSE','GRAPH_CLOSE','REDIS_CLOSE','SQLITE_CLOSE','FATAL_MONITOR'}
CLASSES={'Error','TypeError','RangeError','SyntaxError','ReferenceError','AssertionError','AggregateError','OtherException'}
CODES={'OTHER','ERR_ASSERTION','ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_DLOPEN_FAILED','ERR_REQUIRE_ESM',
 'ERR_UNKNOWN_FILE_EXTENSION','ENOENT','EACCES','EPERM','EROFS','ENOSPC','EIO','ENOMEM','EMFILE','ENFILE',
 'SQLITE_ERROR','SQLITE_CANTOPEN','SQLITE_READONLY','SQLITE_FULL','SQLITE_IOERR','SQLITE_BUSY','SQLITE_LOCKED'}
def project(value,table,targets):
 assert isinstance(value,dict) and set(value)=={'schemaVersion','mode','checkpoint','checkpoints','errors','outcome','framesOmitted','fatalObservation','exitObservation'}
 assert value['schemaVersion']==1 and value['mode'] in {'write','read'} and value['checkpoint'] in CHECKPOINTS
 assert value['outcome'] in {'RUNNING','RETURNED','THREW'} and type(value['framesOmitted'])is bool
 assert isinstance(value['checkpoints'],list) and len(value['checkpoints'])<=24 and all(x in CHECKPOINTS for x in value['checkpoints'])
 assert isinstance(value['errors'],list) and len(value['errors'])<=8
 fatal=value['fatalObservation'];exit_value=value['exitObservation']
 assert isinstance(fatal,dict) and set(fatal)=={'seen','origin'} and type(fatal['seen'])is bool
 assert fatal['origin'] in {'NONE','uncaughtException','unhandledRejection','OTHER'}
 assert fatal['seen']==(fatal['origin']!='NONE')
 assert isinstance(exit_value,dict) and set(exit_value)=={'seen','code'} and type(exit_value['seen'])is bool
 assert exit_value['code'] is None or type(exit_value['code'])is int and 0<=exit_value['code']<=255
 modules={r['moduleId']:r for r in table}
 errors=[]
 for error in value['errors']:
  assert isinstance(error,dict) and set(error)=={'site','exceptionClass','code','frames','framesOmitted','moduleIdentity'}
  assert error['site'] in SITES and error['exceptionClass'] in CLASSES and error['code'] in CODES and type(error['framesOmitted'])is bool
  assert isinstance(error['frames'],list) and len(error['frames'])<=4
  identity=error['moduleIdentity']
  assert isinstance(identity,dict) and set(identity)=={'status','targetId','importerStatus'}
  assert identity['status'] in {'MATCHED','UNMATCHED'} and identity['importerStatus']=='UNKNOWN'
  assert (identity['status']=='UNMATCHED' and identity['targetId'] is None) or (identity['status']=='MATCHED' and identity['targetId'] in {r['targetId'] for r in targets})
  frames=[]
  for frame in error['frames']:
   assert isinstance(frame,dict) and set(frame)=={'moduleId','line','column'} and frame['moduleId'] in modules
   assert type(frame['line'])is int and 1<=frame['line']<=modules[frame['moduleId']]['lines']
   assert type(frame['column'])is int and 1<=frame['column']<=1000000
   frames.append({k:frame[k] for k in ('moduleId','line','column')})
  errors.append({**{k:error[k] for k in ('site','exceptionClass','code','framesOmitted','moduleIdentity')},'frames':frames})
 return {**{k:value[k] for k in ('schemaVersion','mode','checkpoint','checkpoints','outcome','framesOmitted','fatalObservation','exitObservation')},'errors':errors}
