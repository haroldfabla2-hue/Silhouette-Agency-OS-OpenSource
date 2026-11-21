"""INACTIVE final envelope binding checks; no effects."""
import hashlib,json,re
from pathlib import Path
def need(x,c):
 if not x:raise RuntimeError(c)
def validate(result,closure,rootsha,types):
 need(result.get('reviewRootSha256')==rootsha and closure.get('reviewRootSha256')==rootsha,'PRODUCER_ROOT_BINDING')
 need(closure.get('ociPlatformDigest')=='sha256:bb6834c0669aa71cbc8d94606561a721adf489f6b93d7b8b825f0cf1b498c2c4','PRODUCER_OCI_BINDING')
 need(result.get('uid') is not None and 62000<=result['uid']<64000 and result.get('ownedNetworkRemoved') is True and result.get('ownedUnitRemoved') is True and result.get('workRemountedReadOnly') is True,'PRODUCER_CLEANUP_CUSTODY')
 proof=result.get('networkProof',{});need(proof.get('kind')=='NETNS_NFT_ACTUAL_CONTROLLED_DENIAL_AND_PUBLIC_TLS_SUCCESS' and proof.get('controlledHostBaselineConnected') is True and proof.get('hostListenerReceivedChild') is False and proof.get('notTextualReadbackOnly') is True,'PRODUCER_ENFORCEMENT_PROOF')
 before=proof.get('before',{});after=proof.get('after',{});need(before.get('namespace')==after.get('namespace') and before.get('table')==after.get('table') and after.get('deniedProbePackets',0)>before.get('deniedProbePackets',0) and after.get('publicHttpsPackets',0)>before.get('publicHttpsPackets',0),'PRODUCER_REAL_COUNTERS')
 need(before.get('namespaceInode')==after.get('namespaceInode') and before.get('hostNamespaceInode')==after.get('hostNamespaceInode') and before.get('forwardingBefore')==after.get('forwardingObserved')=='1' and before.get('hostRuleset') and after.get('hostRuleset') and before.get('hostRoutes') and after.get('hostRoutes'),'PRODUCER_HOST_NAMESPACE_EVIDENCE')
 need(result.get('nonStdioDescriptorsClosedBeforeGate') is True and len(result.get('familyFilterEvidence',[]))==4 and all(item.get('errno')==97 for item in result['familyFilterEvidence']),'PRODUCER_SOCKET_FILTER_EVIDENCE')
 need(closure.get('networkPolicy')==result.get('networkPolicy')==before.get('policy')==after.get('policy'),'PRODUCER_NETWORK_CLOSURE')
 need(proof.get('childProbe',{}).get('tlsVerified') is True and proof['childProbe'].get('httpsHost')=='registry.npmjs.org' and proof['childProbe'].get('httpsStatus')==200 and proof['childProbe'].get('hostConnectSucceeded') is False,'PRODUCER_TLS_DENIAL_RESULT')
 need(types.get('preparationClosureSha256')==result.get('preparationClosureSha256') and types.get('sourceManifestSha256')==closure.get('sourceManifestSha256') and types.get('toolchainPinsSha256')==closure.get('toolchainPinsSha256'),'PRODUCER_TYPES_CLOSURE')
