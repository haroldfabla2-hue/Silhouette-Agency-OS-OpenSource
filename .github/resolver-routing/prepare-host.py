# Trusted host preparation only. Executes reviewed preparation scripts, no product/tooling/native imports.
import pathlib,subprocess,hashlib,json,sys,os,time
workspace=pathlib.Path(sys.argv[1]).resolve();transport=workspace/'transport/.github/resolver-routing';out=pathlib.Path(sys.argv[2]).resolve();stage=sys.argv[3]
assert stage in ['NODE','TSX','VITE_OPTIONAL'];assert not out.exists();out.mkdir(parents=True)
start=time.monotonic();pins=json.loads((transport/'host-pins.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for rel,digest in pins['files'].items():assert sha(transport/rel)==digest
source=workspace/'candidate'
for folder,commit in [(source,'825e9050407fe0cd7ce4bcafccccb03e7e0dbd53'),(workspace/'baseline','6b49bc2a7fadcd87759cd0c1d534c832194b1572')]:
 assert subprocess.check_output(['git','-C',str(folder),'rev-parse','HEAD'],text=True).strip()==commit
 assert not subprocess.check_output(['git','-C',str(folder),'status','--porcelain'],text=True).strip()
assert sha(source/'.github/inert-compiler/prepare.py')=='326379b815803e1a9dfba7fbe5a334dabfe651458cc2be791beb3f8e0979a944'
assert sha(source/'.github/inert-compiler/source-hashes.json')=='aae622e22549ecba9f5d4c4f319d3f983b65eb217a2908ab6b50dcca6bf1eac9'
# This old preparation materializes exact candidate source/shared deps/7-file Qdrant. Never invokes compiler.
subprocess.run([sys.executable,str(source/'.github/inert-compiler/prepare.py'),str(workspace),str(out)],check=True,env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent'},timeout=240)
subprocess.run([sys.executable,str(transport/'fixtures/prepare-tooling.py'),str(transport),str(out/'tooling'),stage,str(source/'package-lock.json')],check=True,env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent'},timeout=max(1,min(90,240-(time.monotonic()-start))))

fixtures=transport/'fixtures';stageOut=out/'stages'/stage;stageOut.parent.mkdir(exist_ok=True)
result=subprocess.run([sys.executable,str(fixtures/'make-control.py'),str(fixtures),str(out),str(out/'tooling'),str(stageOut),stage,pins['fixtureManifestSha256'],pins['toolingManifestSha256']],check=True,capture_output=True,text=True,env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent'},timeout=max(1,min(80,240-(time.monotonic()-start))))
item=json.loads(result.stdout);control=stageOut/'control';identities=json.loads((control/'identities.json').read_text())
# Add only host-pinned trusted canary bootstrap, then seal its exact identity into generatedmanifest.
(control/'driver.cjs').write_bytes((transport/'driver.cjs').read_bytes());(control/'driver.cjs').chmod(0o444)
identities['roots']['/control']['/control/driver.cjs']=pins['files']['driver.cjs']
(control/'identities.json').chmod(0o600);(control/'identities.json').write_text(json.dumps(identities,sort_keys=True)+'\n');(control/'identities.json').chmod(0o444)
item['identitiesSha256']=sha(control/'identities.json');item['view']='empty-node' if stage=='NODE' else 'node' if stage=='TSX' else 'vite'
# Independently verify every generated/mounted identity against trustedhost paths before passing its digest.
rootMap={'/source':out/'snapshots/candidate','/tooling':out/'tooling'/item['view'],'/control':control,'/denied':stageOut/'denied'}
for virtual,expected in identities['roots'].items():
 for file,digest in expected.items():
  if file.startswith('/source/node_modules/@qdrant/js-client-rest/'):actual=out/'candidate-qdrant'/file[len('/source/node_modules/@qdrant/js-client-rest/'):]
  elif file.startswith('/source/node_modules/'):actual=out/'deps/node_modules'/file[len('/source/node_modules/'):]
  else:actual=rootMap[virtual]/file[len(virtual)+1:]
  assert actual.is_file() and not actual.is_symlink() and sha(actual)==digest
assert time.monotonic()-start<=240
plan={'schema':1,'sourceCommit':'825e9050407fe0cd7ce4bcafccccb03e7e0dbd53','supervisorSha256':pins['files']['fixtures/stage-runner.cjs'],'driverSha256':pins['files']['driver.cjs'],'fixtureManifestSha256':pins['fixtureManifestSha256'],'toolingManifestSha256':pins['toolingManifestSha256'],'stages':{stage:{'identitiesSha256':item['identitiesSha256'],'view':item['view']}}}
(out/'host-plan.json').write_text(json.dumps(plan,sort_keys=True)+'\n');(out/'host-plan.sha256').write_text(sha(out/'host-plan.json')+'\n')
folders=['snapshots','deps','compiler','candidate-qdrant','checks','tooling','stages']
verified={p.relative_to(out).as_posix():sha(p) for name in folders for p in (out/name).rglob('*') if p.is_file()}
(out/'host-inputs.json').write_text(json.dumps(verified,sort_keys=True)+'\n')
print('ROUTING_HOST_INPUTS_PREPARED_NO_FIXTURE_EXECUTION')
