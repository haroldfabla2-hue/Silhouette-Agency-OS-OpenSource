"""Static preparation budget checks, not permission or a runtime memory limit."""
def validate(inventory,limits):
 assert set(limits)=={'files','mountableBytes','reviewOnlyBytes','totalBytes'},'BUDGET_DIMENSION_DRIFT'
 assert set(inventory['byDisposition'])=={'mountable','review-only'},'BUDGET_UNKNOWN_DISPOSITION'
 assert all(isinstance(v,int) and not isinstance(v,bool) and v>=0 for v in limits.values()),'BUDGET_LIMIT_VALUE'
 for disposition in inventory['byDisposition'].values():
  assert set(disposition)=={'files','bytes'},'BUDGET_DISPOSITION_SCHEMA'
  assert all(isinstance(v,int) and not isinstance(v,bool) and v>=0 for v in disposition.values()),'BUDGET_DISPOSITION_VALUE'
 assert inventory['files']==sum(d['files'] for d in inventory['byDisposition'].values()),'BUDGET_COUNT_SUM_DRIFT'
 assert inventory['dispositions']==inventory['byDisposition'],'BUDGET_DIAGNOSTIC_DRIFT'
 actual={'files':inventory['files'],'mountableBytes':inventory['byDisposition']['mountable']['bytes'],
         'reviewOnlyBytes':inventory['byDisposition']['review-only']['bytes'],'totalBytes':inventory['bytes']}
 assert all(isinstance(v,int) and not isinstance(v,bool) and v>=0 for v in actual.values()),'BUDGET_VALUE'
 assert actual['totalBytes']==actual['mountableBytes']+actual['reviewOnlyBytes'],'BUDGET_SUM_DRIFT'
 exceeded={k:{'actual':v,'limit':limits[k]} for k,v in actual.items() if v>limits[k]}
 assert not exceeded,'FINITE_CAPSULE_BUDGET_'+str(exceeded)
 return actual
