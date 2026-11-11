"""Full production-mode app in /tmp/work, fixture-only data, no external network.
Checks real authenticated requests remain usable with providers OFF. No real keys.
"""
import pathlib,os,json,subprocess,time,signal,urllib.request,urllib.error,hashlib,sqlite3
root=pathlib.Path('/tmp/work');key='local-api-auth-fixture-not-a-real-credential'
envfile=root/'.env';envfile.write_text('SILHOUETTE_API_KEY='+key+'\nGEMINI_API_KEY=external-provider-fixture-must-stay-masked\n')
before=hashlib.sha256(envfile.read_bytes()).hexdigest()
report={'node_env':'production','provider_policy':'off','production_data_or_credentials':False,'external_network':False,'cycles':[]}
def request(token=None):
 req=urllib.request.Request('http://127.0.0.1:33005/v1/memory/state',headers={'Authorization':'Bearer '+token} if token else {})
 try:
  with urllib.request.urlopen(req,timeout=3) as r:return r.status
 except urllib.error.HTTPError as e:return e.code
for cycle in [1,2]:
 with (root/('production-auth-cycle-'+str(cycle)+'.log')).open('w') as log:
  p=subprocess.Popen(['node','--import','tsx','server/index.ts'],cwd=root,env={'PATH':os.environ['PATH'],'HOME':'/tmp/fixture-home','NODE_ENV':'production','SILHOUETTE_BOOT_MODE':'normal','SILHOUETTE_PROVIDERS':'off','SILHOUETTE_DB_PATH':str(root/'db/auth-fixture.sqlite'),'SILHOUETTE_LANCEDB_PATH':str(root/'db/auth-fixture.lancedb')},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:
   end=time.monotonic()+40
   while p.poll() is None and time.monotonic()<end:
    try:
     if request(key)==200:break
    except OSError:pass
    time.sleep(.5)
   assert p.poll() is None,'app exited during auth readiness'
   # Seed only an isolated fake identity to leave first-time-setup mode.
   identity=sqlite3.connect(root/'db/auth-fixture.sqlite')
   identity.execute("INSERT OR IGNORE INTO users(id,email,name,role,created_at,last_login) VALUES ('isolated-auth-user','auth-fixture@example.invalid','Auth Fixture','CREATOR',1,1)")
   identity.commit();identity.close()
   assert request()==401,'unauthenticated request was not denied'
   assert request('wrong-fixture-token')==403,'wrong token was not denied'
   assert request(key)==200,'saved local API auth was not retained'
   # Exceed the 16-second exit observed in the real production-mode boot.
   time.sleep(20)
   assert p.poll() is None,'app did not remain running'
   assert request(key)==200,'authenticated route failed after startup'
   assert hashlib.sha256(envfile.read_bytes()).hexdigest()==before,'source credential file changed'
   report['cycles'].append({'cycle':cycle,'pid':p.pid,'unauthorized':401,'wrong_token':403,'authorized':200,'alive_after_20s':True,'source_file_unchanged':True})
  finally:
   if p.poll() is None:
    os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(timeout=8)
    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
assert report['cycles'][0]['pid']!=report['cycles'][1]['pid']
(root/'production-auth-result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
