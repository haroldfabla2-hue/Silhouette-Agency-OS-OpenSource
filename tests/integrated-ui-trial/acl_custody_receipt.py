"""SOURCE ONLY finite decision receipt. No raw data, IDs, paths or hashes."""
KEYS={'version','status','inspectedAncestors','aclAncestors','defaultAclAncestors','untrustedWriteEntries','model','effectiveDacChecked','mountModelChecked','productPass'}
STATUSES={'SUPPORTED_MODEL_DAC_CUSTODY','BLOCKED_UNSAFE_ACCESS','BLOCKED_UNSUPPORTED_OR_INCOMPLETE'}
def validate(v):
    assert type(v)is dict and set(v)==KEYS
    assert type(v['version'])is int and v['version']==1 and v['status']in STATUSES
    assert v['model']=='ROOT_AND_SUPERVISOR_ONLY_LOCAL_EXT4_XFS_NONIDMAPPED'
    for k,n in(('inspectedAncestors',32),('aclAncestors',32),('defaultAclAncestors',32),('untrustedWriteEntries',16352)):
        if k=='untrustedWriteEntries'and v['status']!='SUPPORTED_MODEL_DAC_CUSTODY':assert v[k]is None
        else:assert type(v[k])is int and 0<=v[k]<=n
    assert type(v['effectiveDacChecked'])is bool and type(v['mountModelChecked'])is bool and v['productPass']is False
    if v['status']=='SUPPORTED_MODEL_DAC_CUSTODY':assert v['effectiveDacChecked']and v['mountModelChecked']and v['untrustedWriteEntries']==0
    else:assert not v['effectiveDacChecked']
    return v

def finite(chain,status):
    raw=chain.raw_private if chain is not None else[]
    good=status=='SUPPORTED_MODEL_DAC_CUSTODY'
    return validate({'version':1,'status':status,'inspectedAncestors':len(raw),'aclAncestors':sum(x['access']is not None for x in raw),'defaultAclAncestors':sum(x['default']is not None for x in raw),'untrustedWriteEntries':0 if good else None,'model':'ROOT_AND_SUPERVISOR_ONLY_LOCAL_EXT4_XFS_NONIDMAPPED','effectiveDacChecked':good,'mountModelChecked':good,'productPass':False})
