"""SOURCE ONLY, not invoked. Supervisor-preopened FD custody and fixed sink.
No directory creation, chmod, UID, mount or capability changes here.
Supervisor must close candidate-inherited aliases and attest mount/ACL custody
before handing down these FDs. DAC/FD checks are a minimum, not that proof.
"""
import os
import stat
import json
import time
from native_finite_exporter import finite_export_and_gate, NativeAdmissionDenied
from native_receipt_schema import validate as validate_finite_receipt

def check_directory_fd(fd, expected_device, expected_inode):
    st=os.fstat(fd)
    if not(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and os.geteuid()>0 and st.st_mode&0o077==0
           and(st.st_dev,st.st_ino)==(expected_device,expected_inode)):
        raise NativeAdmissionDenied('PRIVATE_DIRECTORY_FD_CUSTODY')

def check_sink_fd(fd, expected_device, expected_inode):
    st=os.fstat(fd)
    if not(stat.S_ISREG(st.st_mode)and st.st_nlink==1 and st.st_uid==os.geteuid() and os.geteuid()>0
           and st.st_mode&0o077==0 and st.st_size==0
           and(st.st_dev,st.st_ino)==(expected_device,expected_inode)):
        raise NativeAdmissionDenied('FIXED_SINK_FD_CUSTODY')

def run_extension(inventory, contract, deadline, private_dir_fd, private_identity,
                  sink_fd, sink_identity):
    # Function/source/contract identities are pinned by supervisor, never candidate.
    check_directory_fd(private_dir_fd,*private_identity);check_sink_fd(sink_fd,*sink_identity)
    if deadline-time.monotonic()<0.1:
        raise NativeAdmissionDenied('QUALIFICATION_BUDGET_EXHAUSTED')
    try:
        raw=inventory(contract,deadline)
        check_directory_fd(private_dir_fd,*private_identity)
        fd=os.open('inventory.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,
                   0o600,dir_fd=private_dir_fd)
        with os.fdopen(fd,'w')as stream:
            json.dump(raw,stream,allow_nan=False);stream.flush();os.fsync(stream.fileno())
        os.fsync(private_dir_fd)
        receipt,blocked=finite_export_and_gate(raw)
    except BaseException as original:
        # Retain fixed original class and separate forced-cleanup bit privately.
        failure={'exceptionClass':type(original).__name__[:128],'cleanupForced':getattr(original,'cleanup_forced',False)is True}
        fd=os.open('failure.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=private_dir_fd)
        with os.fdopen(fd,'w')as stream:
            json.dump(failure,stream);stream.flush();os.fsync(stream.fileno())
        os.fsync(private_dir_fd)
        # No raw paths/error/string/version/SONAME is sent to public evidence.
        receipt={'version':1,'status':'BLOCKED_PRIVATE_INVENTORY_UNAVAILABLE',
                 'libraryCount':0,'cacheCandidateCount':0,'providerObjectCount':0,
                 'unresolvedCount':0,'unsupportedCount':0,'fixedGapCount':1,
                 'vendorAndDlopen':'UNVERIFIED','namespaceLoad':'NOT_EXECUTED',
                 'resourceFit':'UNVERIFIED','nativeQualified':False,'productPass':False}
        blocked=True
    check_sink_fd(sink_fd,*sink_identity)
    validate_finite_receipt(receipt)
    encoded=(json.dumps(receipt,sort_keys=True,allow_nan=False)+'\n').encode('ascii')
    if len(encoded)>4096:
        raise NativeAdmissionDenied('FIXED_NATIVE_RECEIPT_BOUND')
    if os.write(sink_fd,encoded)!=len(encoded):
        raise NativeAdmissionDenied('FIXED_NATIVE_RECEIPT_SHORT_WRITE')
    os.fsync(sink_fd)
    if blocked or time.monotonic()>deadline:
        raise NativeAdmissionDenied('STATIC_NATIVE_HARD_GAP_OR_BUDGET')
    return receipt
