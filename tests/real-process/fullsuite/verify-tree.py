#!/usr/bin/env python3
"""Reviewed manifest outside work, SHA anchored in workflow, exact post-install tree."""
import hashlib,json,os,pathlib,stat,sys
work=pathlib.Path(sys.argv[1]);manifest=pathlib.Path(sys.argv[2]);expected=sys.argv[3];out=pathlib.Path(sys.argv[4])
data=manifest.read_bytes();assert hashlib.sha256(data).hexdigest()==expected,'review manifest changed'
rows={}
for line in data.decode().splitlines():
 h,rel=line.split(maxsplit=1);p=pathlib.PurePosixPath(rel)
 assert not p.is_absolute() and '..' not in p.parts and rel not in rows
 rows[rel]=h
actual=set();issues=[]
for current,dirs,files in os.walk(work,followlinks=False):
 if pathlib.Path(current)==work:dirs[:]=[n for n in dirs if n!='node_modules']
 for name in list(dirs):
  p=pathlib.Path(current)/name
  if p.is_symlink():
   actual.add(str(p.relative_to(work)));issues.append({'path':str(p.relative_to(work)),'reason':'added or replaced directory symlink'});dirs.remove(name)
 for name in files:
  p=pathlib.Path(current)/name;rel=str(p.relative_to(work));m=p.lstat();actual.add(rel)
  if not stat.S_ISREG(m.st_mode):issues.append({'path':rel,'reason':'not regular source'});continue
  if rel not in rows:issues.append({'path':rel,'reason':'added source/config/test/other file'});continue
  if hashlib.sha256(p.read_bytes()).hexdigest()!=rows[rel]:issues.append({'path':rel,'reason':'changed reviewed bytes'})
for rel in sorted(set(rows)-actual):issues.append({'path':rel,'reason':'missing source'})
# An install could fill empty directory trees, which are not source files.
result={'status':'PASS' if not issues else 'FAIL','review_manifest_sha256':expected,'expected_files':len(rows),'actual_files':len(actual),'issues':issues}
out.write_text(json.dumps(result,indent=2));raise SystemExit(0 if not issues else 1)
