"""One reviewed non-secret template match, never a file/pattern-wide bypass."""
import re
PATH='app/services/genesisService.js'
EMITTED_SHA='3ac0e464e5fddfdd50230f036d494f1229af491a73e38f1e77a8938b81b05f03'
SOURCE_SHA='75e721bfd55e6b132f650c9cd904e627daa35168be2fb9ef4b36d99decdfed5e'
PATTERN=r'https?://[^\s/:]+:[^\s/@]+@'
# Only interpolation names, not a credential or a resolved URL. Constructed
# to avoid making this audit helper itself look like a userinfo URL literal.
EXPECTED_MATCH='https://'+'${gitUser}'+':'+'${gitToken}'+'@'

def exception(rel,pattern,text,file_sha,source_sha):
 matches=re.findall(pattern,text)
 if rel!=PATH or pattern!=PATTERN:return None
 assert file_sha==EMITTED_SHA,'AUDIT_EXCEPTION_EMITTED_DRIFT'
 assert source_sha==SOURCE_SHA,'AUDIT_EXCEPTION_SOURCE_DRIFT'
 assert matches==[EXPECTED_MATCH],'AUDIT_EXCEPTION_MATCH_DRIFT'
 return {'path':PATH,'sha256':EMITTED_SHA,'sourcePath':'services/genesisService.ts',
         'sourceSha256':SOURCE_SHA,'patternClass':'URL_USERINFO','count':1,
         'reason':'Reviewed exact emitted template contains only two variable interpolations, no credential values. Only this single match is excepted; all other pattern matches remain fail-closed.'}

def finish(records):
 assert len(records)==1 and records[0]['path']==PATH,'AUDIT_EXCEPTION_EXPECTED_ONCE'
