# Materialization only. Mandatory hash arguments come from approved owning manifests, not discovered files.
import pathlib,json,hashlib,sys,shutil
fixtures=pathlib.Path(sys.argv[1]).resolve();inert=pathlib.Path(sys.argv[2]).resolve();tooling=pathlib.Path(sys.argv[3]).resolve();out=pathlib.Path(sys.argv[4]).resolve();stage=sys.argv[5]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert stage in ['NODE','TSX','VITE_OPTIONAL'] and not out.exists()
assert sha(fixtures/'approved-fixture-files.json')==sys.argv[6]
assert sha(fixtures/'approved-tooling-files.json')==sys.argv[7]
approvedFixtures=json.loads((fixtures/'approved-fixture-files.json').read_text())
for name,digest in approvedFixtures.items():assert (fixtures/name).is_file() and not (fixtures/name).is_symlink() and sha(fixtures/name)==digest
approved=json.loads((fixtures/'approved-tooling-files.json').read_text());expectedTooling=approved['views'][stage]
view=tooling/('vite' if stage=='VITE_OPTIONAL' else 'node' if stage=='TSX' else 'empty-node')
assert view.is_dir() and not view.is_symlink()
assert not any(p.is_symlink() for p in view.rglob('*'))
actualTooling={p.relative_to(view).as_posix():sha(p) for p in view.rglob('*') if p.is_file()}
assert actualTooling==expectedTooling # Reject extras/missing/hash changes BEFORE constructing any allowlist.
source=inert/'snapshots/candidate';deps=inert/'deps/node_modules';qdrant=inert/'candidate-qdrant'
expected=json.loads((inert/'verified-inputs.json').read_text())
for folder in [source,deps,qdrant]:
 assert not folder.is_symlink() and not any(p.is_symlink() for p in folder.rglob('*'))
 prefix=folder.relative_to(inert).as_posix()+'/'
 actual={p.relative_to(inert).as_posix():sha(p) for p in folder.rglob('*') if p.is_file()}
 assert actual=={key:value for key,value in expected.items() if key.startswith(prefix)}
assert sha(source/'server/mcp/mcpServer.ts')=='c89afb3199e77e076ae9ea3698112a9d4d9fc5edaa32bcf2fe2d395c816407eb'
assert sha(source/'tsconfig.node.json')=='aad0d5635093da8f097c36f203569c4074aeb679a215fed98e9ab9a230b705d2'
# Flatten EXACT current mounted source/dependency/Qdrant view for trusted pre/posthash, not target-only checks.
sourceMap={}
for folder,prefix in [(source,'/source/'),(deps,'/source/node_modules/')]:
 for p in folder.rglob('*'):
  if p.is_file():sourceMap[prefix+p.relative_to(folder).as_posix()]=sha(p)
qprefix='/source/node_modules/@qdrant/js-client-rest/'
sourceMap={key:value for key,value in sourceMap.items() if not key.startswith(qprefix)}
for p in qdrant.rglob('*'):
 if p.is_file():sourceMap[qprefix+p.relative_to(qdrant).as_posix()]=sha(p)
assert len(sourceMap)<=100000
out.mkdir();control=out/'control';denied=out/'denied';control.mkdir();denied.mkdir()
controlNames=['probe.mjs','load-boundary.cjs','boundary-controls.cjs','async-guard.mjs','stage-runner.cjs','cases.json']
for name in controlNames:shutil.copyfile(fixtures/name,control/name)
# Immutable existing synthetic files needed for CJS resolution before the load hook refuses evaluation.
for name in ['sentinel.mjs','sentinel.cjs']:shutil.copyfile(fixtures/name,denied/name)
(denied/'native-sentinel.node').write_bytes(b'INERT_NON_NATIVE_SENTINEL_NEVER_DLOPEN\n')
files={'/control/'+name:sha(control/name) for name in ['probe.mjs','load-boundary.cjs','boundary-controls.cjs','async-guard.mjs']}
files.update({'/tooling/'+name:digest for name,digest in expectedTooling.items()})
native=['/tooling/'+approved['nativeFile']] if stage=='VITE_OPTIONAL' else []
assert not any(key.startswith('/denied/') for key in files)
(control/'allowed-loads.json').write_text(json.dumps({'schema':1,'files':files,'nativeFiles':native},sort_keys=True)+'\n')
# All selected parent/config/target identities must be members of the complete source view.
cases=json.loads((control/'cases.json').read_text())
for row in cases:
 for kind in ['parent','importTarget','tsxTarget','requireTarget']:
  name=row.get(kind)
  if name and not (kind=='importTarget' and row.get('nativeMissing')):assert '/source/'+name in sourceMap
(control/'source-file-hashes.json').write_text(json.dumps(sourceMap,sort_keys=True)+'\n')
(control/'stage.json').write_text(json.dumps({'schema':1,'stage':stage,'sourceCommit':'825e9050407fe0cd7ce4bcafccccb03e7e0dbd53','sourceMap':'FULL_CANDIDATE_PLUS_SHARED_DEPS_WITH_EXACT_QDRANT_OVERLAY','qdrantManifestSha256':'4efbde6937472da4ef8ab4bf17a0e5b3b1e635f151b380b19de24c1422ab664d','toolingNativeProposed':stage=='VITE_OPTIONAL','productEvaluationAllowed':False,'runtimeAcceptance':False},sort_keys=True)+'\n')
identities={'schema':1,'stage':stage,'roots':{'/source':sourceMap,'/tooling':{'/tooling/'+k:v for k,v in expectedTooling.items()},'/denied':{'/denied/'+p.name:sha(p) for p in denied.iterdir()},'/control':{'/control/'+p.name:sha(p) for p in control.iterdir()}}}
(control/'identities.json').write_text(json.dumps(identities,sort_keys=True)+'\n')
# The host/controller MUST pass this digest as immutable stage-runner arg after verifying these mounts.
print(json.dumps({'stage':stage,'identitiesSha256':sha(control/'identities.json'),'controlRoot':str(control),'deniedRoot':str(denied),'toolingView':str(view)}))
for folder in [control,denied]:
 for p in folder.iterdir():p.chmod(0o444)
 folder.chmod(0o755)
