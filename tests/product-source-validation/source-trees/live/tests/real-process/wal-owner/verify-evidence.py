"""Bounded independent archive validation. Reads authored test outputs only.
No execution/import of archived code, no memory records treated as instructions.
"""
import hashlib,json,pathlib,stat,sys,tarfile
root=pathlib.Path(sys.argv[1]);archive=root/'owner-harness/authored-evidence.tar.gz'
assert archive.is_file() and archive.stat().st_size<=64*1024**2
rawhash=hashlib.sha256(archive.read_bytes()).hexdigest();count=0;total=0;selected={};timers=[]
with tarfile.open(archive,'r|gz') as tar:
 for member in tar:
  count+=1;p=pathlib.PurePosixPath(member.name)
  assert count<=4096 and not p.is_absolute() and '..' not in p.parts and member.isfile(),'invalid authored evidence member'
  assert 0<=member.size<=64*1024**2
  total+=member.size;assert total<=512*1024**2
  stream=tar.extractfile(member);assert stream is not None
  wanted=member.name in ['run/results.json','run/cleanup-signals.json','run/accepted-checkpoint.json','run/accepted-denied-checkpoint.json','run/latency-raw.json','namespace-status.json']
  if wanted:
   assert member.size<=1024**2
   body=stream.read(1024**2+1);assert len(body)==member.size;selected[member.name]=json.loads(body)
  elif member.name in ['run/accepted.log','run/accepted-denied.log']:
   assert member.size<=4*1024**2
   body=stream.read(4*1024**2+1);assert len(body)==member.size
   for line in body.decode('utf8',errors='replace').splitlines():
    if line.startswith('ACCEPTED_TIMER_EVIDENCE '):
     assert len(line)<=1024**2;timers.append({'source':member.name,'evidence':json.loads(line[len('ACCEPTED_TIMER_EVIDENCE '):])})
  else:
   # Drain bounded bytes for complete archive validation, no extraction of data.
   remaining=member.size
   while remaining:
    data=stream.read(min(65536,remaining));assert data;remaining-=len(data)
assert 'run/results.json' in selected,'missing actual results, never assume pending cases passed'
results=selected['run/results.json'];assert isinstance(results,list) and len(results)==6
summary={'archiveSha256':rawhash,'members':count,'uncompressedBytes':total,'selected':selected,'timerEvidence':timers,'scope':'authored evidence validated only; no cognition/productglobal/powerloss claim'}
text=json.dumps(summary,indent=2);assert len(text.encode())<=2*1024**2
(root/'validated-owner-summary.json').write_text(text)
# Emit useful terminal summary even when diagnostic FAILED; caller preserves rc.
print(json.dumps({'archiveSha256':rawhash,'cases':[{'case':r['case'],'status':r['status'],'error':r.get('error')} for r in results],'allCasesPass':all(r['status']=='PASS' for r in results)}))
