#!/usr/bin/env python3
"""REVIEW SOURCE ONLY. Read-only full environment inventory, aggregate gaps.
No app, downloaded executable, sudo write, install, sysctl or network call.
"""
from pathlib import Path
import ctypes.util,hashlib,json,os,shutil,subprocess,sys
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
out.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r));raise SystemExit(1 if gaps else 0)
