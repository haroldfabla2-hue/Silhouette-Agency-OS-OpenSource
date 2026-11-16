# Public output contains only diagnostics derived from authorized public source.
# Raw receipts, environments, downloader/service output and hashes are not emitted.
import pathlib,sys,json,re
out=pathlib.Path(sys.argv[1]);p=out/'comparison.json'
safe=out/'safe-diagnostics';safe.mkdir(exist_ok=True)
if not p.exists():raise SystemExit('No completed comparison records; preparation/control failure, no result')
rows=json.loads(p.read_text());output=[]
for row in rows:
 side=row['side']
 output.append('=== '+side+' compiler exit '+str(row['exit'])+' ===\n')
 for ext in ['stdout','stderr']:
  q=out/(side+'.'+ext)
  if q.stat().st_size>16*1024**2:raise SystemExit('Oversize diagnostics; output held')
  output.append(q.read_text(errors='replace'))
text=''.join(output)
patterns=[r'gh[pousr]_[A-Za-z0-9_]{20,}',r'github_pat_[A-Za-z0-9_]{20,}',r'sk-[A-Za-z0-9_-]{20,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'AKIA[0-9A-Z]{16}',r'https?://[^\s/:]+:[^\s/@]+@',r'wamid\.',r'agent-01[A-Z0-9]{16,}',r'chat-01[A-Z0-9]{16,}']
if any(re.search(pattern,text) for pattern in patterns):raise SystemExit('Potential non-public/credential-shaped output; all raw diagnostics held, no automatic upload')
# No source lines are removed or changed. Artifact contents must be safe even if public.
for row in rows:
 for ext in ['stdout','stderr']:
  q=out/(row['side']+'.'+ext);(safe/q.name).write_bytes(q.read_bytes())
summary={'runs':[{'side':r['side'],'exit':r['exit'],'elapsedSeconds':r['elapsedSeconds']} for r in rows],'productReadiness':False}
post=out/'postcheck.json'
if post.exists():summary['postcheck']=json.loads(post.read_text())
else:summary['postcheck']={'classification':'INCOMPLETE_NO_POSTCHECK'}
state=out/'service-state.txt'
summary['serviceStopped']=state.exists() and state.read_text().strip() in ['inactive','failed','not-found','']
(safe/'summary.json').write_text(json.dumps(summary,indent=2))
print('Scanned compiler diagnostics prepared. No command/environment/private receipts included.')
if not summary['serviceStopped'] or not summary['postcheck'].get('sourceUnchanged') or not summary['postcheck'].get('inputsUnchanged') or summary['postcheck'].get('otherProcessCount',1)!=0 or any(summary['postcheck'].get('memoryEventDelta',{}).get(k,0) for k in ['max','oom','oom_kill','oom_group_kill']):raise SystemExit('INCOMPLETE post-run/resource/cleanup verification')
if len(rows)!=2 or any(row['exit'] not in [0,2] for row in rows):raise SystemExit('INCOMPLETE comparison; no retry')
if any(row['exit']!=0 for row in rows):raise SystemExit('Completed compiler diagnostics contain errors; no semantic PASS')
print('Both compiler commands completed with zero diagnostics; independent comparison review still required. This is not product readiness.')
