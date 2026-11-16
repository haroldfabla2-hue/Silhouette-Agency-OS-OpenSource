# Declarative complete leaf schemas. No I/O, execution, native/config imports or implicit passthrough.
import re,math,pathlib
# Every retained scalar has a primitive validator. Objects reconstruct only declared fields.
def text(v,cap=1024):assert type(v)is str and len(v)<=cap and all(ord(c)>=32 for c in v);return v
def integer(v,cap=2147483648):assert type(v)is int and 0<=v<=cap;return v
def boolean(v):assert type(v)is bool;return v
def digest(v):assert type(v)is str and re.fullmatch('[a-f0-9]{64}',v);return v
def relative(v):
 text(v);assert v and not v.startswith('/')and'\\'not in v and all(x not in ['','.','..']for x in v.split('/'));return v
def moduleid(v):
 if type(v)is str and v.startswith('\0'):text(v[1:]);return v
 text(v);assert v and'..'not in pathlib.PurePosixPath(v).parts and not v.startswith(('data:','http:','https:'))
 if v.startswith('/'):assert v.startswith('/source/')
 return v
def absolute(v):
 text(v);assert v.startswith(('/source/','/control/','/denied/'))and'..'not in pathlib.PurePosixPath(v).parts and'\\'not in v and'//'not in v and all(x not in ['.','..','']for x in v[1:].split('/'));return v
def enum(*values):return ('enum',values)
def obj(fields,optional=(),drop=()):return ('obj',fields,set(optional),set(drop))
def array(item,cap=10000):return ('array',item,cap)
def mapping(key,value,cap=100000):return ('map',key,value,cap)
def nullable(s):return ('nullable',s)
def project(s,v):
 if callable(s):return s(v)
 kind=s[0]
 if kind=='enum':assert any(type(v)is type(x)and v==x for x in s[1]);return v
 if kind=='nullable':return None if v is None else project(s[1],v)
 if kind=='array':assert type(v)is list and len(v)<=s[2];return [project(s[1],x)for x in v]
 if kind=='map':assert type(v)is dict and len(v)<=s[3];return {project(s[1],k):project(s[2],x)for k,x in v.items()}
 if kind=='obj':
  fields,optional,drop=s[1:];assert type(v)is dict and set(v)<=set(fields)and set(fields)-optional<=set(v)
  result={}
  for k,x in v.items():
   projected=project(fields[k],x)
   if k not in drop:result[k]=projected
  return result
 raise AssertionError('UNKNOWN_SCHEMA_NODE')
BOOL=boolean;FALSE=enum(False);TRUE=enum(True);HASH=digest;INT=integer;REL=relative;MOD=moduleid;ABS=absolute;TEXT=text
PRIVATE=lambda v:(v if type(v)is str and len(v)<=65536 else (_ for _ in ()).throw(AssertionError('PRIVATE_TEXT_TYPE')))
small=lambda v:integer(v,4096)
BYTES=lambda v:integer(v,16777216)
TOTAL=lambda v:integer(v,50331648)
CODE=lambda v:(v if type(v)is str and re.fullmatch('[A-Z0-9_]{1,128}',v)else (_ for _ in ()).throw(AssertionError('CODE_TYPE')))
SIGNAL=nullable(enum('SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV','SIGBUS','SIGILL','SIGPIPE'))
EXIT=obj({'code':nullable(lambda v:integer(v,255)),'signal':SIGNAL})
FILE=obj({'sha256':HASH,'bytes':BYTES})
FILES=mapping(REL,FILE,2048)
POS=obj({'start':INT,'end':INT})
EVENT=obj({'rule':CODE,'subject':lambda v:text(v,240)})
LOAD=obj({'path':ABS,'sha256':HASH,'native':BOOL})
WRITE=obj({'kind':enum('CONFIG_BUNDLE'),'path':ABS,'sha256':HASH,'bytes':BYTES})
ORDER=obj({'eofRequestedAt':small,'stdinFinishedAt':small,'serviceExitAt':small,'serviceClosedAt':small,'exit':EXIT},optional=['eofRequestedAt','stdinFinishedAt','serviceExitAt','serviceClosedAt','exit'])
PAIR=obj({'input':lambda v:integer(v,67108864),'output':lambda v:integer(v,67108864)})
IPC=obj({'inputBytes':lambda v:integer(v,67108864),'outputBytes':lambda v:integer(v,67108864),'packets':PAIR,'pendingBytes':PAIR})
# JSONserializes service=false untilclose; union branch is explicit andtyped.
def service(v):return project(enum(False)if v is False else EXIT,v)
TOOLREAD=obj({'path':enum('/proc/version'),'api':enum('readFileSync'),'encoding':enum('utf8'),'bytes':lambda v:integer(v,4096),'sha256':HASH,'phase':enum('PINNED_VITE_IMPORT')})
ANNOTATION=obj({'key':enum('_rollupRemoved','_rollupAnnotations'),'host':enum('Program','ArrowFunctionExpression','CallExpression','FunctionDeclaration','FunctionExpression','NewExpression'),'type':enum('pure','noSideEffects','sourcemap'),'start':INT,'end':INT})
BOUNDARY=obj({'toolingReads':array(TOOLREAD,1),'annotations':array(ANNOTATION,256),'violations':small,'events':array(EVENT,64),'loads':array(LOAD,4096),'writes':array(WRITE,1),'configLoads':small,'nativeLoads':small,'spawnCount':small,'service':service,'serviceOrder':ORDER,'ipc':IPC,'closing':BOOL})
DIAG=obj({'kind':enum('info','warn','error'),'text':PRIVATE,'bytes':lambda v:integer(v,65536),'sha256':HASH},drop=['text'])
RESOLVED=obj({'root':enum('/source'),'configFile':enum('/source/vite.server.config.ts'),'mode':enum('production'),'ssr':TRUE,'outDir':enum('/source/dist/server'),'emptyOutDir':TRUE,'copyPublicDir':TRUE,'publicDir':enum('/source/public'),'envDir':enum('/source'),'configLoader':enum('bundle-default'),'externalPredicateUnmodified':TRUE,'plugins':array(lambda v:text(v,256),256)})
RENDERED=obj({'id':MOD,'renderedLength':INT,'originalLength':INT})
CHUNK=obj({'file':REL,'isEntry':BOOL,'facade':nullable(MOD),'imports':array(MOD),'dynamicImports':array(MOD),'astStaticSpecifiers':array(MOD),'astDynamicSpecifiers':array(MOD),'modules':array(RENDERED),'startupTopLevelCalls':array(POS,2048),'startupDeclarations':array(enum('startProductionServer'),16),'bytes':BYTES,'sha256':HASH})
EXTERNAL=obj({'id':MOD,'importers':array(MOD),'dynamicImporters':array(MOD)})
DYNAMIC=obj({'file':REL,'start':INT,'end':INT})
GRAPH=obj({'id':MOD,'importedIds':array(MOD),'dynamicallyImportedIds':array(MOD),'isEntry':BOOL})
REACH=obj({'sourceEntry':enum('/source/server/main.ts'),'entry':enum('index.js'),'entryTopLevelStartCall':BOOL,'declarationInStaticOutputClosure':BOOL,'staticClosure':array(REL,512),'classification':enum('LIMITED_STATIC_CALL_PATH_PRESENT','UNVERIFIED'),'runtimeInvocationProved':FALSE,'nonliteralDynamicImportsExhaustive':FALSE})
ARTIFACT=obj({'chunks':array(CHUNK,512),'externals':array(EXTERNAL,2048),'dynamicUnknown':array(DYNAMIC,512),'moduleGraph':array(GRAPH),'modules':lambda v:integer(v,10000),'reachability':REACH})
ROOTDIGEST=obj({'files':lambda v:integer(v,100000),'digest':HASH})
ROOTS=obj({'/source':ROOTDIGEST,'/control':ROOTDIGEST,'/denied':ROOTDIGEST})
IDENTITIES=obj({'manifestSha256':HASH,'preHash':ROOTS,'postHash':ROOTS,'fullExactViewPrePostVerified':TRUE,'sourceCommit':enum('825e9050407fe0cd7ce4bcafccccb03e7e0dbd53'),'qdrantView':enum('EXACT_7_FILE_CANDIDATE_OVERLAY_NOT_BASELINE')})
def writable(kind):return obj({'files':FILES,'directories':array(REL,4096),'totalBytes':TOTAL,'classification':enum(kind)})
WRITABLE=obj({'/source/dist':writable('EXPECTED_SERVER_OUTPUT_ONLY'),'/source/node_modules/.vite-temp':writable('CONFIG_TEMP_REMOVED'),'/tmp':writable('EMPTY_NO_UNEXPLAINED_TEMP'),'/dev/shm':writable('UNCHANGED_16M_SHM_EMPTY')})
OUTPUTS=obj({'files':FILES,'totalBytes':TOTAL,'fullFileSetVerified':TRUE,'publicAssetsCopiedExactly':TRUE,'writableRoots':WRITABLE})
LOCATION=obj({'file':lambda v:text(v,240),'line':INT,'column':INT})
FAILURE=obj({'name':lambda v:text(v,128),'code':CODE,'message':PRIVATE,'messageSha256':HASH,'location':nullable(LOCATION)},optional=['location'],drop=['message'])
CHILD_DIAGNOSTIC=obj({'state':enum('NOT_STARTED','SPAWNED','SPAWN_THROW','CHILD_ERROR','CLOSED'),'spawnThrow':BOOL,'childErrorObserved':BOOL,'closed':BOOL,'exitCode':nullable(lambda v:(v if type(v)is int and -2147483648<=v<=2147483647 else (_ for _ in ()).throw(AssertionError('CHILD_EXIT_RANGE')))),'signal':SIGNAL,'stdoutObservedBytes':INT,'stdoutRetainedBytes':lambda v:integer(v,131072),'stderrObservedBytes':INT,'stderrRetainedBytes':lambda v:integer(v,16384),'countsClamped':BOOL,'stdoutCapExceeded':BOOL,'stderrCapExceeded':BOOL,'timeoutFired':BOOL,'stdoutParse':enum('EMPTY','JSON_OBJECT','JSON_NONOBJECT','INVALID_JSON')})
RECEIPT_FIELDS={'childDiagnostic':CHILD_DIAGNOSTIC,'schema':enum(1),'stage':enum('SSR'),'status':enum('INCOMPLETE','SSR_BUILD_RETURNED'),'runtimeAcceptance':FALSE,'typeAcceptance':FALSE,'generatedServerEvaluated':FALSE,'targetPackageEvaluated':FALSE,'boundary':BOUNDARY,'diagnostics':array(DIAG,128),'diagnosticBytes':lambda v:integer(v,65536),'controls':array(EVENT,64),'resolved':RESOLVED,'artifact':ARTIFACT,'inputIdentities':IDENTITIES,'outputs':OUTPUTS,'failure':FAILURE,'serviceCloseFailed':TRUE,'failurePredicate':CODE,'childFailureCode':CODE,'rawErrorsWithheld':TRUE}
def receipt(v,*,raw_child=False):
 fields=dict(RECEIPT_FIELDS);fields['buildFailure']=lambda child:receipt(child,raw_child=True)
 result=project(obj(fields,optional=set(fields)-{'schema','stage','status'}),v)
 if result['status']=='SSR_BUILD_RETURNED':
  assert set(['runtimeAcceptance','typeAcceptance','generatedServerEvaluated','targetPackageEvaluated','boundary','diagnostics','diagnosticBytes','controls','resolved','artifact'])<=set(result)
  if not raw_child:assert {'inputIdentities','outputs'}<=set(result)
 if 'artifact'in result:
  chunks=result['artifact']['chunks'];selected=[c for c in chunks if c['file']=='index.js'and c['isEntry']]
  assert len(selected)==1 and selected[0]['facade']=='/source/server/main.ts'
  for c in chunks:
   if c['isEntry']:assert c['facade']is not None
 return result
# Separateuploadedmaps are insideprojectioncontract, notscan-only.
def rootpath(root):
 def validate(v):absolute(v);assert v.startswith(root+'/');return v
 return validate
SOURCE_MAP=mapping(rootpath('/source'),HASH)
PUBLIC_MAP=mapping(rootpath('/source/public'),HASH)
IDENTITY_MANIFEST=obj({'schema':enum(1),'stage':enum('SSR'),'roots':obj({'/source':SOURCE_MAP,'/control':mapping(rootpath('/control'),HASH),'/denied':mapping(rootpath('/denied'),HASH)})})
PLAN=obj({'loads':mapping(ABS,HASH),'rollupNative':enum('/source/node_modules/@rollup/rollup-linux-x64-gnu/rollup.linux-x64-gnu.node'),'esbuildBinary':enum('/source/node_modules/@esbuild/linux-x64/bin/esbuild'),'esbuildSha256':enum('bab29b2ca7a9e89b67cf720b77b2d743f9f31f5cf0d5bd74ee8c8de30ced7014')})
MAP_SCHEMAS={'identities.json':IDENTITY_MANIFEST,'source-hashes.json':SOURCE_MAP,'public-assets.json':PUBLIC_MAP,'boundary-plan.json':PLAN}
MEMORY=mapping(enum('low','high','max','oom','oom_kill','oom_group_kill','sock_throttled'),INT,7)
RUN_FIELDS={'canaryPassed':BOOL,'buildStarted':BOOL,'controllerComplete':BOOL,'containerRemoved':BOOL,'forcedCleanup':BOOL,'guardianFailure':BOOL,'exit':enum(0,125),'elapsedSeconds':lambda v:(v if type(v)in [int,float]and math.isfinite(v)and 0<=v<=600 else (_ for _ in ()).throw(AssertionError('ELAPSED'))),'diagnosticBytes':lambda v:integer(v,131072),'memoryEventDelta':MEMORY}
def controller(v):
 # Explicitconstruction, unknownrawfailurestrings nevercopied. Noexactreasoninference.
 assert type(v)is dict
 result={'classification':v.get('classification')if v.get('classification')in ['SSR_ARTIFACT_COMMAND_COMPLETED','INCOMPLETE']else'INCOMPLETE','inputsUnchanged':v.get('inputsUnchanged')is True}
 run=v.get('run')
 if type(run)is dict:result['run']={k:project(s,run[k])for k,s in RUN_FIELDS.items()if k in run}
 return result
