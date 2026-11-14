"""SOURCE ONLY. Fixed secret-denying native inventory export and gate.
Untrusted/raw host data must never be serialized to the public evidence sink.
No tool invocation/import of acquired code in these functions.
"""
class NativeAdmissionDenied(Exception):
    pass

ALLOWED_GAPS=frozenset(('UNTRUSTED_LIBRARY_METADATA','MISSING_OR_AMBIGUOUS_LIBRARY',
                       'FINITE_PROVIDER_UNRESOLVED_OR_UNSUPPORTED'))

def finite_export_and_gate(raw):
    # Explicit projections only: NEVER return/copy generic raw data, exceptions,
    # paths, SONAME values, readelf text, version strings or source content.
    if type(raw)is not dict or raw.get('status')!='STATIC_NATIVE_INVENTORY_ONLY_NOT_LOAD_PROOF':
        raise NativeAdmissionDenied('PRIVATE_NATIVE_SCHEMA_INCOMPLETE')
    libraries=raw.get('libraries');gaps=raw.get('gaps');finite=raw.get('finiteProviderInventory')
    if type(libraries)is not list or len(libraries)>128 or type(gaps)is not list or len(gaps)>256 or type(finite)is not dict:
        raise NativeAdmissionDenied('PRIVATE_NATIVE_SCHEMA_INCOMPLETE')
    if any(type(x)is not str or x not in ALLOWED_GAPS for x in gaps):
        raise NativeAdmissionDenied('PRIVATE_NATIVE_GAP_NOT_ALLOWLISTED')
    providers=finite.get('providers');missing=finite.get('unresolvedSonames');unsupported=finite.get('unsupported')
    if type(providers)is not dict or len(providers)>128 or type(missing)is not list or len(missing)>16384 or type(unsupported)is not list or len(unsupported)>128:
        raise NativeAdmissionDenied('PRIVATE_PROVIDER_SCHEMA_INCOMPLETE')
    resolved=0
    for row in libraries:
        if type(row)is not dict or row.get('status')not in ('UNRESOLVED','CACHE_CANDIDATE_ONLY'):
            raise NativeAdmissionDenied('PRIVATE_LIBRARY_SCHEMA_INCOMPLETE')
        resolved+=row['status']=='CACHE_CANDIDATE_ONLY'
    blocked=bool(gaps or missing or unsupported or resolved!=len(libraries))
    receipt={'version':1,'status':'BLOCKED_STATIC_NATIVE_GAPS'if blocked else'STATIC_METADATA_ONLY_NOT_NATIVE_QUALIFIED',
             'libraryCount':len(libraries),'cacheCandidateCount':resolved,'providerObjectCount':len(providers),
             'unresolvedCount':len(missing),'unsupportedCount':len(unsupported),'fixedGapCount':len(gaps),
             'vendorAndDlopen':'UNVERIFIED','namespaceLoad':'NOT_EXECUTED','resourceFit':'UNVERIFIED',
             'nativeQualified':False,'productPass':False}
    # Caller writes ONLY this fixed receipt and exits failure when blocked.
    # Even clean static metadata has no native/runtime admission pass.
    return receipt, blocked

def require_static_no_gaps(raw):
    receipt,blocked=finite_export_and_gate(raw)
    if blocked:
        raise NativeAdmissionDenied('STATIC_NATIVE_HARD_GAP')
    return receipt
