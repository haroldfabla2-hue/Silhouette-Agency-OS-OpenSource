"""Source candidate only. Fixed readelf inspection, NEVER ldd on package code.
No module-time work. Files inside reviewed dependency store only; no load smoke.
"""
import hashlib,os,pathlib,re,subprocess
STORE=pathlib.Path('/tmp/work/node_modules')
def _file(p):
    p=pathlib.Path(p);assert p.is_file()
    with p.open('rb')as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
    return {'path':str(p),'bytes':p.stat().st_size,'sha256':sha}

def inspect_native_files(relative_paths):
    # Trusted exact inventory supplies paths; no shell or dynamic interpreter.
    tools={name:_file(pathlib.Path('/usr/bin')/name)for name in ['cc','make','ar','ranlib','readelf','ld']}
    dirs=[pathlib.Path(x)for x in ['/lib/x86_64-linux-gnu','/usr/lib/x86_64-linux-gnu','/lib64','/usr/lib64']]
    rows=[]
    for rel in relative_paths:
        p=STORE/rel
        assert not pathlib.PurePosixPath(rel).is_absolute()and'..'not in pathlib.PurePosixPath(rel).parts
        assert p.resolve().is_relative_to(STORE.resolve())and p.is_file()and not p.is_symlink()
        with p.open('rb')as f:magic=f.read(4)
        if magic!=b'\x7fELF':continue
        env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'}
        proc=subprocess.run(['/usr/bin/readelf','--dynamic','--program-headers',str(p)],env=env,capture_output=True,timeout=3)
        assert proc.returncode==0 and len(proc.stdout)<=131072 and len(proc.stderr)<=4096
        text=proc.stdout.decode('ascii','strict');needed=re.findall(r'\(NEEDED\).*?\[([^\]]+)\]',text)
        interpreter=re.findall(r'Requesting program interpreter: ([^\]]+)',text)
        libs=[]
        for name in needed:
            assert re.fullmatch(r'[A-Za-z0-9_.+-]{1,128}',name)
            found=next((d/name for d in [p.parent,*dirs]if(d/name).is_file()),None)
            libs.append({'soname':name,'resolution':_file(found.resolve())if found else'UNRESOLVED_NOT_LOAD_ADMITTED'})
        rows.append({'file':_file(p),'needed':libs,'interpreter':[_file(pathlib.Path(x).resolve())for x in interpreter],
                     'loader_claim':'COMMON_SEARCH_DIRECTORY_CANDIDATES_ONLY_NOT_ACTUAL_RUNTIME_MAPS_OR_TRANSITIVE_CLOSURE'})
    # Source helpers record identity, do not imply toolchain bit reproducibility.
    assert tools=={name:_file(pathlib.Path('/usr/bin')/name)for name in tools}
    return {'status':'STATIC_ELF_PROVENANCE_NOT_NATIVE_LOAD_ACCEPTANCE','toolchain_identities':tools,'files':rows,
            'runtime_requirement':'actual /proc/PID/maps physical library identities, exact package owners and independent closure after real calls'}
