"""Preparation-only inventory/transport measurements. Never launch a capsule.
No budget changes, no runtime authorization or universal ARG_MAX guarantee.
"""
import ast,collections,os,pathlib,struct,resource

def summarize(manifest,app,output,stdlib,launcher,npm_paths,emitted_sources,arg_max=None,environ=None):
 unclassified=[]
 dispositions=collections.defaultdict(lambda:{'files':0,'bytes':0})
 groups=collections.defaultdict(lambda:{'files':0,'bytes':0})
 packages=collections.defaultdict(lambda:{'files':0,'bytes':0})
 def add(table,key,row):
  table[key]['files']+=1;table[key]['bytes']+=row['bytes']
 for row in manifest:
  src=row['source'];add(dispositions,row['disposition'],row)
  if row['disposition']=='review-only':group='review-only'
  elif src.startswith('app/node_modules/'):
   group='npm-runtime';p=app/pathlib.Path(src).relative_to('app')
   while p!=app and str(p.relative_to(app)) not in npm_paths:p=p.parent
   assert p!=app,'DIAGNOSTIC_PACKAGE_ORIGIN'
   add(packages,str(p.relative_to(app)),row)
  elif src in emitted_sources:group='app-emitted-fixed-source'
  elif src in {'app/package.json','app/hydration-gates-entry.cjs','app/inside-supervisor.py','app/fixture-config.json','app/launch-capsule.py','app/native-selection-guard.cjs','app/runtime-env.json','app/native-selection.json'}:group='app-reviewed-control'
  elif src.startswith('app/db/migrations/sqlite/') and src.endswith('.sql'):group='app-sqlite-migrations'
  elif src.startswith('app/'):group='unclassified';unclassified.append(src)
  elif src.startswith('runtime/'+str(stdlib).lstrip('/')+'/'):group='python-stdlib'
  elif src.startswith('runtime/'):
   with (output/src).open('rb') as f:magic=f.read(4)
   if magic==b'\x7fELF':group='runtime-elf-and-executables'
   else:group='unclassified';unclassified.append(src)
  else:group='unclassified';unclassified.append(src)
  add(groups,group,row)
 assert sum(x['files'] for x in groups.values())==sum(x['files'] for x in dispositions.values())==len(manifest),'DIAGNOSTIC_COUNT_SUM'
 assert sum(x['bytes'] for x in groups.values())==sum(x['bytes'] for x in dispositions.values())==sum(r['bytes'] for r in manifest),'DIAGNOSTIC_BYTE_SUM'
 sources=[r['source'] for r in manifest];targets=[r['target'] for r in manifest if r['disposition']=='mountable']
 assert len(sources)==len(set(sources)),'DIAGNOSTIC_DUPLICATE_SOURCE'
 assert len(targets)==len(set(targets)),'DIAGNOSTIC_DUPLICATE_TARGET'
 # Read the reviewed launcher as AST data, never import/call it. Verify the
 # actual bind triplet before counting argv, rather than guessing its shape.
 tree=ast.parse(launcher.read_text());main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
 base=next(n.value for n in main.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='argv' for t in n.targets))
 argv=ast.literal_eval(base)
 changes=[n for n in ast.walk(main) if isinstance(n,ast.AugAssign) and isinstance(n.target,ast.Name) and n.target.id=='argv']
 assert len(changes)==2,'DIAGNOSTIC_ARGV_SHAPE'
 bind=next(n for n in changes if any(isinstance(x,ast.Constant) and x.value=='--ro-bind' for x in ast.walk(n)))
 assert ast.unparse(bind.value)=="['--ro-bind', str(src), target]",'DIAGNOSTIC_BIND_SHAPE'
 tail=next(n for n in changes if n is not bind);tail=ast.literal_eval(tail.value)
 for row in manifest:
  if row['disposition']=='mountable':argv+=['--ro-bind',str(output/row['source']),row['target']]
 argv+=tail
 env=dict(os.environ if environ is None else environ)
 argv_bytes=sum(len(os.fsencode(x))+1 for x in argv)
 env_bytes=sum(len(os.fsencode(k+'='+v))+1 for k,v in env.items())
 pointers=(len(argv)+len(env)+2)*struct.calcsize('P')
 limit=os.sysconf('SC_ARG_MAX') if arg_max is None else arg_max
 total=argv_bytes+env_bytes+pointers
 return {'groups':dict(sorted(groups.items())),'npmPackages':dict(sorted(packages.items())),'dispositions':dict(sorted(dispositions.items())),'unclassifiedPaths':sorted(unclassified),
  'uniqueSources':len(set(sources)),'uniqueMountTargets':len(set(targets)),
  'transport':{'scope':'Static exact launcher argv at this preparation directory, current inherited environment lengths only. No argv values/environment values emitted. Future path/env/limits may differ; not execution or namespace evidence.',
   'stackLimitBytes':list(resource.getrlimit(resource.RLIMIT_STACK)),'artifactAbsolutePrefixBytes':len(os.fsencode(str(output))),
   'argc':len(argv),'argvBytesWithNulls':argv_bytes,'environmentCount':len(env),'environmentBytesWithNulls':env_bytes,
   'pointerBytes':pointers,'estimatedExecBytes':total,'argMax':limit,'headroomBytes':limit-total,
   'largestArgumentBytes':max(len(os.fsencode(x))+1 for x in argv),'pageSize':os.sysconf('SC_PAGE_SIZE'),
   'linuxPerArgumentLimitBytes':32*os.sysconf('SC_PAGE_SIZE'),'underMeasuredArgMax':total<limit}}
