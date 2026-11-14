from native_fixed_boundary import OPERATIONS,REASONS
# SOURCE ONLY fixed public receipt validator, no raw host text accepted.
def validate(value):
 keys={'version','status','libraryCount','cacheCandidateCount','providerObjectCount','unresolvedCount','unsupportedCount','fixedGapCount','vendorAndDlopen','namespaceLoad','resourceFit','nativeQualified','productPass','failureOperation','failureReason','cleanupFailed','cleanupForced','privateEvidenceFailed'}
 assert type(value)is dict and set(value)==keys
 assert type(value['version'])is int and value['version']==1
 assert value['status']in {'BLOCKED_PRIVATE_INVENTORY_UNAVAILABLE','BLOCKED_STATIC_NATIVE_GAPS','STATIC_METADATA_ONLY_NOT_NATIVE_QUALIFIED'}
 for key,maximum in [('libraryCount',128),('cacheCandidateCount',128),('providerObjectCount',128),('unresolvedCount',16384),('unsupportedCount',128),('fixedGapCount',256)]:
  assert type(value[key])is int and 0<=value[key]<=maximum
 assert value['vendorAndDlopen']=='UNVERIFIED'and value['namespaceLoad']=='NOT_EXECUTED'and value['resourceFit']=='UNVERIFIED'
 assert value['failureOperation']in OPERATIONS|{'NONE','UNATTRIBUTED_INTERNAL'}
 assert value['failureReason']in REASONS
 for field in('cleanupFailed','cleanupForced','privateEvidenceFailed'):assert type(value[field])is bool
 assert value['cacheCandidateCount']<=value['libraryCount']
 if value['status']=='STATIC_METADATA_ONLY_NOT_NATIVE_QUALIFIED':
  assert value['failureOperation']=='NONE'and value['failureReason']=='NONE'
  assert not any(value[k]for k in('cleanupFailed','cleanupForced','privateEvidenceFailed'))
  assert value['cacheCandidateCount']==value['libraryCount']and value['fixedGapCount']==value['unresolvedCount']==value['unsupportedCount']==0
 else:assert value['failureOperation']!='NONE'and value['failureReason']!='NONE'
 assert value['nativeQualified']is False and value['productPass']is False
 return 'FIXED_STATIC_NATIVE_RECEIPT_ONLY'
