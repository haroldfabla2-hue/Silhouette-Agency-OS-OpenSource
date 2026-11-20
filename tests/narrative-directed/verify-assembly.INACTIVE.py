"""Static archive verification. Reads hashes/tar/JSON only, no image/native/product execution."""
from pathlib import Path
import hashlib
import json
import tarfile


def digest(stream):
    value=hashlib.sha256()
    for raw in iter(lambda:stream.read(1048576),b''):value.update(raw)
    return value.hexdigest()


def verify(directory):
    root=Path(directory);doc=json.loads((root/'PREPARATION.json').read_text())
    manifest=json.loads((root/'DIRECTED-ROOTFS.json').read_text())
    with (root/'DIRECTED-ROOTFS.json').open('rb') as f:assert digest(f)==doc['rootfsManifestSha256']
    with (root/'directed-image.docker.tar').open('rb') as f:assert digest(f)==doc['dockerArchiveSha256']
    expected={row['target'].lstrip('/'):row for row in manifest}
    with tarfile.open(root/'directed-image.docker.tar','r:') as archive:
        assert len(archive.getmembers())==3
        saved=json.load(archive.extractfile('manifest.json'))
        assert len(saved)==1 and saved[0]['RepoTags']==[] and saved[0]['Layers']==['layer.tar']
        config=archive.extractfile(saved[0]['Config']).read()
        assert 'sha256:'+hashlib.sha256(config).hexdigest()==doc['imageConfigId']
        parsed=json.loads(config)
        assert parsed['rootfs']['diff_ids']==[doc['layerDiffId']]
        with archive.extractfile('layer.tar') as stream:assert 'sha256:'+digest(stream)==doc['layerDiffId']
        seen=set()
        with archive.extractfile('layer.tar') as stream:
            with tarfile.open(fileobj=stream,mode='r|') as layer:
                for row in layer:
                    assert row.name not in seen
                    seen.add(row.name)
                    assert row.uid==row.gid==row.mtime==0
                    assert not row.issym() and not row.islnk() and not row.isdev()
                    if row.isdir():continue
                    wanted=expected[row.name]
                    assert row.mode==wanted['mode'] and row.size==wanted['bytes']
                    with layer.extractfile(row) as raw:assert digest(raw)==wanted['sha256']
        assert set(expected)<=seen
    return {'kind':'STATIC_DOCKER_ARCHIVE_VERIFICATION_NOT_RUNTIME',
        'allFileHashesModesSizesMatched':True,'manifestFiles':len(expected),
        'imageConfigId':doc['imageConfigId'],'dockerArchiveSha256':doc['dockerArchiveSha256'],
        'layerDiffId':doc['layerDiffId'],'productEvaluated':False,'imageLoaded':False}


if __name__=='__main__':raise SystemExit('INACTIVE: explicit local preparation check only')
