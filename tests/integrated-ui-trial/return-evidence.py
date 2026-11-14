#!/usr/bin/env python3
"""Project test evidence only. Public log transport, NOT privacy by encoding."""
from pathlib import Path
import os,hashlib,tarfile,io,json,re,base64
root=Path(os.environ['RUNNER_TEMP'])/'silhouette-integrated-ui/evidence';assert root.is_dir(),'NO_EVIDENCE_NO_PASS'
# Deliberately not generic file upload. Only this project's receipts, test logs,
# and actual fresh providerOFF UI PNG. No source tree, env, browser HAR/storage,
# authentication payloads, cookies, profile/database or operating transcripts.
allowed={'host-qualification.log','host-qualification-receipt.json','host-qualification.json','security-preparation.log','security-preparation-receipt.json','security-preparation.json','security-chain/result.json','security-chain/gpgv-status.txt','security-chain/selected-stanza.json','security-chain/loader.txt','security-chain/key-fingerprints.txt','security-chain/ip-identity.json','security-helpers-state.json','environment-probe.log','environment-probe-receipt.json','environment-probe/root-preflight.json','environment-probe/network.json','environment-probe/supervisor.json','environment-probe/complete.log','runtime-prerequisites/root-preflight.json','runtime-prerequisites/network.json','runtime-prerequisites/supervisor.json','runtime-prerequisites/complete.log','environment-probe/qualification.json','runtime-prerequisites/prerequisites.json','runtime-prerequisites/prerequisites-failure.json','runtime-prerequisites.log','runtime-prerequisites-receipt.json','ui-build/root-preflight.json','server-build/root-preflight.json','runtime/root-preflight.json','outer-cleanup.json','npm-config-preflight.log','npm-config-preflight-receipt.json','source-materialization.json','dependency-members.json','result.json','failure.json','dependency-acquisition.log','dependency-acquisition-receipt.json','ui-build.log','server-build.log','runtime.log','ui-build-receipt.json','server-build-receipt.json','runtime-receipt.json','ui-build/complete.log','server-build/complete.log','runtime/complete.log','ui-build/supervisor.json','server-build/supervisor.json','runtime/supervisor.json','ui-build/network.json','server-build/network.json','runtime/network.json','runtime/actual-ui.png','runtime/browser.json','runtime/browser-failure.json','runtime/runtime-result.json','runtime/exit-frontier.json'}
# Secret markers quarantine whole file. No lossy log rewrite or truncation.
secret=re.compile(rb'(?i)(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|nvapi-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:authorization|_authToken|api[_-]?key|password|set-cookie)\s*[:=]\s*["\x27]?(?!null\b|undefined\b|false\b|\$NVIDIA_API_KEY)[A-Za-z0-9+/=_-]{12,}|https?://[^/\s:@]+:[^/\s@]+@)')
# Read exact ephemeral values privately, never include them in any receipt,
# error, hash list or frame. Refuse symlink/mode/length irregularities.
denyValues=[]
for phase in ['runtime-prerequisites','ui-build','server-build','runtime']:
 d=root/phase/'.export-deny-api-token'
 if d.exists():
  assert d.is_file()and not d.is_symlink()and d.stat().st_mode&0o777==0o600,'EXPORT_DENY_FILE_INVALID'
  value=d.read_bytes();assert re.fullmatch(rb'[A-Za-z0-9_-]{43}',value),'EXPORT_DENY_VALUE_INVALID'
  denyValues.append(value)
# Catch labeled assignments/headers too, including a value not yet in the deny
# file if setup was interrupted. Matching quarantines the ENTIRE original file.
credentialPattern=re.compile(rb'(?i)(?:SILHOUETTE_API_(?:TOKEN|KEY)\s*[=:]\s*[\"\x27]?[A-Za-z0-9_+/=-]{8,}|(?:authorization|proxy-authorization)\s*[\"\x27]?\s*[:=]\s*[\"\x27]?(?:Bearer|Basic)\s+[A-Za-z0-9_+/=.-]{8,}|(?:x-api-key|x-auth-token)\s*[\"\x27]?\s*[:=]\s*[\"\x27]?[A-Za-z0-9_+/=.-]{8,})')
rows=[];total=0;quarantine=[];buf=io.BytesIO()
with tarfile.open(fileobj=buf,mode='w:gz')as t:
 for p in sorted(root.rglob('*')):
  if not p.is_file():continue
  rel=str(p.relative_to(root))
  if rel not in allowed:continue
  assert not p.is_symlink();b=p.read_bytes();assert len(b)<=16*1024**2,'FILE_CAPTURE_CAP'
  if any(value in b for value in denyValues)or(not rel.endswith('.png')and(secret.search(b)or credentialPattern.search(b))):quarantine.append({'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'reason':'POSSIBLE_SECRET_QUARANTINE'});continue
  total+=len(b);assert total<=64*1024**2,'RAW_CAPTURE_CAP'
  row={'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()};rows.append(row);info=tarfile.TarInfo(rel);info.size=len(b);info.mode=0o600;t.addfile(info,io.BytesIO(b))
 receipt=(json.dumps({'files':rows,'quarantine':quarantine,'completeAllowlistedFiles':True,'publicAudience':'sanitized project test evidence only','status':'FAIL_QUARANTINED_EVIDENCE'if quarantine else'CAPTURED_NOT_PRODUCT_PASS'},indent=2)+'\n').encode();ti=tarfile.TarInfo('capture.json');ti.size=len(receipt);t.addfile(ti,io.BytesIO(receipt))
raw=buf.getvalue();assert len(raw)<=8*1024**2,'ENCODED_CAPTURE_CAP_NO_TRUNCATION';digest=hashlib.sha256(raw).hexdigest();enc=base64.b64encode(raw).decode();chunks=[enc[i:i+2048]for i in range(0,len(enc),2048)]
print('SILHOUETTE_PUBLIC_TEST_FRAME_BEGIN '+json.dumps({'sha256':digest,'bytes':len(raw),'chunks':len(chunks),'encoding':'base64-tar.gz','quarantined':len(quarantine)}))
for i,c in enumerate(chunks):print('SILHOUETTE_PUBLIC_TEST_CHUNK '+str(i)+' '+c)
print('SILHOUETTE_PUBLIC_TEST_FRAME_END '+digest)
if quarantine:raise SystemExit(1)
