"""Closed schema shared by collector and exporter. No messages or raw stacks."""
CHECKPOINTS={'IMPORT_ENTRY','RUN_PHASE','GUARD','RUNTIME_IMPORT','NARRATIVE_IMPORT','OWNERS_IMPORT','ADMISSIONS',
 'ADMISSIONS_SETTLED','PRESERVE_RECEIPT','OWNERS_CLOSE','MEMORY_CLOSE','NERVOUS_CLOSE','GRAPH_CLOSE','REDIS_CLOSE','SQLITE_CLOSE','COMPLETE'}
SITES={'TOP_LEVEL','ADMISSION_0','ADMISSION_1','ORACLE_PRIMARY','OWNERS_CLOSE','MEMORY_CLOSE','NERVOUS_CLOSE','GRAPH_CLOSE','REDIS_CLOSE','SQLITE_CLOSE'}
CLASSES={'Error','TypeError','RangeError','SyntaxError','ReferenceError','AssertionError','AggregateError','OtherException'}
CODES={'OTHER','ERR_ASSERTION','ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_DLOPEN_FAILED','ERR_REQUIRE_ESM',
 'ERR_UNKNOWN_FILE_EXTENSION','ENOENT','EACCES','EPERM','EROFS','ENOSPC','EIO','ENOMEM','EMFILE','ENFILE',
 'SQLITE_ERROR','SQLITE_CANTOPEN','SQLITE_READONLY','SQLITE_FULL','SQLITE_IOERR','SQLITE_BUSY','SQLITE_LOCKED'}
def project(value,table):
 assert isinstance(value,dict) and set(value)=={'schemaVersion','mode','checkpoint','checkpoints','errors','outcome','framesOmitted'}
 assert value['schemaVersion']==1 and value['mode'] in {'write','read'} and value['checkpoint'] in CHECKPOINTS
 assert value['outcome'] in {'RUNNING','RETURNED','THREW'} and type(value['framesOmitted'])is bool
 assert isinstance(value['checkpoints'],list) and len(value['checkpoints'])<=24 and all(x in CHECKPOINTS for x in value['checkpoints'])
 assert isinstance(value['errors'],list) and len(value['errors'])<=8
 modules={r['moduleId']:r for r in table}
 errors=[]
 for error in value['errors']:
  assert isinstance(error,dict) and set(error)=={'site','exceptionClass','code','frames','framesOmitted'}
  assert error['site'] in SITES and error['exceptionClass'] in CLASSES and error['code'] in CODES and type(error['framesOmitted'])is bool
  assert isinstance(error['frames'],list) and len(error['frames'])<=4
  frames=[]
  for frame in error['frames']:
   assert isinstance(frame,dict) and set(frame)=={'moduleId','line','column'} and frame['moduleId'] in modules
   assert type(frame['line'])is int and 1<=frame['line']<=modules[frame['moduleId']]['lines']
   assert type(frame['column'])is int and 1<=frame['column']<=1000000
   frames.append({k:frame[k] for k in ('moduleId','line','column')})
  errors.append({**{k:error[k] for k in ('site','exceptionClass','code','framesOmitted')},'frames':frames})
 return {**{k:value[k] for k in ('schemaVersion','mode','checkpoint','checkpoints','outcome','framesOmitted')},'errors':errors}
