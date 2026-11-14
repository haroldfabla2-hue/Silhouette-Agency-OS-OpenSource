from native_fixed_boundary import call, deny, NativeFixedFailure, NativeFixedReason
'SOURCE ONLY NOT INVOKED: static regular-browser host inventory extension.\nNo browser, loader, ldd or native library import. Does not admit runtime.\nMust be incorporated into the exact Ubuntu24.04 amd64 read-only host qualifier\nonly after review. Parsing ldconfig cache output is inventory, not resolution.\n'
from pathlib import Path
import os
import re
import stat
import subprocess
import selectors
import time
import signal
import sys

class QualificationIncomplete(Exception):
    pass

def bounded_host_tool(argv, stdout_cap, stderr_cap, wall):
    if argv[0] not in ('/sbin/ldconfig', '/usr/bin/readelf'):
        deny('INVENTORY', 'UNREVIEWED_HOST_TOOL')
    if not (0 < stdout_cap <= 2 * 1024 * 1024 and 0 < stderr_cap <= 65536 and (0 < wall <= 5)):
        deny('INVENTORY', 'HOST_TOOL_BOUNDS')
    family = 'CACHE_TOOL' if argv[0] == '/sbin/ldconfig' else 'PROVIDER_TOOL'
    child = None
    selector = None
    primary = None
    failed = False
    cleanup = []
    forced = False
    output = None
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    try:
        child = call(family + '_SPAWN', subprocess.Popen, argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, close_fds=True, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
        selector = call(family + '_SELECTOR_CREATE', selectors.DefaultSelector)
        for (stream, name) in ((child.stdout, 'stdout'), (child.stderr, 'stderr')):
            call(family + '_NONBLOCK', os.set_blocking, stream.fileno(), False)
            call(family + '_REGISTER', selector.register, stream, selectors.EVENT_READ, name)
        started = call(family + '_CLOCK', time.monotonic)
        while selector.get_map():
            if call(family + '_CLOCK', time.monotonic) - started > wall:
                deny(family + '_CLOCK', 'TOOL_TIMEOUT')
            for (event, _) in call(family + '_SELECT', selector.select, 0.05):
                name = event.data
                cap = stdout_cap if name == 'stdout' else stderr_cap
                block = call(family + '_READ', os.read, event.fileobj.fileno(), min(65536, cap + 1 - len(buffers[name])))
                if not block:
                    call(family + '_UNREGISTER', selector.unregister, event.fileobj)
                    continue
                buffers[name].extend(block)
                if len(buffers[name]) > cap:
                    deny(family + '_READ', 'TOOL_OUTPUT_CAP')
        try:
            code = call(family + '_WAIT', child.wait, timeout=max(0.01, wall - (call(family + '_CLOCK', time.monotonic) - started)))
        except NativeFixedFailure as error:
            if type(error.original) is subprocess.TimeoutExpired:
                deny(family + '_WAIT', 'TOOL_TIMEOUT')
            raise
        if code != 0:
            deny(family + '_RESULT', 'TOOL_NONZERO_EXIT')
        if buffers['stderr']:
            deny(family + '_RESULT', 'TOOL_STDERR')
        try:
            output = call(family + '_DECODE', bytes(buffers['stdout']).decode, 'utf-8', errors='strict')
        except NativeFixedFailure as error:
            if type(error.original) is UnicodeDecodeError:
                deny(family + '_DECODE', 'TOOL_UTF8')
            raise
    except BaseException as error:
        primary = error
        failed = True
    finally:
        if selector is not None:
            try:
                call(family + '_SELECTOR_CLOSE', selector.close)
            except BaseException as error:
                cleanup.append(error)
        if child is not None:
            live = False
            try:
                call(family + '_GROUP_PROBE', os.killpg, child.pid, 0)
                live = True
            except NativeFixedFailure as error:
                if not isinstance(error.original, ProcessLookupError):
                    cleanup.append(error)
                    live = True
            if live:
                forced = True
                try:
                    call(family + '_KILL', os.killpg, child.pid, signal.SIGKILL)
                except NativeFixedFailure as error:
                    if not isinstance(error.original, ProcessLookupError):
                        cleanup.append(error)
            try:
                call(family + '_CLEANUP_WAIT', child.wait, timeout=1)
            except BaseException as error:
                cleanup.append(error)
            for (stream, operation) in ((child.stdout, 'STDOUT_CLOSE'), (child.stderr, 'STDERR_CLOSE')):
                if stream is not None:
                    try:
                        call(family + '_' + operation, stream.close)
                    except BaseException as error:
                        cleanup.append(error)
    if failed or cleanup or forced:
        if not failed:
            if cleanup:
                primary = cleanup[0]
            else:
                primary = NativeFixedFailure(family + '_GROUP_PROBE', NativeFixedReason('HOST_TOOL_RESIDUAL_GROUP'))
        primary.cleanupFailed = getattr(primary, 'cleanupFailed', False) is True or bool(cleanup)
        primary.cleanupForced = getattr(primary, 'cleanupForced', False) is True or forced
        raise primary
    return output

def inventory_regular_chrome_requirements(contract, deadline):
    result = {'status': 'STATIC_NATIVE_INVENTORY_ONLY_NOT_LOAD_PROOF', 'libraries': [], 'gaps': [], 'closure': 'UNVERIFIED', 'vendorAndDlopen': 'UNVERIFIED', 'runtimeFitness': 'UNVERIFIED'}
    if type(contract)is not dict or contract.get('status')!='STATIC_REQUIREMENTS_ONLY_NOT_HOST_QUALIFIED' or contract.get('browserVersion')!='145.0.7632.6' or contract.get('archiveSha256')!='b5e3195041af345a668d110f5daf5581961fa3608626ea588c97dd0fe81c4e38' or contract.get('architecture')!='amd64' or contract.get('elfClass')!='ELF64':
        deny('CONTRACT_VALIDATE','CONTRACT_INCOMPLETE')
    sonames = contract.get('externalSonames')
    if type(sonames)is not list or not 1<=len(sonames)<=128 or any(type(x)is not str for x in sonames) or len(set(sonames))!=len(sonames):
        deny('CONTRACT_VALIDATE', 'SONAME_CONTRACT')
    remaining = deadline - call('CLOCK_READ', time.monotonic)
    if remaining < 0.1:
        deny('CONTRACT_VALIDATE', 'QUALIFICATION_BUDGET_EXHAUSTED')
    cache_text = call('INVENTORY', bounded_host_tool, ['/sbin/ldconfig', '-p'], 2 * 1024 * 1024, 65536, min(5, remaining))
    entries = {}
    for line in cache_text.splitlines():
        match = call('CACHE_PARSE', re.fullmatch, '\\s*(\\S+) \\(([^)]*)\\) => (\\S+)\\s*', line)
        if match and 'x86-64' in match[2]:
            entries.setdefault(match[1], []).append(match[3])
    for soname in sonames:
        if not call('CACHE_PARSE', re.fullmatch, '[A-Za-z0-9_.+-]{1,128}', soname):
            deny('CONTRACT_VALIDATE', 'SONAME_FORMAT')
        choices = entries.get(soname, [])
        row = {'soname': soname, 'candidateCount': len(choices), 'status': 'UNRESOLVED'}
        if len(choices) == 1:
            candidate = Path(choices[0])
            canonical = call('LIBRARY_RESOLVE', candidate.resolve, strict=True)
            st = call('LIBRARY_STAT', canonical.stat)
            if stat.S_ISREG(st.st_mode) and st.st_uid == 0 and (not st.st_mode & 18):
                row.update(status='CACHE_CANDIDATE_ONLY', canonical=str(canonical), device=st.st_dev, inode=st.st_ino, bytes=st.st_size)
            else:
                result['gaps'].append('UNTRUSTED_LIBRARY_METADATA')
        else:
            result['gaps'].append('MISSING_OR_AMBIGUOUS_LIBRARY')
        result['libraries'].append(row)
    interpreter = Path('/lib64/ld-linux-x86-64.so.2')
    result['interpreterCandidate'] = str(call('INTERPRETER_RESOLVE', interpreter.resolve, strict=True))
    result['finiteProviderInventory'] = call('PROVIDER_GUARDS', finite_provider_inventory, result['libraries'], entries, deadline)
    finite = result['finiteProviderInventory']
    if finite['unresolvedSonames'] or finite['unsupported']:
        result['gaps'].append('FINITE_PROVIDER_UNRESOLVED_OR_UNSUPPORTED')
    result['requiredBeforeAdmission'] = ['PROTECTED_INTERPRETER_AND_ALL_ANCESTOR_OWNERSHIP', 'READ_ONLY_BIND_AND_SAME_NAMESPACE_PATH_IDENTITY', 'ELF_CLASS_MACHINE_AND_ABI_OF_EACH_SELECTED_HOST_OBJECT', 'TRANSITIVE_DT_NEEDED_AND_RPATH_RUNPATH_RESOLUTION_WITHOUT_EXECUTION', 'PER_SYMBOL_VERSION_PROVIDER_MATCH_NOT_MAX_GLIBC_COMPARISON', 'GTK_CURL_VULKAN_AND_VENDOR_REQUIREMENTS', 'DLOPEN_FEATURE_REQUIREMENTS_AND_NO_NETWORK_FALLBACK', 'FUTURE_SEPARATELY_AUTHORIZED_CAPPED_NATIVE_PREREQUISITE']
    return result

def finite_provider_inventory(libraries, cache_entries, deadline):
    begun = call('CLOCK_READ', time.monotonic)
    pending = [row['canonical'] for row in libraries if row['status'] == 'CACHE_CANDIDATE_ONLY']
    observed = {}
    unresolved = set()
    unsupported = []
    while pending:
        if call('CLOCK_READ', time.monotonic) >= deadline:
            deny('PROVIDER_GUARDS', 'PROVIDER_AGGREGATE_WALL')
        candidate = Path(pending.pop(0))
        canonical = call('PROVIDER_RESOLVE', candidate.resolve, strict=True)
        key = str(canonical)
        if key in observed:
            continue
        if len(observed) >= 128:
            deny('PROVIDER_GUARDS', 'PROVIDER_OBJECT_CAP')
        if not (key.startswith('/usr/lib/x86_64-linux-gnu/') or key.startswith('/lib/x86_64-linux-gnu/')):
            deny('PROVIDER_GUARDS', 'NON_SYSTEM_PROVIDER')
        st = call('PROVIDER_STAT', canonical.stat)
        if not (stat.S_ISREG(st.st_mode) and st.st_uid == 0 and (not st.st_mode & 18)):
            deny('PROVIDER_GUARDS', 'PROVIDER_CUSTODY')
        remaining = deadline - call('CLOCK_READ', time.monotonic)
        if remaining < 0.1:
            deny('PROVIDER_GUARDS', 'QUALIFICATION_BUDGET_EXHAUSTED')
        text = call('INVENTORY', bounded_host_tool, ['/usr/bin/readelf', '-h', '-d', '-V', '-l', key], 65536, 65536, min(5, remaining))
        if 'Class:                             ELF64' not in text or 'Advanced Micro Devices X86-64' not in text:
            deny('PROVIDER_GUARDS', 'PROVIDER_ARCHITECTURE')
        needed = call('PROVIDER_PARSE', re.findall, '\\(NEEDED\\).*?\\[(.*?)\\]', text)
        paths = call('PROVIDER_PARSE', re.findall, '\\((?:RPATH|RUNPATH)\\).*?\\[(.*?)\\]', text)
        if any(paths):
            unsupported.append('PROVIDER_RPATH_RUNPATH_REQUIRES_REVIEW')
        after = call('PROVIDER_RESTAT', canonical.stat)
        if (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            deny('PROVIDER_GUARDS', 'PROVIDER_CHANGED')
        observed[key] = {'needed': needed, 'dynamicPaths': paths, 'versionMetadata': text, 'status': 'METADATA_ONLY_NOT_SYMBOL_BINDING_OR_LOAD_PROOF'}
        if len(needed) > 128:
            deny('PROVIDER_GUARDS', 'PROVIDER_EDGE_CAP')
        for soname in needed:
            choices = cache_entries.get(soname, [])
            if len(choices) != 1:
                unresolved.add(soname)
            else:
                pending.append(choices[0])
        if len(pending) > 16384:
            deny('PROVIDER_GUARDS', 'PROVIDER_QUEUE_CAP')
    return {'status': 'FINITE_PROVIDER_METADATA_NOT_LOAD_PROOF', 'providers': observed, 'unresolvedSonames': sorted(unresolved), 'unsupported': unsupported, 'symbolBindings': 'NOT_PROVED', 'actualNamespaceSelection': 'NOT_PROVED', 'vendorAndDlopen': 'UNKNOWN', 'runtimeFitness': 'UNKNOWN'}
