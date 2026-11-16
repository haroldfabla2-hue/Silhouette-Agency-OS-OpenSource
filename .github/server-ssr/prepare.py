# Host preparation proposal. Never runs npm/install/compiler/config/toolchain/targets.
import pathlib,subprocess,json,sys,os,hashlib,urllib.request,tarfile,io,base64,shutil,time
workspace=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve();infra=workspace/'transport/.github/server-ssr';source=workspace/'candidate';start=time.monotonic()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert not out.exists();out.mkdir(parents=True)
pins=json.loads((infra/'host-pins.json').read_text())
for rel,digest in pins['files'].items():assert sha(infra/rel)==digest
for folder,commit in [(source,'825e9050407fe0cd7ce4bcafccccb03e7e0dbd53'),(workspace/'baseline','6b49bc2a7fadcd87759cd0c1d534c832194b1572')]:
 assert subprocess.check_output(['git','-C',str(folder),'rev-parse','HEAD'],text=True).strip()==commit
 assert not subprocess.check_output(['git','-C',str(folder),'status','--porcelain'],text=True).strip()
assert sha(source/'.github/inert-compiler/prepare.py')=='326379b815803e1a9dfba7fbe5a334dabfe651458cc2be791beb3f8e0979a944'
assert sha(source/'.github/inert-compiler/source-hashes.json')=='aae622e22549ecba9f5d4c4f319d3f983b65eb217a2908ab6b50dcca6bf1eac9'
subprocess.run([sys.executable,str(source/'.github/inert-compiler/prepare.py'),str(workspace),str(out)],env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent'},check=True,timeout=240)
# Immutable product snapshot receives ONLY reviewed fourpathdelta, never modify checkout.
delta=json.loads((infra/'delta-hashes.json').read_text());assert set(delta)=={'Dockerfile','package.json','server/main.ts','vite.server.config.ts'}
snapshot=out/'snapshots/candidate'
for rel,row in delta.items():
 p=snapshot/rel;assert (sha(p) if p.exists() else None)==row['before'];assert sha(infra/'delta'/rel)==row['after']
 if p.exists():p.chmod(0o600)
 p.parent.mkdir(exist_ok=True,parents=True);p.write_bytes((infra/'delta'/rel).read_bytes());p.chmod(0o444)
# Merge only exact independently pinned buildtooling roots into disjoint shared deps.
rows=json.loads((infra/'tooling-artifacts.json').read_text());approved=json.loads((infra/'approved-tooling.json').read_text());lock=json.loads((source/'package-lock.json').read_text())['packages'];assert len(rows)==13
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**k):raise RuntimeError('REDIRECT')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());compressed=expanded=retained=0;actual={}
deps=out/'deps'
for row in rows:
 assert time.monotonic()-start<240
 entry=lock[row['path']];assert all(entry[k]==row[k] for k in ['version','resolved','integrity'])
 assert row['resolved'].startswith('https://registry.npmjs.org/') and not (deps/row['path']).exists()
 with opener.open(row['resolved'],timeout=25) as response:raw=response.read(33554433)
 compressed+=len(raw);assert len(raw)<=33554432 and compressed<=67108864
 assert 'sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()==row['integrity']
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as t:
  for m in t:
   parts=pathlib.PurePosixPath(m.name).parts;assert not m.name.startswith('/') and '..'not in parts
   if m.isdir():continue
   assert m.isfile()and len(parts)>1;expanded+=m.size;assert m.size<=16777216 and expanded<=268435456
   suffix=pathlib.Path(*parts[1:]);native=row['retainedNativeMember']==str(suffix)
   if suffix.suffix not in ['.js','.mjs','.cjs','.json'] and not native:continue
   data=t.extractfile(m).read();retained+=len(data);assert retained<=134217728 and len(data)==m.size
   rel=str(pathlib.Path(row['path'])/suffix);assert rel not in actual
   actual[rel]=hashlib.sha256(data).hexdigest();assert actual[rel]==approved[rel]
   dest=deps/rel;dest.parent.mkdir(parents=True,exist_ok=True);assert not dest.exists();dest.write_bytes(data);dest.chmod(0o555 if rel.endswith('/bin/esbuild') else 0o444)
assert actual==approved
# Preserve full source/shared-dependency/Qdrant identities. Explicit empty mountpoints only.
(snapshot/'dist').mkdir(exist_ok=True);(deps/'node_modules/.vite-temp').mkdir(exist_ok=True)
for n in ['.env','.env.local','.env.production','.env.production.local'] :assert not (snapshot/n).exists()
# Existing postcss/tailwind configs remain readonly source; evaluation is NOT allowlisted.
# If the realservergraph reaches CSS config evaluation, fail rather than disabling it.
stage=out/'stages/SSR';stage.mkdir(parents=True);control=stage/'control';denied=stage/'denied';control.mkdir();denied.mkdir()
for n in ['driver.cjs','stage-runner.cjs','boundary.cjs','build.mjs']:shutil.copyfile(infra/n,control/n)
(denied/'sentinel.cjs').write_text('throw Error("CONTROL_SOURCE_EXECUTED");\n');(denied/'native-sentinel.node').write_bytes(b'INERT_NON_NATIVE\n')
loads={'/control/'+n:sha(control/n)for n in ['boundary.cjs','build.mjs']}
loads.update({'/source/'+rel:d for rel,d in approved.items() if not rel.endswith('/bin/esbuild')})
native='/source/node_modules/@rollup/rollup-linux-x64-gnu/rollup.linux-x64-gnu.node';binary='/source/node_modules/@esbuild/linux-x64/bin/esbuild'
(control/'boundary-plan.json').write_text(json.dumps({'loads':loads,'rollupNative':native,'esbuildBinary':binary,'esbuildSha256':approved['node_modules/@esbuild/linux-x64/bin/esbuild']},sort_keys=True)+'\n')
sourceMap={}
for folder,prefix in [(snapshot,'/source/'),(deps/'node_modules','/source/node_modules/')]:
 for p in folder.rglob('*'):
  assert not p.is_symlink()
  if p.is_file():sourceMap[prefix+p.relative_to(folder).as_posix()]=sha(p)
qprefix='/source/node_modules/@qdrant/js-client-rest/';sourceMap={k:v for k,v in sourceMap.items()if not k.startswith(qprefix)}
for p in (out/'candidate-qdrant').rglob('*'):
 if p.is_file():sourceMap[qprefix+p.relative_to(out/'candidate-qdrant').as_posix()]=sha(p)
assert len(sourceMap)<=100000
(control/'source-hashes.json').write_text(json.dumps(sourceMap,sort_keys=True)+'\n')
public={k:v for k,v in sourceMap.items()if k.startswith('/source/public/')}
(control/'public-assets.json').write_text(json.dumps(public,sort_keys=True)+'\n')
identity={'schema':1,'stage':'SSR','roots':{'/source':sourceMap,'/control':{'/control/'+p.name:sha(p)for p in control.iterdir()},'/denied':{'/denied/'+p.name:sha(p)for p in denied.iterdir()}}}
(control/'identities.json').write_text(json.dumps(identity,sort_keys=True)+'\n')
for folder in [control,denied]:
 for p in folder.iterdir():p.chmod(0o444)
for folder in [snapshot,deps,out/'candidate-qdrant',stage]:
 for p in [folder,*folder.rglob('*')]:
  if p.is_dir():p.chmod(0o755)
plan={'sourceCommit':'825e9050407fe0cd7ce4bcafccccb03e7e0dbd53','deltaManifestSha256':sha(infra/'delta-hashes.json'),'supervisorSha256':pins['files']['stage-runner.cjs'],'driverSha256':pins['files']['driver.cjs'],'stages':{'SSR':{'identitiesSha256':sha(control/'identities.json')}}}
(out/'host-plan.json').write_text(json.dumps(plan,sort_keys=True)+'\n');(out/'host-plan.sha256').write_text(sha(out/'host-plan.json')+'\n')
# Trustedhost reopens every generated exactidentity, BEFORE any container exists/GO.
for virtual,expected in identity['roots'].items():
 for file,digest in expected.items():
  if file.startswith(qprefix):actualPath=out/'candidate-qdrant'/file[len(qprefix):]
  elif file.startswith('/source/node_modules/'):actualPath=deps/'node_modules'/file[len('/source/node_modules/'):]
  elif file.startswith('/source/'):actualPath=snapshot/file[len('/source/'):]
  else:actualPath={'/control':control,'/denied':denied}[virtual]/file[len(virtual)+1:]
  assert actualPath.is_file()and not actualPath.is_symlink()and sha(actualPath)==digest
folders=['snapshots','deps','compiler','candidate-qdrant','checks','stages'];verified={p.relative_to(out).as_posix():sha(p)for name in folders for p in(out/name).rglob('*')if p.is_file()}
(out/'host-inputs.json').write_text(json.dumps(verified,sort_keys=True)+'\n');assert time.monotonic()-start<240
print('SSR_INPUTS_PREPARED_NO_BUILD_OR_NATIVE_EXECUTION')
