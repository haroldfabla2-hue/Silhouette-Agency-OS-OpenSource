"""Run inside an isolated acceptance copy at /tmp/work with no external network.
Requires already-installed dependencies and loopback access inside that namespace.
Uses real HTTP, actual app processes and fixture-only WORKING memory.
Not a production test or a four-tier persistence proof.
"""
import subprocess,time,pathlib,json,urllib.request,urllib.error,os,signal
root=pathlib.Path('/tmp/work'); marker='isolated-restart-memory-fixture-20261111'; report={'production_data':False,'network_namespace':True,'fixture':marker,'provider_policy':os.environ.get('SILHOUETTE_PROVIDERS','default'),'boot_mode':os.environ.get('SILHOUETTE_BOOT_MODE','acceptance'),'cycles':[]}
def request(path,body=None):
 data=json.dumps(body).encode() if body is not None else None
 req=urllib.request.Request('http://127.0.0.1:33005'+path,data=data,headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=3) as response:return json.loads(response.read())
def nodes(value):
 if isinstance(value,dict):
  if value.get('content')==marker:yield value
  for v in value.values():yield from nodes(v)
 elif isinstance(value,list):
  for v in value:yield from nodes(v)
for cycle in [1,2]:
 with (root/('restart-cycle-'+str(cycle)+'.log')).open('w') as log:
  p=subprocess.Popen(['node','--import','tsx','server/index.ts'],cwd=root,env={'PATH':os.environ['PATH'],'HOME':'/tmp/isolated-home','NODE_ENV':'test','SILHOUETTE_BOOT_MODE':os.environ.get('SILHOUETTE_BOOT_MODE','acceptance'),'SILHOUETTE_PROVIDERS':os.environ.get('SILHOUETTE_PROVIDERS','on'),'SILHOUETTE_DB_PATH':'/tmp/work/db/probe.sqlite','SILHOUETTE_LANCEDB_PATH':'/tmp/work/db/probe.lancedb'},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:
   end=time.monotonic()+45;state=None
   while p.poll() is None and time.monotonic()<end:
    try:state=request('/v1/memory/state');break
    except Exception:time.sleep(.5)
   assert state is not None,'memory route not available'
   time.sleep(3)
   if cycle==1:
    result=request('/v1/memory/store',{'content':marker,'tier':'WORKING','tags':['isolated-acceptance-fixture']});assert result.get('success'),result
   state=request('/v1/memory/state');matches=list(nodes(state));assert len(matches)==1,(cycle,matches)
   node=matches[0]
   if cycle==1:original_id=node['id']
   else:assert node['id']==original_id,'ID changed on process restart'
   report['cycles'].append({'cycle':cycle,'pid':p.pid,'route_state_count':len(matches),'node_id':node['id'],'content_equal':node['content']==marker})
  finally:
   if p.poll() is None:
    os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(timeout=8)
    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=4)
   report['cycles'][-1:]=[{**r,'terminated':p.poll() is not None} for r in report['cycles'][-1:]]
assert report['cycles'][0]['pid']!=report['cycles'][1]['pid']
report['scope']='working-memory fixture through real HTTP across two real app processes, not four-tier memory or production durability'
(root/'memory-restart-result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
