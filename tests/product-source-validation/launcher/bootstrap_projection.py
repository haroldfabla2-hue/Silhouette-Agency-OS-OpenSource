"""Strict projection of owned bwrap status and Python bootstrap records."""
import json
BOOTSTRAP_STAGES={'PYTHON_STARTED','SOURCE_READ','SOURCE_COMPILE','SOURCE_EXEC'}
BOOTSTRAP_FAILURES={'SYNTAX','IMPORT','PERMISSION','NOT_FOUND','CHILD_NONZERO','OTHER'}
def pairs(items):
    value={}
    for key,item in items:
        if key in value:raise ValueError('DUPLICATE_KEY')
        value[key]=item
    return value

def decode(raw,limit):
    if type(raw)is not bytes or len(raw)>limit:raise ValueError('SIZE')
    return [json.loads(line,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('NONFINITE')))for line in raw.splitlines()]

def project_bwrap(raw):
    result={'status':'UNKNOWN','forkObserved':None,'preExecMarkerObserved':None,'exitCode':None,'productPass':False}
    try:
        rows=decode(raw,4096)
        if not rows:return result
        if len(rows)>2:raise ValueError('ROWS')
        first=rows[0]
        allowed={'child-pid','pid-namespace','net-namespace','ipc-namespace','uts-namespace','cgroup-namespace','mnt-namespace'}
        if type(first)is not dict or 'child-pid'not in first or not set(first)<=allowed or not all(type(x)is int and x>0 for x in first.values()):raise ValueError('FORK_SCHEMA')
        result.update(status='FORK_ONLY_NOT_SETUP_PROOF',forkObserved=True)
        if len(rows)==2:
            last=rows[1]
            if type(last)is not dict or set(last)!={'exit-code'}or type(last['exit-code'])is not int or not 0<=last['exit-code']<=255:raise ValueError('EXIT_SCHEMA')
            result.update(status='PRE_EXEC_MARKER_WITHOUT_REPORTED_EXEC_FAILURE',preExecMarkerObserved=True,exitCode=last['exit-code'])
    except (ValueError,UnicodeError,TypeError):result.update(status='INVALID',forkObserved=None,preExecMarkerObserved=None,exitCode=None)
    return result

def project_bootstrap(raw):
    result={'status':'UNKNOWN','operation':None,'failure':None,'productPass':False}
    try:
        rows=decode(raw,4096)
        if not rows:return result
        if len(rows)>5:raise ValueError('ROWS')
        previous=-1;order=['PYTHON_STARTED','SOURCE_READ','SOURCE_COMPILE','SOURCE_EXEC'];failed=False
        for row in rows:
            if type(row)is not dict or set(row)!={'version','operation','failure','productPass'}or type(row['version'])is not int or row['version']!=1 or row['productPass']is not False or row['operation']not in BOOTSTRAP_STAGES or row['failure']not in BOOTSTRAP_FAILURES|{None}:raise ValueError('SCHEMA')
            index=order.index(row['operation'])
            if failed or index<previous or(index==previous and row['failure']is None):raise ValueError('ORDER')
            previous=index;failed=row['failure']is not None
            result.update(status='FIXED_FAILURE'if failed else'OBSERVED_NOT_ACCEPTANCE',operation=row['operation'],failure=row['failure'])
    except (ValueError,UnicodeError,TypeError):result.update(status='INVALID',operation=None,failure=None)
    return result
