#!/usr/bin/env python3
"""Read files after native process termination; no library execution."""
import hashlib,json,pathlib,re,stat,sys
store=pathlib.Path(sys.argv[1]);evidence=pathlib.Path(sys.argv[2]);rows=[]
for rel in ['better-sqlite3','@xenova/transformers/node_modules/sharp']:
 for p in sorted((store/rel).rglob('*')):
  if p.is_symlink():continue
  if p.is_file()and(p.suffix=='.node'or'/vendor/'in str(p)):
   st=p.stat();assert st.st_size<=64*1024**2
   rows.append({'path':str(p.relative_to(store)),'bytes':st.st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
urls=[]
for p in evidence.glob('*.log'):
 for url in re.findall(r'https?://[^\s<>\x22\x27]+',p.read_text(errors='replace')):
  urls.append({'source_log':p.name,'observed_url':url})
(evidence/'native-provenance.json').write_text(json.dumps({'binaries':rows,'log_observed_urls':urls,'caveat':'Printed URLs are observed downloader diagnostics, not a complete packet-level redirect trace or integrity-lock for downloaded binaries'},indent=2)+'\n')
