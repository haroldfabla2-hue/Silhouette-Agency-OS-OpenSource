"""Real processes, real SQLite, real timers and bus. No doubles/providers.
Usage: python3 tests/real-process/run-boot-checks.py /path/to/tsx
Imports only selected real modules, not the full app: NOT full boot/E2E proof.
"""
import hashlib,json,os,pathlib,subprocess,sys,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[2]
TSX=sys.argv[1] if len(sys.argv)>1 else str(ROOT/'node_modules/.bin/tsx')
REPORT=[]
base={'modules':{'graph':True,'vectorDB':True,'redis':True,'browser':True},'memory':{'neo4j':{'uri':'bolt://127.0.0.1:17687','user':'fixture','password':'isolated-local-store-not-a-real-key'},'redis':{'host':'127.0.0.1','port':16379}},'system':{'port':3005,'env':'test'},'scheduler':{'enabled':True,'persistJobs':True,'maxConcurrent':1},'autonomy':{'enabled':True,'allowEvolution':True,'enableNarrative':True,'enableIntrospection':True},'llm':{'providers':{'gemini':{'apiKey':'isolated-credential-not-a-real-key','model':'test'}},'fallbackChain':['gemini']},'channels':{'telegram':{'enabled':True,'botToken':'isolated-credential-not-a-real-key'}},'brain':{'enabled':True,'apiKey':'isolated-credential-not-a-real-key'}}

def run(script,scenario,p,extra=None):
 env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG']}
 env.update(SILHOUETTE_DB_PATH=str(p/'real.db'),NODE_ENV='test')
 if extra:env.update(extra)
 result=subprocess.run([TSX,str(ROOT/'tests/real-process'/script),scenario],cwd=p,env=env,capture_output=True,text=True,timeout=20)
 if result.returncode:
  print(result.stdout);print(result.stderr,file=sys.stderr);raise RuntimeError(f'{script} {scenario} failed ({result.returncode})')
 rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
 REPORT.extend(rows);return result

with tempfile.TemporaryDirectory(prefix='silhouette-real-boot-') as d:
 parent=pathlib.Path(d)
 for scenario in ['scheduler-off','autonomy-off','goals-off','on','stop','revoke','malformed']:
  p=parent/scenario;p.mkdir();config=json.loads(json.dumps(base))
  if scenario=='scheduler-off':config['scheduler']['enabled']=False
  if scenario=='autonomy-off':config['autonomy']['enabled']=False
  if scenario=='goals-off':config['autonomy']['enableIntrospection']=False
  if scenario=='malformed':config['autonomy']=None
  (p/'silhouette.config.json').write_text(json.dumps(config));run('scheduler-child.ts',scenario,p)
 p=parent/'cron';p.mkdir();(p/'silhouette.config.json').write_text(json.dumps(base));run('cron-child.ts','cron',p)
 p=parent/'credentials';p.mkdir();(p/'silhouette.config.json').write_text(json.dumps(base))
 (p/'.env').write_text('GEMINI_API_KEY=isolated-credential-not-a-real-key\nNEO4J_URI=bolt://127.0.0.1:17687\nNEO4J_PASSWORD=isolated-local-store-not-a-real-key\nREDIS_URL=redis://127.0.0.1:16379\n')
 extra={'SILHOUETTE_API_KEY':'isolated-local-api-auth-not-a-real-key','SILHOUETTE_API_TOKEN':'isolated-local-api-token-not-a-real-key','CUSTOM_PROVIDER_CREDENTIAL':'isolated-credential-not-a-real-key','SILHOUETTE_HOST':'0.0.0.0'}
 run('credentials-child.ts','normal',p,{**extra,'SILHOUETTE_PROVIDERS':'on'})
 run('credentials-child.ts','acceptance',p,{**extra,'SILHOUETTE_BOOT_MODE':'acceptance'})
 run('credentials-child.ts','providers-off',p,{**extra,'SILHOUETTE_PROVIDERS':'off'})
 for mode in ['on','off']:
  run('provider-transport-child.ts',mode,p,{'SILHOUETTE_PROVIDERS':mode})
 print(json.dumps({'real_process_checks':REPORT,'full_application_boot_tested':False,'production_data':False,'provider_calls':False},indent=2))
