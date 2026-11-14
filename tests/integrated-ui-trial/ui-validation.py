#!/usr/bin/env python3
"""Existing ui-build phase only. Real validation, ordinary failures retained.
No privilege, network, resource-bound or source-state expansion.
"""
import subprocess,time,json,pathlib
start=time.monotonic();rows=[]
def run(name,args,timeout):
 print('FINITE_VALIDATION_START '+name,flush=True)
 try:
  p=subprocess.run(args,timeout=timeout,check=False);r={'name':name,'code':p.returncode,'timeout':False}
 except subprocess.TimeoutExpired:
  # No success is claimed. Outer supervisor remains descendant authority.
  r={'name':name,'code':None,'timeout':True}
 rows.append(r);print('FINITE_VALIDATION_END '+json.dumps(r),flush=True);return r
try:
 run('complete-project-typecheck',['/node/bin/node','/app/node_modules/typescript/bin/tsc','--noEmit','--pretty','false','--project','/app/tsconfig.json'],60)
 # Exact production-used loop, not controller/service graph substitutes.
 run('real-telemetry-loop-regressions',['/node/bin/node','--import','tsx/esm','/driver/telemetry-regression.mts'],40)
 build=run('actual-ui-build',['/node/bin/node','/app/node_modules/vite/bin/vite.js','build','--sourcemap'],55)
 if build['code']==0:
  run('actual-emitted-bootstrap-inspection',['/node/bin/node','/driver/inspect-emitted-bootstrap.cjs'],8)
 else:rows.append({'name':'actual-emitted-bootstrap-inspection','code':None,'skipped':'REAL_UI_BUILD_FAILED'})
finally:
 pathlib.Path('/evidence/finite-validation.json').write_text(json.dumps({'phase':'ui-build','status':'PASS_FINITE_CHECKS_NOT_PRODUCT_PASS'if rows and all(x.get('code')==0 for x in rows)else'FAIL','rows':rows,'elapsed':time.monotonic()-start,'actualUIBrowserProven':False,'global':'INCOMPLETE'},indent=2)+'\n')
raise SystemExit(0 if rows and all(x.get('code')==0 for x in rows)else 1)
