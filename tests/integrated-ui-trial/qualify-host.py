#!/usr/bin/env python3
"""REVIEW SOURCE ONLY. Read-only full environment inventory, aggregate gaps.
No app, downloaded executable, sudo write, install, sysctl or network call.
"""
from native_fixed_boundary import call,deny,blocked_receipt,NativeFixedFailure
from pathlib import Path
import ctypes.util,hashlib,json,os,shutil,subprocess,sys,time,importlib.util
QUALIFICATION_STARTED=time.monotonic()
QUALIFICATION_REMAINING=float(os.environ.get('QUALIFICATION_REMAINING_SECONDS','0'))
assert 3<QUALIFICATION_REMAINING<=30,'QUALIFICATION_SUPERVISOR_BUDGET_REQUIRED'
QUALIFICATION_DEADLINE=QUALIFICATION_STARTED+min(27,QUALIFICATION_REMAINING-3)
out=Path(sys.argv[1]);assert not out.exists();gaps=[];r={'status':'READ_ONLY_INVENTORY_NOT_RUNTIME_PASS','checks':{},'gaps':gaps}
def check(name,fn):
 try:r['checks'][name]={'ok':True,'value':fn()}
 except BaseException as e:gaps.append(name);r['checks'][name]={'ok':False,'type':type(e).__name__,'message':str(e)}
def require(v,msg):
 assert v,msg
 return v
def osidentity():
 d=dict(l.split('=',1)for l in Path('/etc/os-release').read_text().splitlines()if '='in l);require(d['ID'].strip('"')=='ubuntu'and d['VERSION_ID'].strip('"')=='24.04','EXACT_NOBLE_REQUIRED');require(subprocess.check_output(['dpkg','--print-architecture'],timeout=3).strip()==b'amd64','AMD64_REQUIRED');return{'ID':d['ID'],'VERSION_ID':d['VERSION_ID'],'ImageOS':os.environ.get('ImageOS'),'ImageVersion':os.environ.get('ImageVersion')}
check('os-image',osidentity)
for name in ['sudo','git','python3','gpg','gpgv','dpkg','dpkg-query','dpkg-deb','dpkg-divert','update-alternatives']:
 check('executable:'+name,lambda n=name:require(shutil.which(n),'MISSING:'+n))
check('sudo-noninteractive',lambda:subprocess.check_output(['sudo','-n','true'],timeout=3).decode())
check('node',lambda:require(subprocess.check_output(['node','--version'],timeout=3).strip()==b'v22.18.0','NODE_VERSION'))
check('node-sha',lambda:require(hashlib.sha256(Path(shutil.which('node')).resolve().read_bytes()).hexdigest()=='ccacb2d6d87ba6d118b2bffc1ae33747a05cc5fc6b1f1ec4fc1d420b687e952d','NODE_IDENTITY'))
check('root-cgroup-v2',lambda:require(Path('/sys/fs/cgroup/cgroup.controllers').is_file(),'V2_REQUIRED'))
check('root-controllers-already-enabled',lambda:require({'memory','cpu','pids'}<=set(Path('/sys/fs/cgroup/cgroup.subtree_control').read_text().split()),'NO_ROOT_CONTROLLER_MUTATION_ALLOWED'))
check('root-cgroup-writable',lambda:subprocess.check_output(['sudo','-n','test','-w','/sys/fs/cgroup'],timeout=3).decode())
check('physical-headroom',lambda:require(int(next(l.split()[1]for l in Path('/proc/meminfo').read_text().splitlines()if l.startswith('MemAvailable:')))*1024>=4*1024**3,'FOUR_GIB_AVAILABLE_REQUIRED'))
check('disk-headroom',lambda:require(shutil.disk_usage(out.parent).free>=8*1024**3,'EIGHT_GIB_FREE_REQUIRED'))
for path in ['/usr/bin/python3','/usr/bin/node','/lib64/ld-linux-x86-64.so.2','/etc/fonts','/usr/share/fonts','/etc/ssl/certs']:
 # /usr/bin/node is image-owned and NOT selected Node. Record only; no requirement.
 if path=='/usr/bin/node':r['checks']['image-node-not-used']={'ok':True,'exists':Path(path).exists()};continue
 check('path:'+path,lambda p=path:require(Path(p).exists(),'MISSING:'+p))
# Exact Chromium1.58.2 Linux native dependency names, static official asset audit.
for lib in ['asound','atk-1.0','atk-bridge-2.0','atspi','cairo','cups','dbus-1','drm','gbm','glib-2.0','gobject-2.0','gio-2.0','nspr4','nss3','nssutil3','pango-1.0','X11','xcb','Xcomposite','Xdamage','Xext','Xfixes','xkbcommon','Xrandr','udev','expat','gcc_s','fontconfig','freetype']:
 check('library:'+lib,lambda n=lib:require(ctypes.util.find_library(n),'UNRESOLVED:'+n))
for p in ['/proc/sys/kernel/apparmor_restrict_unprivileged_userns','/proc/sys/kernel/unprivileged_userns_clone','/proc/sys/user/max_user_namespaces','/proc/self/attr/current']:
 r['checks']['policy-read:'+p]={'exists':Path(p).exists(),'value':Path(p).read_text().strip()if Path(p).exists()else None,'changed':False}
r['checks']['namespace-host']={'net':os.readlink('/proc/self/ns/net'),'mount':os.readlink('/proc/self/ns/mnt'),'pid':os.readlink('/proc/self/ns/pid'),'user':os.readlink('/proc/self/ns/user')}
r['next']='Actual bounded same-launcher namespace/cgroup/capability/loader probe still required; library discovery is not executable load proof.'
# SOURCE-ONLY proposed integration. Trusted supervisor supplies four already
# protected descriptors/identities; missing custody is a hard qualification gap.
# All old host checks above are preserved, same original30s outer command bound.
def regular_native_extension():
 coordinator=None;inventory=None;sinkfd=None;sinkid=None
 def load(name,filename):
  here=Path(__file__).resolve().parent
  spec=call('MODULE_SPEC',importlib.util.spec_from_file_location,name,here/filename)
  module=call('MODULE_CREATE',importlib.util.module_from_spec,spec)
  sys.modules[name]=module
  call('MODULE_EXEC',spec.loader.exec_module,module)
  return module
 try:
  if len(sys.argv)!=8:deny('EXTENSION_ARGS','SUPERVISOR_FD_ADMISSION_REQUIRED')
  privatefd,sinkfd=call('EXTENSION_ARGS',int,sys.argv[2]),call('EXTENSION_ARGS',int,sys.argv[3])
  privateid=(call('EXTENSION_ARGS',int,sys.argv[4]),call('EXTENSION_ARGS',int,sys.argv[5]))
  sinkid=(call('EXTENSION_ARGS',int,sys.argv[6]),call('EXTENSION_ARGS',int,sys.argv[7]))
  if call('CLOCK_READ',time.monotonic)>=QUALIFICATION_DEADLINE:deny('EXTENSION_BUDGET','NO_EXTENSION_BUDGET_REMAINS')
  load('native_finite_exporter','native_finite_exporter.py')
  load('native_receipt_schema','native_receipt_schema.py')
  coordinator=load('native_fd_coordinator','native_fd_coordinator.py')
  inventory=load('regular_native_inventory','qualify-regular-native-inventory-source.py')
  fd=None;raw=bytearray();primary=None
  try:
   fd=call('CONTRACT_OPEN',os.open,Path(__file__).with_name('regular-native-contract.json'),os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW)
   while True:
    block=call('CONTRACT_READ',os.read,fd,min(4096,65537-len(raw)))
    if not block:break
    raw.extend(block)
    if len(raw)>65536:deny('CONTRACT_READ','CONTRACT_INCOMPLETE')
  except BaseException as original:primary=original;raise
  finally:
   if fd is not None:
    try:call('CONTRACT_CLOSE',os.close,fd)
    except BaseException:
     if primary is not None:primary.cleanupFailed=True
     else:raise
  def contract_pairs(items):
   result={}
   for key,value in items:
    if key in result:deny('CONTRACT_PARSE','CONTRACT_INCOMPLETE')
    result[key]=value
   return result
  def no_constant(_):deny('CONTRACT_PARSE','CONTRACT_INCOMPLETE')
  contract=call('CONTRACT_PARSE',json.loads,raw,object_pairs_hook=contract_pairs,parse_constant=no_constant)
  coordinator.run_extension(inventory.inventory_regular_chrome_requirements,contract,
     QUALIFICATION_DEADLINE,privatefd,privateid,sinkfd,sinkid,(inventory.QualificationIncomplete,))
 except BaseException as original:
  trusted=(inventory.QualificationIncomplete,)if inventory is not None else()
  if not getattr(original,'receiptWritten',False)and not getattr(original,'sinkAttempted',False):
   receipt=blocked_receipt(original,trusted)
   if coordinator is not None and sinkfd is not None and sinkid is not None:
    try:coordinator.write_fixed_sink(receipt,sinkfd,sinkid)
    except BaseException:coordinator.failure_fallback(original,trusted)
   else:
    # Bootstrap failed before safe sink writer was available. Only source-fixed
    # finite diagnostic, never a substitute for the mandatory receipt file.
    try:print(json.dumps({'fixedNativeFallback':receipt,'receiptWriteFailed':True},sort_keys=True))
    except BaseException:original.cleanupFailed=True
  raise
 return 'STATIC_METADATA_ONLY_NOT_NATIVE_QUALIFIED'
def guarded_regular_native_extension():
 try:return call('QUALIFIER_EXTENSION',regular_native_extension)
 except BaseException:
  # Detailed source-owned finite receipt/fallback is separate; no raw exception
  # enters the legacy host JSON/log or traceback.
  raise RuntimeError('REGULAR_NATIVE_STATIC_INCOMPLETE')from None
check('regular-native-static-extension',guarded_regular_native_extension)
out.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r));raise SystemExit(1 if gaps else 0)
