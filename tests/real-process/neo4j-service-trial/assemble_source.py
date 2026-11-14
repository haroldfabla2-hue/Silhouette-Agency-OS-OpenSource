"""SOURCE ONLY. Future pure-data staging into a NEW disposable source directory.
Never writes baseline, .git, deploy, server, deps or unrelated files. No import-time
work or permission inferred from this file. Separate execution review required.
"""
import hashlib,json,os,pathlib

def assemble_source(source_root,destination_root,packet_root):
    source=pathlib.Path(source_root);dest=pathlib.Path(destination_root);packet=pathlib.Path(packet_root)
    assert source.resolve(strict=True)==source and source.is_dir()
    assert dest.is_absolute() and not dest.exists() and not dest.is_symlink()
    assert packet.resolve(strict=True)==packet and packet.is_dir()
    original=json.loads((packet/'source-assembly-baseline.json').read_text())
    proposed=json.loads((packet/'proposed-integral-inputs.json').read_text())
    assert len(original)==1549 and len(proposed)==1550
    source_rows={row['path']:row for row in original}
    assert len(source_rows)==1549
    for row in original:
        rel=pathlib.PurePosixPath(row['path']);assert not rel.is_absolute()and'..'not in rel.parts
        assert not any(part=='.git'or part=='node_modules' for part in rel.parts)
        assert not rel.name.startswith('.env')or rel.name=='.env.example'
        p=source/rel;assert p.is_file()and not p.is_symlink()and p.resolve().is_relative_to(source)
        assert p.stat().st_size==row['bytes']and hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256']
    # Three explicitly reviewed proposed changes only; no fallback or fuzzy patch.
    overlay={'services/redisClient.ts':packet/'proposed-product-overlay/services/redisClient.ts',
             'silhouette.config.json':packet/'config/silhouette.config.json',
             'services/userProfileService.ts':packet/'proposed-product-overlay/services/userProfileService.ts'}
    dest.mkdir(mode=0o755)
    for row in proposed:
        rel=row['path'];p=overlay.get(rel,source/rel)
        raw=p.read_bytes();assert len(raw)==row['bytes']and hashlib.sha256(raw).hexdigest()==row['sha256']
        target=dest/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
        target.chmod((p.stat().st_mode&0o111)|0o644)
    assert len([p for p in dest.rglob('*')if p.is_file()])==1550
    return {'status':'DISPOSABLE_SOURCE_STAGED_NOT_EXECUTED','source_files':1549,'staged_files':1550,
            'base_head':'7854560d1f5e3a4256e2ee62a41840432dee8cb9','proposed_overlay_paths':list(overlay),
            'authority':'NOT_CREATED_BY_STAGING_OR_INPUT_FILE'}


if __name__=='__main__':
    import sys
    assert len(sys.argv)==4
    print(json.dumps(assemble_source(sys.argv[1],sys.argv[2],sys.argv[3]),separators=(',',':')))
