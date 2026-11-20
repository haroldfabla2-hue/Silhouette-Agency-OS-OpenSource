"""Inactive descriptor-rooted path audit. No alternate resolver is permitted."""
import ctypes
import errno
import os
from pathlib import PurePosixPath
import platform
import stat


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def starttime(pid):
    with open('/proc/%d/stat' % pid) as stream:
        raw = stream.read()
    return int(raw[raw.rfind(')') + 2:].split()[19])


class OpenHow(ctypes.Structure):
    _fields_ = [('flags', ctypes.c_uint64), ('mode', ctypes.c_uint64),
                ('resolve', ctypes.c_uint64)]


class Root:
    def __init__(self, pid, expected_start):
        need(platform.machine() == 'x86_64', 'ROOTED_SYSCALL_ARCH_UNSUPPORTED')
        self.pid, self.start = pid, expected_start
        self.pidfd = os.pidfd_open(pid)
        self.fd = None
        try:
            need(starttime(pid) == expected_start, 'ROOT_PID_CHANGED')
            # This single intentional proc magic link establishes the root FD.
            # Every container path after it uses openat2 relative to that FD.
            self.fd = os.open('/proc/%d/root' % pid,
                              os.O_PATH | os.O_DIRECTORY | os.O_CLOEXEC)
            self.identity = self._identity(self.fd)
            self.check()
            test = self.open('/', os.O_PATH | os.O_DIRECTORY)
            os.close(test)
        except BaseException:
            self.close()
            raise

    @staticmethod
    def _identity(fd):
        value = os.fstat(fd)
        return value.st_dev, value.st_ino

    def check(self):
        import select
        need(not select.select([self.pidfd], [], [], 0)[0], 'ROOT_PID_EXITED')
        need(starttime(self.pid) == self.start, 'ROOT_PID_CHANGED')
        current = os.stat('/proc/%d/root' % self.pid)
        need((current.st_dev, current.st_ino) == self.identity,
             'PROCESS_ROOT_CHANGED')
        need(self._identity(self.fd) == self.identity, 'ROOT_DESCRIPTOR_CHANGED')

    def open(self, path, flags):
        self.check()
        value = str(path)
        need(value.startswith('/') and '\x00' not in value, 'ROOTED_PATH_INVALID')
        how = OpenHow(flags | os.O_CLOEXEC, 0, 0x10 | 0x02)
        libc = ctypes.CDLL(None, use_errno=True)
        libc.syscall.restype = ctypes.c_long
        fd = libc.syscall(ctypes.c_long(437), ctypes.c_int(self.fd),
                          ctypes.c_char_p(os.fsencode(value)), ctypes.byref(how),
                          ctypes.c_size_t(ctypes.sizeof(how)))
        if fd < 0:
            code = ctypes.get_errno()
            self.check()
            if code in (errno.ENOSYS, errno.EINVAL, errno.E2BIG):
                raise RuntimeError('OPENAT2_CAPABILITY_PENDING')
            if code == errno.ELOOP:
                raise RuntimeError('ROOTED_MAGICLINK_OR_SYMLINK_LOOP_BLOCKED')
            raise OSError(code, 'ROOTED_OPEN_FAILED')
        try:
            self.check()
            return fd
        except BaseException:
            os.close(fd)
            raise

    def __truediv__(self, part):
        return Entry(self, '/' + str(part).lstrip('/'))

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        if self.pidfd is not None:
            os.close(self.pidfd)
            self.pidfd = None


class Entry:
    def __init__(self, root, path):
        self.root, self.path = root, str(PurePosixPath(path))
        self.name = PurePosixPath(path).name

    def __truediv__(self, part):
        return Entry(self.root, self.path.rstrip('/') + '/' + str(part).lstrip('/'))

    def open(self, flags=os.O_PATH):
        return self.root.open(self.path, flags)

    def stat(self, follow_symlinks=True):
        fd = self.open(os.O_PATH | (0 if follow_symlinks else os.O_NOFOLLOW))
        try:
            return os.fstat(fd)
        finally:
            os.close(fd)

    def statvfs(self):
        fd = self.open(os.O_RDONLY | os.O_DIRECTORY)
        try:
            return os.fstatvfs(fd)
        finally:
            os.close(fd)

    def is_symlink(self):
        return stat.S_ISLNK(self.stat(False).st_mode)

    def readlink(self):
        fd = self.open(os.O_PATH | os.O_NOFOLLOW)
        try:
            need(stat.S_ISLNK(os.fstat(fd).st_mode), 'NOT_ROOTED_SYMLINK')
            return os.readlink('', dir_fd=fd)
        finally:
            os.close(fd)

    def iterdir(self):
        fd = self.open(os.O_RDONLY | os.O_DIRECTORY)
        try:
            names = os.listdir(fd)
            need(len(names) <= 256, 'ROOTED_DIRECTORY_TOO_LARGE')
            return [self / name for name in names]
        finally:
            os.close(fd)


if __name__ == '__main__':
    raise SystemExit('INACTIVE: no standalone execution')
