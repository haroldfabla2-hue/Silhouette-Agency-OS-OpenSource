from fixed_io_boundary import fixed_call
"""SOURCE ONLY uninvoked. Conservative DAC/ACL custody, not global acceptance.
Trusted host/root and existing supervisor runner are explicit trust domain.
No arbitrary callbacks, candidate JSON, NSS membership, chmod or ACL mutation.
"""
import os
import stat
import time
from acl_metadata_diagnostic import parse_linux_acl, _acl, _identity
from mount_readonly_model import mount_identity, retain_global_numeric_identity

class CustodyDenied(Exception):
    pass

def require_entry_rights(st, access, runner, private_leaf=False):
    if st.st_uid not in (0, runner):
        raise CustodyDenied('UNTRUSTED_OWNER')
    if not access:
        if st.st_mode & 18:
            raise CustodyDenied('MODE_NONOWNER_WRITE')
        if private_leaf and (st.st_uid != runner or st.st_mode & 63):
            raise CustodyDenied('LEAF_NOT_PRIVATE')
        return
    base = {e['tag']: e for e in access if e['tag'] not in ('NAMED_USER', 'NAMED_GROUP')}
    if base['OWNER']['permissions'] != st.st_mode >> 6 & 7 or base.get('MASK', base['OWNING_GROUP'])['permissions'] != st.st_mode >> 3 & 7 or base['OTHER']['permissions'] != st.st_mode & 7:
        raise CustodyDenied('MODE_ACL_MISMATCH')
    for entry in access:
        if entry['tag'] == 'MASK':
            continue
        effective = entry['entryEffectivePermissions']
        trusted = entry['tag'] == 'OWNER' or (entry['tag'] == 'NAMED_USER' and entry['identifier'] in (0, runner))
        if not trusted and effective & 2:
            raise CustodyDenied('UNTRUSTED_ENTRY_WRITE')
        if private_leaf and entry['tag'] != 'OWNER' and effective:
            raise CustodyDenied('LEAF_NONOWNER_ACCESS')
    if private_leaf and (st.st_uid != runner or st.st_mode & 63):
        raise CustodyDenied('LEAF_NOT_PRIVATE')

class RetainedCustodyChain:

    def __init__(self):
        self.entries = []
        self.namespace = None
        self.raw_private = []
        self.closed = False

    def close(self):
        first=None
        if not self.closed:
            for fd,_,_ in reversed(self.entries):
                try:fixed_call('FD_CLOSE',os.close,fd)
                except BaseException as error:
                    if first is None:first=error
            if self.namespace is not None:
                try:self.namespace.close()
                except BaseException as error:
                    if first is None:first=error
            self.closed=True
        if first is not None:raise first
    def recheck(self, deadline):
        if self.closed or fixed_call('CLOCK_READ',time.monotonic) >= deadline:
            raise CustodyDenied('DEADLINE_OR_CLOSED_CHAIN')
        if self.namespace is None:raise CustodyDenied('NAMESPACE_CHANGED')
        fixed_call('NAMESPACE_IDENTITY',self.namespace.recheck)
        for (fd, identity, mount) in self.entries:
            if fixed_call('CLOCK_READ',time.monotonic) >= deadline:
                raise CustodyDenied('DEADLINE')
            if _identity(fixed_call('DIRECTORY_FSTAT', os.fstat, fd)) != identity or fixed_call('MOUNT_IDENTITY', mount_identity, fd) != mount:
                raise CustodyDenied('CHAIN_CHANGED')

    def account_expected_directory_mutation(self, expected_identity, deadline):
        for (index, (fd, identity, mount)) in enumerate(self.entries):
            if identity[:2] != expected_identity:
                continue
            st = fixed_call('DIRECTORY_FSTAT', os.fstat, fd)
            if fixed_call('CLOCK_READ',time.monotonic) >= deadline or _identity(st)[:5] != identity[:5] or fixed_call('MOUNT_IDENTITY', mount_identity, fd) != mount:
                raise CustodyDenied('EXPECTED_MUTATION_IDENTITY_CHANGED')
            old = self.raw_private[index]
            if _acl(fd, 'system.posix_acl_access') != old['access'] or _acl(fd, 'system.posix_acl_default') != old['default']:
                raise CustodyDenied('EXPECTED_MUTATION_ACL_CHANGED')
            self.entries[index] = (fd, _identity(st), mount)

    @property
    def leaf_fd(self):
        if self.closed or not self.entries:
            raise CustodyDenied('NO_RETAINED_CHAIN')
        return self.entries[-1][0]

def inspect_and_retain(path, deadline, private_leaf=False):
    if type(path) is not str or not path.startswith('/') or len(path) > 4096:
        raise CustodyDenied('PATH_SHAPE')
    parts = path.split('/')[1:]
    if not 1 <= len(parts) <= 31 or any((x in ('', '.', '..') for x in parts)):
        raise CustodyDenied('PATH_SHAPE')
    chain = RetainedCustodyChain()
    try:
        chain.namespace = fixed_call('NAMESPACE_IDENTITY', retain_global_numeric_identity)
        runner = chain.namespace.runner
        fd = fixed_call('ROOT_DIRECTORY_OPEN', os.open, '/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        for (index, component) in enumerate([None, *parts]):
            if component is not None:
                fd = fixed_call('CHILD_DIRECTORY_OPEN', os.open, component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=chain.leaf_fd)
            chain.entries.append((fd,None,None))
            st = fixed_call('DIRECTORY_FSTAT', os.fstat, fd)
            chain.entries[-1]=(fd,_identity(st),None)
            if fixed_call('CLOCK_READ',time.monotonic) >= deadline or not stat.S_ISDIR(st.st_mode):
                raise CustodyDenied('TYPE_OR_DEADLINE')
            mount = fixed_call('MOUNT_IDENTITY', mount_identity, fd)
            chain.entries[-1] = (fd, _identity(st), mount)
            access = _acl(fd, 'system.posix_acl_access')
            default = _acl(fd, 'system.posix_acl_default')
            chain.raw_private.append({'privatePath': '/' + '/'.join(parts[:index]), 'ownerUid': st.st_uid, 'ownerGid': st.st_gid, 'access': access, 'default': default})
            fixed_call('ACCESS_RIGHTS',require_entry_rights,st, access, runner, private_leaf and index == len(parts))
        chain.recheck(deadline)
        return chain
    except BaseException as original:
        try:chain.close()
        except BaseException:original.cleanupFailed=True
        raise
