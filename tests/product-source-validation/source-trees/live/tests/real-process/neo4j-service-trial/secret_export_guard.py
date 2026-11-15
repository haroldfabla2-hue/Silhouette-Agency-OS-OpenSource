"""Source-only output guard for authorized fixture credentials. Never hashes keys.
No values are created on import. Pass real in-memory secret bytearrays only.
This detects known plaintext/Basic transport variants, not all arbitrary encodings.
"""
import base64,json
class FixtureSecretExportDetected(RuntimeError):pass
class FixtureExportGuard:
    def __init__(self,secrets):
        self.needles=[]
        for value in secrets:
            assert isinstance(value,bytearray)and value
            raw=bytes(value)
            self.needles.extend([raw,base64.b64encode(b'neo4j:'+raw)])
        self.overlap=max(map(len,self.needles))-1
        self.tail=bytearray();self.rejected=False
    def checked_chunk(self,chunk):
        if self.rejected:raise FixtureSecretExportDetected('Fixture export permanently rejected')
        data=bytes(self.tail)+chunk
        if any(needle in data for needle in self.needles):
            self.rejected=True
            raise FixtureSecretExportDetected('Known fixture credential bytes in output; no raw disclosure permitted')
        # Do not release the final overlap until subsequent input/EOF has been
        # checked, or a split secret could leak its first fragment beforehand.
        if len(data)<=self.overlap:self.tail[:]=data;return b''
        safe=data[:-self.overlap];self.tail[:]=data[-self.overlap:];return safe
    def checked_eof(self):
        if self.rejected:raise FixtureSecretExportDetected('Fixture export permanently rejected')
        out=bytes(self.tail);self.tail.clear();return out
    def clear(self):
        self.tail[:]=b'\0'*len(self.tail);self.tail.clear();self.needles.clear()
