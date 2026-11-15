"""Fixed nonsecret control receipts, no arbitrary path/body CLI transport."""
import json,os,pathlib,sys
from evidence_policy import configure,emit_text
E=pathlib.Path(os.environ['EVIDENCE']);configure(E)
if sys.argv[1]=='trial-cleanup':
    assert len(sys.argv)==5
    values=[int(x)for x in sys.argv[2:]]
    emit_text(E/'trial-cleanup.json',json.dumps(dict(zip(['cgroup_rc','volume_rc','trial_rc'],values)),separators=(',',':'))+'\n')
elif sys.argv[1]=='security-initial':
    assert len(sys.argv)==2
    emit_text(E/'security-helpers-state.json','{"status":"UNSAFE","reason":"acquire not yet safely completed"}\n')
elif sys.argv[1]=='setup-complete':
    assert len(sys.argv)==2
    emit_text(E/'sandbox-setup.txt','SETUP_COMPLETE_NOT_RUNTIME_PASS\n')
else:raise ValueError('Unknown fixed evidence operation')
