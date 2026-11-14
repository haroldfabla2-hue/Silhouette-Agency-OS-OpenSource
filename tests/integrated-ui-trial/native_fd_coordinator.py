"""Borrowed supervisor FDs; owned private-file FDs always closed.
Source only. Fixed diagnostic sink is mandatory, never a rescue raw export.
"""
import os
import stat
import json
import time
from native_fixed_boundary import call,deny,blocked_receipt,diagnostic,NativeFixedFailure
from native_finite_exporter import finite_export_and_gate, NativeAdmissionDenied
from native_receipt_schema import validate as validate_finite_receipt


def check_directory_fd(fd, expected_device, expected_inode):
    st=call('DIRECTORY_FSTAT',os.fstat,fd)
    uid=call('PROCESS_UID',os.geteuid)
    if not(stat.S_ISDIR(st.st_mode)and st.st_uid==uid and uid>0 and st.st_mode&0o077==0 and(st.st_dev,st.st_ino)==(expected_device,expected_inode)):
        deny('DIRECTORY_CUSTODY','PRIVATE_DIRECTORY_FD_CUSTODY')


def check_sink_fd(fd, expected_device, expected_inode):
    st=call('SINK_FSTAT',os.fstat,fd)
    uid=call('PROCESS_UID',os.geteuid)
    if not(stat.S_ISREG(st.st_mode)and st.st_nlink==1 and st.st_uid==uid and uid>0 and st.st_mode&0o077==0 and st.st_size==0 and(st.st_dev,st.st_ino)==(expected_device,expected_inode)):
        deny('SINK_CUSTODY','FIXED_SINK_FD_CUSTODY')


def write_private(directory_fd, name, value, failure=False):
    # Exactly these source-fixed filenames. Never candidate-selected paths.
    if name not in ('inventory.json','failure.json'):deny('PRIVATE_OPEN','PRIVATE_NATIVE_SCHEMA_INCOMPLETE')
    prefix='FAILURE'if failure else'PRIVATE'
    encoded=call(prefix+'_SERIALIZE',json.dumps,value,allow_nan=False,sort_keys=True).encode('utf-8')
    if len(encoded)>32*1024*1024:deny(prefix+'_SERIALIZE','PRIVATE_JSON_BOUND')
    fd=None;primary=None;failed=False;cleanup=[]
    try:
        fd=call(prefix+'_OPEN',os.open,name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=directory_fd)
        # Complete bounded writes. No fdopen ownership-transfer gap.
        offset=0
        while offset<len(encoded):
            count=call(prefix+'_WRITE',os.write,fd,encoded[offset:])
            if count<=0:deny(prefix+'_WRITE','PRIVATE_SHORT_WRITE')
            offset+=count
        call(prefix+'_FSYNC',os.fsync,fd)
    except BaseException as error:primary=error;failed=True
    finally:
        if fd is not None:
            try:call(prefix+'_CLOSE',os.close,fd)
            except BaseException as error:cleanup.append(error)
    if failed or cleanup:
        original=primary if failed else cleanup[0]
        original.cleanupFailed=getattr(original,'cleanupFailed',False)is True or bool(cleanup)
        raise original
    call(prefix+'_DIRECTORY_FSYNC',os.fsync,directory_fd)


def write_fixed_sink(receipt,sink_fd,sink_identity):
    check_sink_fd(sink_fd,*sink_identity)
    call('FINITE_VALIDATE',validate_finite_receipt,receipt)
    encoded=call('FINITE_ENCODE',json.dumps,receipt,sort_keys=True,allow_nan=False).encode('ascii')+b'\n'
    if len(encoded)>4096:deny('FINITE_BOUND','FIXED_NATIVE_RECEIPT_BOUND')
    if call('SINK_WRITE',os.write,sink_fd,encoded)!=len(encoded):
        deny('SINK_WRITE','FIXED_NATIVE_RECEIPT_SHORT_WRITE')
    call('SINK_FSYNC',os.fsync,sink_fd)


def failure_fallback(primary,trusted_types=(),receipt_write_failed=True):
    # This line is not a mandatory file, never repairs a failed receipt write.
    receipt=blocked_receipt(primary,trusted_types)
    call('FINITE_VALIDATE',validate_finite_receipt,receipt)
    try:print(json.dumps({'fixedNativeFallback':receipt,'receiptWriteFailed':receipt_write_failed},sort_keys=True))
    except BaseException:
        # The mandatory operation already failed. A broken diagnostic stdout
        # cannot replace the source-owned primary with BrokenPipe/OSError.
        primary.cleanupFailed=True


def run_extension(inventory,contract,deadline,private_dir_fd,private_identity,sink_fd,sink_identity,
                  trusted_types=()):
    primary=None;receipt=None;blocked=True
    # All borrowed-FD checks are inside failure handling; never close grants.
    try:
        check_directory_fd(private_dir_fd,*private_identity)
        check_sink_fd(sink_fd,*sink_identity)
        if deadline-call('CLOCK_READ',time.monotonic)<.1:
            deny('EXTENSION_BUDGET','QUALIFICATION_BUDGET_EXHAUSTED')
        raw=call('INVENTORY',inventory,contract,deadline)
        check_directory_fd(private_dir_fd,*private_identity)
        write_private(private_dir_fd,'inventory.json',raw)
        receipt,blocked=call('FINITE_PROJECT',finite_export_and_gate,raw)
    except BaseException as error:
        primary=error
        # Failure-file custody is rechecked, but failure evidence never masks
        # the original operation or prevents a safe fixed-sink attempt.
        try:
            check_directory_fd(private_dir_fd,*private_identity)
            write_private(private_dir_fd,'failure.json',diagnostic(primary,(NativeAdmissionDenied,*trusted_types)),True)
        except BaseException as evidence_error:
            primary.privateEvidenceFailed=True
            primary.cleanupFailed=getattr(primary,'cleanupFailed',False)is True or getattr(evidence_error,'cleanupFailed',False)is True
            primary.cleanupForced=getattr(primary,'cleanupForced',False)is True or getattr(evidence_error,'cleanupForced',False)is True
        receipt=blocked_receipt(primary,(NativeAdmissionDenied,*trusted_types))
        blocked=True
    # Check final budget BEFORE emitting, so the fixed mandatory receipt does
    # not say clean when this same lifetime already expired.
    if primary is None and call('CLOCK_READ',time.monotonic)>deadline:
        try:deny('FINAL_GATE','QUALIFICATION_BUDGET_EXHAUSTED')
        except NativeFixedFailure as error:primary=error
        receipt=blocked_receipt(primary,(NativeAdmissionDenied,*trusted_types));blocked=True
    try:write_fixed_sink(receipt,sink_fd,sink_identity)
    except BaseException as sink_error:
        if primary is None:primary=sink_error
        else:primary.cleanupFailed=getattr(primary,'cleanupFailed',False)is True or getattr(sink_error,'cleanupFailed',False)is True
        primary.sinkAttempted=True
        failure_fallback(primary,(NativeAdmissionDenied,*trusted_types))
        raise primary
    if call('CLOCK_READ',time.monotonic)>deadline and primary is None:
        error=NativeFixedFailure('FINAL_GATE',NativeAdmissionDenied('QUALIFICATION_BUDGET_EXHAUSTED'))
        error.receiptWritten=True
        failure_fallback(error,(NativeAdmissionDenied,*trusted_types),False)
        raise error
    if primary is not None:
        primary.receiptWritten=True
        raise primary
    if blocked:
        error=NativeFixedFailure('FINAL_GATE',NativeAdmissionDenied('STATIC_NATIVE_HARD_GAP'))
        error.receiptWritten=True
        raise error
    return receipt
