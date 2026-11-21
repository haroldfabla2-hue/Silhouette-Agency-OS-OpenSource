"""INACTIVE public byte transport. Download only, never unpack/evaluate code.
Invoked only by separately reviewed future job, no credentials in output.
"""
import hashlib,json,os,urllib.request,urllib.error
from pathlib import Path
HERE=Path(__file__).resolve().parent
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):return None
def need(x,c):
 if not x:raise RuntimeError(c)
def stream(response,target,size,digest):
 h=hashlib.sha256();count=0
 with response,Path(target).open('xb') as out:
  while True:
   b=response.read(1048576)
   if not b:break
   count+=len(b);need(count<=size,'PUBLIC_DOWNLOAD_BOUND');h.update(b);out.write(b)
 need(count==size and h.hexdigest()==digest,'PUBLIC_DOWNLOAD_PIN')
def acquire(destination):
 target=Path(destination);need(not target.exists(),'PUBLIC_INPUT_ALREADY_EXISTS');target.mkdir(mode=0o700);layers=target/'layers';layers.mkdir();manifest=json.loads((HERE/'producer/node-linux-amd64-manifest.json').read_text())
 token=json.load(urllib.request.urlopen('https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull',timeout=15))['token']
 for row in manifest['layers']:
  digest=row['digest'].split(':')[1];request=urllib.request.Request('https://registry-1.docker.io/v2/library/node/blobs/'+row['digest'],headers={'Authorization':'Bearer '+token});opener=urllib.request.build_opener(NoRedirect)
  try:response=opener.open(request,timeout=30)
  except urllib.error.HTTPError as error:
   need(error.code in (301,302,303,307,308),'OCI_LAYER_UNAVAILABLE');url=error.headers.get('Location','');need(url.startswith('https://'),'OCI_LAYER_REDIRECT_HTTPS');response=urllib.request.urlopen(url,timeout=30)
  stream(response,layers/(digest+'.tar.gz'),row['size'],digest)
 del token
 # Exact previous public artifact as bytes only; API credentials stay in this
 # unprivileged transport, never forwarded to signed blob redirect or root.
 gh=os.environ.pop('GH_TOKEN');request=urllib.request.Request('https://api.github.com/repos/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource/actions/artifacts/14655138390/zip',headers={'Authorization':'Bearer '+gh,'Accept':'application/vnd.github+json'});opener=urllib.request.build_opener(NoRedirect)
 try:response=opener.open(request,timeout=30)
 except urllib.error.HTTPError as error:
  need(error.code in (301,302,303,307,308),'NATIVE_PUBLIC_ARTIFACT_UNAVAILABLE');url=error.headers.get('Location','');need(url.startswith('https://'),'NATIVE_REDIRECT_NOT_HTTPS');response=urllib.request.urlopen(url,timeout=30)
 del gh,request
 stream(response,target/'native-original.zip',181155369,'a549abd2f6a03266566ee14df09ba93882ff94458bdc514bc015bb3e31ea13d4')
 print('PUBLIC_PINNED_BYTE_TRANSPORT_COMPLETE',flush=True)
if __name__=='__main__':
 import sys
 need(len(sys.argv)==2,'TRANSPORT_ARGUMENT');acquire(sys.argv[1])
