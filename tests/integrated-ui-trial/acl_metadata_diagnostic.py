"""SOURCE ONLY, uninvoked. ACL diagnostic NEVER grants custody or admission.
Only opens/reads directory metadata. No candidate/product/native import.
Raw return is private, must never be logged, hashed or put in public evidence.
"""
import errno
import os
import stat
import struct
import time

class DiagnosticIncomplete(Exception):
    pass

TAGS={1:'OWNER',2:'NAMED_USER',4:'OWNING_GROUP',8:'NAMED_GROUP',16:'MASK',32:'OTHER'}
FIXED_KEYS={'version','status','inspectedAncestors','accessAclAncestors','defaultAclAncestors','parseFailures','potentialAccessWriteAncestors','custodyProven','effectiveAccessProven','admissionChanged'}

def parse_linux_acl(raw):
    if type(raw)is not bytes or not 28<=len(raw)<=4096 or (len(raw)-4)%8 or struct.unpack_from('<I',raw)[0]!=2:
        raise DiagnosticIncomplete('ACL_ENCODING_UNSUPPORTED')
    rows=[];seen=set()
    for off in range(4,len(raw),8):
        tag,perm,who=struct.unpack_from('<HHI',raw,off)
        if tag not in TAGS or perm>7 or (tag in (2,8))!=(who!=0xffffffff):
            raise DiagnosticIncomplete('ACL_ENTRY_UNSUPPORTED')
        key=(tag,who)
        if key in seen:raise DiagnosticIncomplete('ACL_DUPLICATE_ENTRY')
        seen.add(key);rows.append({'tag':TAGS[tag],'permissions':perm,'identifier':who if tag in(2,8)else None})
    if any(sum(x['tag']==TAGS[t] for x in rows)!=1 for t in(1,4,32)):
        raise DiagnosticIncomplete('ACL_BASE_ENTRIES_REQUIRED')
    masks=[x['permissions']for x in rows if x['tag']=='MASK']
    if len(masks)>1 or(any(x['tag']in('NAMED_USER','NAMED_GROUP')for x in rows)and len(masks)!=1):
        raise DiagnosticIncomplete('ACL_MASK_REQUIRED')
    mask=masks[0]if masks else 7
    for row in rows:
        row['entryEffectivePermissions']=row['permissions']&(mask if row['tag']in('NAMED_USER','NAMED_GROUP','OWNING_GROUP')else 7)
    return rows

def _identity(st):
    return(st.st_dev,st.st_ino,st.st_uid,st.st_gid,st.st_mode,st.st_ctime_ns,st.st_mtime_ns)

def _acl(fd,name):
    # Linux xattr values have a kernel 64KiB maximum. Reject >4096B after
    # this one bounded syscall; never enumerate or read unrelated attributes.
    try:raw=os.getxattr(fd,name)
    except OSError as exc:
        if exc.errno==errno.ENODATA:return None
        raise DiagnosticIncomplete('ACL_READ_UNAVAILABLE')from None
    return parse_linux_acl(raw)

def inspect_ancestors_private(path,deadline):
    if type(path)is not str or not path.startswith('/')or len(path)>4096:
        raise DiagnosticIncomplete('FIXED_PATH_REQUIRED')
    parts=path.split('/')[1:]
    if len(parts)>31 or any(x in ('','.','..')for x in parts):
        raise DiagnosticIncomplete('PATH_SHAPE_UNSUPPORTED')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
    private=[];incomplete=False
    try:
        for index,component in enumerate([None,*parts]):
            if time.monotonic()>=deadline:raise DiagnosticIncomplete('DIAGNOSTIC_DEADLINE')
            if component is not None:
                child=os.open(component,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
                os.close(fd);fd=child
            before=os.fstat(fd)
            if not stat.S_ISDIR(before.st_mode):raise DiagnosticIncomplete('DIRECTORY_REQUIRED')
            row={'ancestorIndex':index,'privatePath':'/'+('/'.join(parts[:index])),'device':before.st_dev,'inode':before.st_ino,'ownerUid':before.st_uid,'ownerGid':before.st_gid,'mode':stat.S_IMODE(before.st_mode),'access':None,'default':None,'readIncomplete':False}
            try:
                row['access']=_acl(fd,'system.posix_acl_access')
                row['default']=_acl(fd,'system.posix_acl_default')
                access=row['access']
                if access:
                    by={x['tag']:x for x in access if x['tag']not in('NAMED_USER','NAMED_GROUP')}
                    group=by.get('MASK',by['OWNING_GROUP'])['permissions']
                    if (by['OWNER']['permissions']!=(before.st_mode>>6)&7 or group!=(before.st_mode>>3)&7 or by['OTHER']['permissions']!=before.st_mode&7):
                        raise DiagnosticIncomplete('ACL_MODE_MISMATCH')
            except DiagnosticIncomplete:
                row['readIncomplete']=True;incomplete=True
            if _identity(before)!=_identity(os.fstat(fd)):
                row['readIncomplete']=True;incomplete=True
            private.append(row)
    finally:os.close(fd)
    if time.monotonic()>deadline:incomplete=True
    # Potential is deliberately broader than effective access by an actual
    # process: no group membership/capability/userns/idmapped mount assumptions.
    public={'version':1,'status':'DIAGNOSTIC_INCOMPLETE'if incomplete else'ACL_METADATA_ONLY_NOT_CUSTODY_PROOF','inspectedAncestors':len(private),'accessAclAncestors':sum(x['access']is not None for x in private),'defaultAclAncestors':sum(x['default']is not None for x in private),'parseFailures':sum(x['readIncomplete']for x in private),'potentialAccessWriteAncestors':sum(any(e['entryEffectivePermissions']&2 for e in(x['access']or[])if e['tag']!='OWNER')for x in private),'custodyProven':False,'effectiveAccessProven':False,'admissionChanged':False}
    validate_public(public)
    return private,public

def validate_public(value):
    if type(value)is not dict or set(value)!=FIXED_KEYS:raise DiagnosticIncomplete('FIXED_SUMMARY_REQUIRED')
    if type(value['version'])is not int or value['version']!=1:raise DiagnosticIncomplete('FIXED_VERSION_REQUIRED')
    if value['status']not in('DIAGNOSTIC_INCOMPLETE','ACL_METADATA_ONLY_NOT_CUSTODY_PROOF','DIAGNOSTIC_UNAVAILABLE'):raise DiagnosticIncomplete('FIXED_STATUS_REQUIRED')
    for key in('inspectedAncestors','accessAclAncestors','defaultAclAncestors','parseFailures','potentialAccessWriteAncestors'):
        if type(value[key])is not int or not 0<=value[key]<=32:raise DiagnosticIncomplete('COUNT_BOUND')
    if any(value[key]is not False for key in('custodyProven','effectiveAccessProven','admissionChanged')):raise DiagnosticIncomplete('DIAGNOSTIC_NEVER_ADMITS')
    return value
