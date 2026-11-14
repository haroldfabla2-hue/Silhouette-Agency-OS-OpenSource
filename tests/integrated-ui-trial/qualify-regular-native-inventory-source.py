"""SOURCE ONLY NOT INVOKED: static regular-browser host inventory extension.
No browser, loader, ldd or native library import. Does not admit runtime.
Must be incorporated into the exact Ubuntu24.04 amd64 read-only host qualifier
only after review. Parsing ldconfig cache output is inventory, not resolution.
"""
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
        raise QualificationIncomplete('UNREVIEWED_HOST_TOOL')
    if not(0 < stdout_cap <= 2*1024*1024 and 0 < stderr_cap <= 65536 and 0 < wall <= 5):
        raise QualificationIncomplete('HOST_TOOL_BOUNDS')
    child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             start_new_session=True, close_fds=True,
                             env={'PATH':'/usr/bin:/bin','LC_ALL':'C'})
    selector = selectors.DefaultSelector();buffers = {'stdout':bytearray(),'stderr':bytearray()}
    for stream,name in ((child.stdout,'stdout'),(child.stderr,'stderr')):
        os.set_blocking(stream.fileno(),False);selector.register(stream, selectors.EVENT_READ,name)
    started = time.monotonic();failure = None
    try:
        while selector.get_map():
            if time.monotonic()-started > wall:
                raise QualificationIncomplete('HOST_TOOL_WALL')
            for event,_ in selector.select(.05):
                name=event.data;cap=stdout_cap if name=='stdout' else stderr_cap
                block=os.read(event.fileobj.fileno(),min(65536,cap+1-len(buffers[name])))
                if not block:
                    selector.unregister(event.fileobj);continue
                buffers[name].extend(block)
                if len(buffers[name])>cap:
                    raise QualificationIncomplete('HOST_TOOL_OUTPUT_CAP')
        code=child.wait(timeout=max(.01,wall-(time.monotonic()-started)))
        if code!=0 or buffers['stderr']:
            raise QualificationIncomplete('HOST_TOOL_NOT_CLEAN')
        return bytes(buffers['stdout']).decode('utf-8',errors='strict')
    finally:
        active_error = sys.exc_info()[1]
        selector.close()
        # Any surviving process group invalidates clean inventory, even if
        # tool rc0. Force is cleanup-only, never a native/prerequisite PASS.
        try:
            os.killpg(child.pid,0)
        except ProcessLookupError:
            live=False
        else:
            live=True
        if live:
            os.killpg(child.pid,signal.SIGKILL)
        child.wait(timeout=1)
        child.stdout.close();child.stderr.close()
        if live:
            if active_error is not None:
                active_error.cleanup_forced = True
            else:
                error = QualificationIncomplete('HOST_TOOL_RESIDUAL_GROUP')
                error.cleanup_forced = True
                raise error

def inventory_regular_chrome_requirements(contract, deadline):
    # Contract comes from independently reviewed actual archive metadata, not
    # browser-controlled output or a runtime manifest claiming qualification.
    result = {'status': 'STATIC_NATIVE_INVENTORY_ONLY_NOT_LOAD_PROOF',
              'libraries': [], 'gaps': [], 'closure': 'UNVERIFIED',
              'vendorAndDlopen': 'UNVERIFIED', 'runtimeFitness': 'UNVERIFIED'}
    sonames = contract['externalSonames']
    if not isinstance(sonames, list) or len(sonames) > 128 or len(set(sonames)) != len(sonames):
        raise QualificationIncomplete('SONAME_CONTRACT')
    # This is the host's trusted metadata tool, never the acquired executable.
    remaining=deadline-time.monotonic()
    if remaining<0.1: raise QualificationIncomplete('QUALIFICATION_BUDGET_EXHAUSTED')
    cache_text = bounded_host_tool(['/sbin/ldconfig', '-p'], 2 * 1024 * 1024, 65536, min(5,remaining))
    entries = {}
    for line in cache_text.splitlines():
        match = re.fullmatch(r'\s*(\S+) \(([^)]*)\) => (\S+)\s*', line)
        if match and 'x86-64' in match[2]:
            entries.setdefault(match[1], []).append(match[3])
    for soname in sonames:
        if not re.fullmatch(r'[A-Za-z0-9_.+-]{1,128}', soname):
            raise QualificationIncomplete('SONAME_FORMAT')
        choices = entries.get(soname, [])
        row = {'soname': soname, 'candidateCount': len(choices), 'status': 'UNRESOLVED'}
        if len(choices) == 1:
            candidate = Path(choices[0])
            # Symlinked system SONAMEs are expected. Record canonical ownership,
            # and do not confuse this cache path with actual runtime selection.
            canonical = candidate.resolve(strict=True)
            st = canonical.stat()
            if stat.S_ISREG(st.st_mode) and st.st_uid == 0 and not(st.st_mode & 0o022):
                row.update(status='CACHE_CANDIDATE_ONLY', canonical=str(canonical),
                           device=st.st_dev, inode=st.st_ino, bytes=st.st_size)
            else:
                result['gaps'].append('UNTRUSTED_LIBRARY_METADATA')
        else:
            result['gaps'].append('MISSING_OR_AMBIGUOUS_LIBRARY')
        result['libraries'].append(row)
    interpreter = Path('/lib64/ld-linux-x86-64.so.2')
    result['interpreterCandidate'] = str(interpreter.resolve(strict=True))
    result['finiteProviderInventory'] = finite_provider_inventory(result['libraries'], entries, deadline)
    finite=result['finiteProviderInventory']
    if finite['unresolvedSonames'] or finite['unsupported']:
        result['gaps'].append('FINITE_PROVIDER_UNRESOLVED_OR_UNSUPPORTED')
    result['requiredBeforeAdmission'] = [
        'PROTECTED_INTERPRETER_AND_ALL_ANCESTOR_OWNERSHIP',
        'READ_ONLY_BIND_AND_SAME_NAMESPACE_PATH_IDENTITY',
        'ELF_CLASS_MACHINE_AND_ABI_OF_EACH_SELECTED_HOST_OBJECT',
        'TRANSITIVE_DT_NEEDED_AND_RPATH_RUNPATH_RESOLUTION_WITHOUT_EXECUTION',
        'PER_SYMBOL_VERSION_PROVIDER_MATCH_NOT_MAX_GLIBC_COMPARISON',
        'GTK_CURL_VULKAN_AND_VENDOR_REQUIREMENTS',
        'DLOPEN_FEATURE_REQUIREMENTS_AND_NO_NETWORK_FALLBACK',
        'FUTURE_SEPARATELY_AUTHORIZED_CAPPED_NATIVE_PREREQUISITE',
    ]
    # Even an empty gaps list intentionally does not become ready/pass.
    return result


def finite_provider_inventory(libraries, cache_entries, deadline):
    # Finite system-provider inventory, not ld.so, relocation or native-load proof.
    begun=time.monotonic();pending=[row['canonical'] for row in libraries if row['status']=='CACHE_CANDIDATE_ONLY']
    observed={};unresolved=set();unsupported=[]
    while pending:
        if time.monotonic()>=deadline:
            raise QualificationIncomplete('PROVIDER_AGGREGATE_WALL')
        candidate=Path(pending.pop(0));canonical=candidate.resolve(strict=True)
        key=str(canonical)
        if key in observed:
            continue
        if len(observed)>=128:
            raise QualificationIncomplete('PROVIDER_OBJECT_CAP')
        if not(key.startswith('/usr/lib/x86_64-linux-gnu/') or key.startswith('/lib/x86_64-linux-gnu/')):
            raise QualificationIncomplete('NON_SYSTEM_PROVIDER')
        st=canonical.stat()
        if not(stat.S_ISREG(st.st_mode)and st.st_uid==0 and not(st.st_mode&0o022)):
            raise QualificationIncomplete('PROVIDER_CUSTODY')
        remaining=deadline-time.monotonic()
        if remaining<0.1: raise QualificationIncomplete('QUALIFICATION_BUDGET_EXHAUSTED')
        text=bounded_host_tool(['/usr/bin/readelf','-h','-d','-V','-l',key],65536,65536,min(5,remaining))
        if 'Class:                             ELF64'not in text or 'Advanced Micro Devices X86-64'not in text:
            raise QualificationIncomplete('PROVIDER_ARCHITECTURE')
        needed=re.findall(r'\(NEEDED\).*?\[(.*?)\]',text)
        paths=re.findall(r'\((?:RPATH|RUNPATH)\).*?\[(.*?)\]',text)
        if any(paths):
            unsupported.append('PROVIDER_RPATH_RUNPATH_REQUIRES_REVIEW')
        after=canonical.stat()
        if(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):
            raise QualificationIncomplete('PROVIDER_CHANGED')
        observed[key]={'needed':needed,'dynamicPaths':paths,'versionMetadata':text,
                       'status':'METADATA_ONLY_NOT_SYMBOL_BINDING_OR_LOAD_PROOF'}
        if len(needed)>128:
            raise QualificationIncomplete('PROVIDER_EDGE_CAP')
        for soname in needed:
            choices=cache_entries.get(soname,[])
            if len(choices)!=1:
                unresolved.add(soname)
            else:
                pending.append(choices[0])
        if len(pending)>16384:
            raise QualificationIncomplete('PROVIDER_QUEUE_CAP')
    return {'status':'FINITE_PROVIDER_METADATA_NOT_LOAD_PROOF','providers':observed,
            'unresolvedSonames':sorted(unresolved),'unsupported':unsupported,
            'symbolBindings':'NOT_PROVED','actualNamespaceSelection':'NOT_PROVED',
            'vendorAndDlopen':'UNKNOWN','runtimeFitness':'UNKNOWN'}
