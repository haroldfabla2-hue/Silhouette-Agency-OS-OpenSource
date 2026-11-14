"""Pure exact phase/helper contract. No root, cgroup, network or workload calls."""
from pathlib import Path
import hashlib
LEGACY_SHA = '0b15dc9f61dac241681c41ff0d730fe627087b3ed1cde4c3a64683c4606708bc'
CHECKS_SHA = '7a8a9542c8586c715a49a80fe04bc1f3a60e8862f4ea71fb8d6661f2c2f99ff8'
PHASES = ('install', 'native', 'browser', 'checks')
def contract(phase):
    if phase not in PHASES:
        raise ValueError('Unknown phase')
    return {'pids': 256 if phase == 'checks' else 96,
            'helper_sha256': CHECKS_SHA if phase == 'checks' else LEGACY_SHA,
            'helper_name': 'root-self-admit-checks256.py' if phase == 'checks' else 'root-self-admit.py',
            'memory': 8*1024**3, 'swap': 0, 'cpu': '200000 100000',
            'nofile': 4096 if phase == 'install' else 256,
            'fsize': (256 if phase == 'browser' else 128 if phase == 'install' else 64)*1024**2,
            'tmpfs': 512*1024**2}
def validate_helper(phase, path, claimed_sha):
    expected=contract(phase); p=Path(path); data=p.read_bytes()
    assert p.name==expected['helper_name'], 'Phase/helper-name mismatch'
    assert claimed_sha==expected['helper_sha256'], 'Phase/helper-pin mismatch'
    assert len(data)<=16384 and hashlib.sha256(data).hexdigest()==expected['helper_sha256'], 'Helper bytes mismatch'
    return data
if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--phase',choices=PHASES,required=True);parser.add_argument('--legacy',required=True);parser.add_argument('--checks',required=True);a=parser.parse_args()
    selected=a.checks if a.phase=='checks' else a.legacy
    expected=contract(a.phase);validate_helper(a.phase,selected,expected['helper_sha256'])
    print(selected,expected['helper_sha256'])
