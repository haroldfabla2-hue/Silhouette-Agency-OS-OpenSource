# Draft only. Executes pinned TypeScript, never the application or package hooks.
import pathlib,sys,subprocess,os,json,hashlib,time
root=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve()
cgroup=pathlib.Path('/sys/fs/cgroup')/next(line.split(':',2)[2].strip().lstrip('/') for line in pathlib.Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
if not (cgroup/'memory.max').read_text().strip().isdigit() or int((cgroup/'memory.max').read_text())>6*1024**3 or int((cgroup/'memory.swap.max').read_text())!=0 or int((cgroup/'pids.max').read_text())>32:raise RuntimeError('Hard limits not active')
available=int(next(line.split()[1] for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
if available<8*1024**3:raise RuntimeError('Insufficient sampled headroom')
# Fail closed if runtime libraries are not available under these explicit library mounts.
base=['/usr/bin/bwrap','--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL','--dir','/runtime','--ro-bind',str(out/'runtime/node'),'/runtime/node','--ro-bind','/lib/x86_64-linux-gnu','/lib/x86_64-linux-gnu','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--ro-bind',str(out/'compiler'),'/compiler']
eventsBefore={k:int(v) for k,v in (line.split() for line in (cgroup/'memory.events').read_text().splitlines())}
reports=[];env={'PATH':'/runtime','HOME':'/nonexistent','TMPDIR':'/tmp','NODE_DISABLE_COMPILE_CACHE':'1','LANG':'C.UTF-8'}
try:
 probe=base+['--ro-bind',str(out/'snapshots/candidate'),'/source','--ro-bind',str(out/'deps/node_modules'),'/source/node_modules','--chdir','/source','/runtime/node','-e',"const fs=require('fs'),net=require('net'); if(process.version!=='v22.23.4')process.exit(91);let denied=false;try{fs.writeFileSync('/source/package.json','denial probe')}catch(e){denied=e.code==='EROFS'||e.code==='EACCES'}if(!denied)process.exit(92);fs.writeFileSync('/tmp/allowed','probe');let s=net.connect({host:'198.51.100.1',port:9});s.on('connect',()=>process.exit(93));s.on('error',e=>process.exit(['ENETUNREACH','EACCES','EPERM'].includes(e.code)?0:94));s.setTimeout(1000,()=>process.exit(95));"]
 with (out/'isolation.stdout').open('wb') as stdout,(out/'isolation.stderr').open('wb') as stderr:
  check=subprocess.run(['/usr/bin/timeout','5s']+probe,env=env,stdout=stdout,stderr=stderr,stdin=subprocess.DEVNULL)
 if check.returncode!=0:raise RuntimeError('Runtime or isolation probe failed; do not loosen controls')
 
 for side in ['baseline','candidate']:
  cmd=['/usr/bin/timeout','--signal=TERM','--kill-after=2s','300s','/usr/bin/prlimit','--cpu=280:280','--fsize=16777216:16777216','--nofile=128:128','--nproc=32:32']+base+['--ro-bind',str(out/'snapshots'/side),'/source','--ro-bind',str(out/'deps/node_modules'),'/source/node_modules','--chdir','/source','/runtime/node','--max-old-space-size=2560','/compiler/lib/_tsc.js','--project','/source/tsconfig.node.json','--noEmit','--incremental','false','--pretty','false']
  started=time.monotonic()
  with (out/(side+'.stdout')).open('wb') as stdout,(out/(side+'.stderr')).open('wb') as stderr:
   p=subprocess.run(cmd,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr)
  reports.append({'side':side,'exit':p.returncode,'elapsedSeconds':time.monotonic()-started,'command':cmd,'environment':env,'logs':{ext:hashlib.sha256((out/(side+'.'+ext)).read_bytes()).hexdigest() for ext in ['stdout','stderr']}})
  (out/'comparison.json').write_text(json.dumps(reports,indent=2))
  # Resource abort means incomplete; do not escalate heap/retry. Baseline diagnostics exit2 is valid.
  if p.returncode not in [0,2]:raise RuntimeError('Incomplete resource/control failure; no retry')
finally:
 eventsAfter={k:int(v) for k,v in (line.split() for line in (cgroup/'memory.events').read_text().splitlines())}
 expected=json.loads((root/'candidate/.github/inert-compiler/source-hashes.json').read_text())
 for side in ['baseline','candidate']:
  src=out/'snapshots'/side
  actual={p.relative_to(src).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in src.rglob('*') if p.is_file()}
  if actual!=expected[side]:raise RuntimeError('Post-run source mismatch')
 otherPids=[int(x) for x in (cgroup/'cgroup.procs').read_text().split() if int(x)!=os.getpid()]
 inputHashes=json.loads((out/'verified-inputs.json').read_text())
 inputsUnchanged=all((out/rel).is_file() and hashlib.sha256((out/rel).read_bytes()).hexdigest()==digest for rel,digest in inputHashes.items())
 clean={'inputsUnchanged':inputsUnchanged,'sourceUnchanged':True,'otherProcessCount':len(otherPids),'memoryEventDelta':{k:eventsAfter[k]-eventsBefore.get(k,0) for k in eventsAfter},'classification':'COMMANDS_COMPLETED_NOT_PRODUCT_READINESS'}
 (out/'postcheck.json').write_text(json.dumps(clean,indent=2))
 if not inputsUnchanged or otherPids or any(clean['memoryEventDelta'].get(k,0) for k in ['oom','oom_kill','oom_group_kill','max']):raise RuntimeError('Incomplete resource or process cleanup failure')
 # Exit0 means command completion only. It is not a semantic PASS or readiness verdict.
