"""INACTIVE OCI data reconstruction, no child execution or network.
Complete public image, no Docker/entrypoint. Explicit build() only after review.
"""
from pathlib import Path
import gzip,hashlib,json,os,shutil,stat,tarfile
HERE=Path(__file__).resolve().parent
MANIFEST='bb6834c0669aa71cbc8d94606561a721adf489f6b93d7b8b825f0cf1b498c2c4'
CONFIG='a1bea2f8c1ee78866f82039a60baa1c3a480872018aa0ef4891000ec793ed82b'
def need(x,code):
 if not x:raise RuntimeError(code)
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def relpath(raw):
 need(isinstance(raw,str) and raw and '\x00' not in raw and not raw.startswith('/'),'OCI_PATH')
 parts=raw.rstrip('/').split('/');need(all(p not in ('','..','.') for p in parts),'OCI_COMPONENT');return '/'.join(parts)
def canonical(raw,inventory,follow_final=True):
 parts=raw.split('/');done=[];links=0
 while parts:
  part=parts.pop(0)
  if part in ('','.'):continue
  if part=='..':
   need(bool(done),'OCI_LINK_ESCAPE');done.pop();continue
  done.append(part);entry=inventory.get('/'.join(done),{})
  if entry.get('kind')=='symlink' and (parts or follow_final):
   links+=1;need(links<=64,'OCI_LINK_LOOP');target=entry['linkname'];done=done[:-1] if not target.startswith('/') else [];parts=target.split('/')+parts
 return relpath('/'.join(done))
def parentfd(root,relative):
 # Never follows even a reviewed symlink during extraction.
 fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  parts=relpath(relative).split('/')
  for component in parts[:-1]:
   nextfd=os.open(component,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd);os.close(fd);fd=nextfd
  return fd,parts[-1]
 except BaseException:os.close(fd);raise
class HashReader:
 def __init__(self,base,limit):self.base=base;self.limit=limit;self.h=hashlib.sha256();self.count=0
 def read(self,n=-1):
  raw=self.base.read(1048576 if n<0 else n);self.count+=len(raw);need(self.count<=self.limit,'OCI_EXPANSION_BOUND');self.h.update(raw);return raw

def build(layer_directory,destination):
 need(os.geteuid()==0,'OCI_ROOT_REQUIRED');layer_directory=Path(layer_directory);need(layer_directory.stat().st_uid==0 and not layer_directory.stat().st_mode&0o022 and not layer_directory.is_symlink(),'OCI_LAYER_DIRECTORY_CUSTODY');destination=Path(destination);need(not destination.exists(),'OCI_DEST_EXISTS')
 need(sha(HERE/'node-linux-amd64-manifest.json')==MANIFEST and sha(HERE/'node-image-config.json')==CONFIG,'OCI_DESCRIPTOR_PIN')
 inventory=json.loads((HERE/'OCI-FINAL-LOGICAL-INVENTORY.json').read_text());expected_mode={k:{'before':v['mode'],'after':v['mode']&~0o6000} for k,v in inventory.items() if v['mode']&0o6000};expected_owner={k:{'uidBefore':v['uid'],'gidBefore':v['gid'],'uidAfter':0,'gidAfter':0} for k,v in inventory.items() if v['uid'] or v['gid']};need(json.loads((HERE/'MODE-OVERLAY.json').read_text())==expected_mode and json.loads((HERE/'OWNER-OVERLAY.json').read_text())==expected_owner,'OCI_EXACT_DERIVED_OVERLAYS');manifest=json.loads((HERE/'node-linux-amd64-manifest.json').read_text());config=json.loads((HERE/'node-image-config.json').read_text());need(len(inventory)==33395 and len(manifest['layers'])==8,'OCI_COUNTS')
 need(shutil.disk_usage(destination.parent).free>=12884901888,'OCI_PREPARATION_FREE_DISK_12GIB')
 stage=destination.with_name(destination.name+'.unverified');need(not stage.exists(),'OCI_STAGE_EXISTS');stage.mkdir(mode=0o700);root=stage/'root';root.mkdir(mode=0o700);dirs={};files={};links={};hardlinks={}
 try:
  for name,entry in inventory.items():
   name=relpath(name);kind=entry['kind'];need(kind in ('directory','file','symlink','hardlink'),'OCI_SPECIAL_FORBIDDEN')
   target=canonical(name,inventory,follow_final=False)
   if kind=='directory':
    target=canonical(name,inventory);dirs[target]=entry
   elif kind=='file':
    if target in files:need(files[target]['sha256']==entry['sha256'] and files[target]['mode']==entry['mode'],'OCI_ALIAS_COLLISION')
    files[target]=entry
   elif kind=='symlink':
    need(target not in links,'OCI_LINK_COLLISION');links[target]=entry
   else:hardlinks[target]=entry
  for name in sorted(dirs,key=lambda s:(s.count('/'),s)):
   path=root/name;path.mkdir(mode=0o755,parents=True,exist_ok=True);need(not path.is_symlink(),'OCI_DIRECTORY_ALIAS')
  made=set();receipts=[]
  for index,desc in enumerate(manifest['layers']):
   source=Path(layer_directory)/(desc['digest'].split(':')[1]+'.tar.gz');st=source.lstat();need(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o022,'OCI_LAYER_CUSTODY');need(source.is_file() and not source.is_symlink() and source.stat().st_size==desc['size'] and sha(source)==desc['digest'].split(':')[1],'OCI_COMPRESSED_PIN')
   with source.open('rb') as compressed,gzip.GzipFile(fileobj=compressed) as gz:
    raw=HashReader(gz,2147483648);seen=set()
    with tarfile.open(fileobj=raw,mode='r|') as archive:
     for row in archive:
      name=row.name.rstrip('/');name=name[2:] if name.startswith('./') else name
      if not name:continue
      name=relpath(name);need(name not in seen,'OCI_LAYER_DUPLICATE');seen.add(name);need(not Path(name).name.startswith('.wh.'),'OCI_UNEXPECTED_WHITEOUT')
      kind='file' if row.isfile() else 'directory' if row.isdir() else 'symlink' if row.issym() else 'hardlink' if row.islnk() else 'special';need(kind!='special','OCI_SPECIAL_FORBIDDEN')
      final=inventory.get(name)
      if final is None or final['layer']!=index:continue
      need(final['kind']==kind and final['bytes']==row.size and final['mode']==row.mode and final['uid']==row.uid and final['gid']==row.gid,'OCI_ENTRY_METADATA')
      if kind in ('symlink','hardlink'):need(final['linkname']==row.linkname,'OCI_LINK_PIN')
      if kind!='file':continue
      target=canonical(name,inventory,follow_final=False);h=hashlib.sha256();fd=None;parent=None
      if target not in made:
       parent,leaf=parentfd(root,target);fd=os.open(leaf,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=parent)
      try:
       with archive.extractfile(row) as inp:
        count=0
        while True:
         chunk=inp.read(1048576)
         if not chunk:break
         count+=len(chunk);need(count<=row.size,'OCI_FILE_OVERFLOW');h.update(chunk)
         if fd is not None:
          view=memoryview(chunk)
          while view:view=view[os.write(fd,view):]
        need(count==row.size and h.hexdigest()==final['sha256'],'OCI_FILE_PIN')
       if fd is not None:os.fchmod(fd,row.mode&0o1777);os.fchown(fd,0,0)
      finally:
       if fd is not None:os.close(fd)
       if parent is not None:os.close(parent)
      made.add(target)
    while raw.read(1048576):pass
    need('sha256:'+raw.h.hexdigest()==config['rootfs']['diff_ids'][index],'OCI_DIFF_ID_PIN');receipts.append({'layer':index,'compressedDigest':desc['digest'],'diffID':'sha256:'+raw.h.hexdigest(),'uncompressedBytes':raw.count})
  need(made==set(files),'OCI_FILES_MISSING')
  # Links LAST, after all data writes and bytechecks. Tar xattrs/ACLs ignored.
  for target,entry in hardlinks.items():
   original=canonical(relpath(entry['linkname']),inventory);parent,leaf=parentfd(root,target);srcparent,srcleaf=parentfd(root,original)
   try:os.link(srcleaf,leaf,src_dir_fd=srcparent,dst_dir_fd=parent,follow_symlinks=False)
   finally:os.close(parent);os.close(srcparent)
  for target,entry in sorted(links.items(),key=lambda pair:pair[0].count('/'),reverse=True):
   parent,leaf=parentfd(root,target)
   try:os.symlink(entry['linkname'],leaf,dir_fd=parent);os.chown(leaf,0,0,dir_fd=parent,follow_symlinks=False)
   finally:os.close(parent)
  for name,entry in sorted(dirs.items(),key=lambda pair:pair[0].count('/'),reverse=True):os.chmod(root/name,entry['mode']&0o1777,follow_symlinks=False);os.chown(root/name,0,0,follow_symlinks=False)
  root.chmod(0o755)
  # Inventory by ORIGINAL virtual path, resolve only within our virtual root.
  for name,entry in inventory.items():
   target=canonical(name,inventory,follow_final=False);path=root/target;st=path.lstat();need(st.st_uid==st.st_gid==0,'OCI_FINAL_UID_GID');kind=entry['kind'];need((kind in ('file','hardlink') and stat.S_ISREG(st.st_mode)) or (kind=='directory' and stat.S_ISDIR(st.st_mode)) or (kind=='symlink' and stat.S_ISLNK(st.st_mode)),'OCI_FINAL_ENTRY_TYPE');need(stat.S_IMODE(st.st_mode)==(entry['mode'] if entry['kind']=='symlink' else entry['mode']&0o1777),'OCI_FINAL_MODE')
   if entry['kind']=='file':need(path.is_file() and not path.is_symlink() and st.st_size==entry['bytes'] and sha(path)==entry['sha256'],'OCI_FINAL_FILE')
   if entry['kind']=='symlink':need(path.is_symlink() and os.readlink(path)==entry['linkname'],'OCI_FINAL_SYMLINK')
  expected=set(dirs)|set(files)|set(links)|set(hardlinks);actual={p.relative_to(root).as_posix() for p in root.rglob('*')};need(actual==expected,'OCI_FINAL_PATH_SET')
  for name,entry in hardlinks.items():
   a=(root/name).stat();b=(root/canonical(entry['linkname'],inventory)).stat();need((a.st_dev,a.st_ino)==(b.st_dev,b.st_ino),'OCI_FINAL_HARDLINK')
  # No xattrs were restored; reject filesystem-inherited attributes too.
  for path in root.rglob('*'):
   need(not os.listxattr(path,follow_symlinks=False),'OCI_UNEXPECTED_XATTR')
  effective_rows={name:{'kind':entry['kind'],'mode':entry['mode'] if entry['kind']=='symlink' else entry['mode']&~0o6000,'uid':0,'gid':0,'sha256':entry.get('sha256'),'linkname':entry.get('linkname')} for name,entry in inventory.items()};effective_bytes=(json.dumps(effective_rows,sort_keys=True,separators=(',',':'))+'\n').encode();effective_path=stage/'effective-manifest.json';effective_path.write_bytes(effective_bytes)
  effective={'effectiveManifestSha256':hashlib.sha256(effective_bytes).hexdigest(),'effectiveEntryCount':len(effective_rows),'ociPlatformDigest':'sha256:'+MANIFEST,'inventorySha256':sha(HERE/'OCI-FINAL-LOGICAL-INVENTORY.json'),'modeOverlaySha256':sha(HERE/'MODE-OVERLAY.json'),'ownerOverlaySha256':sha(HERE/'OWNER-OVERLAY.json'),'regularBytesUnchanged':True,'noXattrsOrACLsRestored':True,'setIdBitsCleared':16,'layerReceipts':receipts}
  os.rename(root,destination);os.rename(effective_path,destination.with_name(destination.name+'.effective-manifest.json'));stage.rmdir();return effective
 except BaseException:
  # A failed stage was never executable/admitted. Rootowned private stage only.
  shutil.rmtree(stage);raise
if __name__=='__main__':raise SystemExit('INACTIVE: extraction code for review only')
