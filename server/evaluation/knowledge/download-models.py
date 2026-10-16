"""Fetch pinned public artifacts into an explicit private cache. No inference/network uploads."""
import argparse,urllib.request,json,pathlib,hashlib,time
p=argparse.ArgumentParser();p.add_argument('--models',type=pathlib.Path,required=True);root=p.parse_args().models;root.mkdir(parents=True,exist_ok=True)
lock=json.loads((pathlib.Path(__file__).parent/'model-lock.json').read_text(encoding='utf-8'));results=[]
for model in lock['models']:
 result={**model,'status':'unverified'}
 try:
  for item in model['files']:
   target=root/model['repo'].replace('/','--')/item['file'];target.parent.mkdir(parents=True,exist_ok=True)
   if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()!=item['sha256']:
    url='https://huggingface.co/'+model['repo']+'/resolve/'+model['revision']+'/'+item['file'];tmp=pathlib.Path(str(target)+'.part');deadline=time.monotonic()+180
    with urllib.request.urlopen(url,timeout=40) as response,tmp.open('wb') as f:
     total=0
     while data:=response.read(1024*1024):
      total+=len(data)
      if total>600*1024*1024 or time.monotonic()>deadline:raise RuntimeError('Download bound exceeded')
      f.write(data)
    if hashlib.sha256(tmp.read_bytes()).hexdigest()!=item['sha256']:raise RuntimeError('Pinned artifact hash mismatch')
    tmp.replace(target)
  result['status']='downloaded'
 except Exception as error:result['error']=type(error).__name__+': '+str(error)[:200]
 results.append(result);print(json.dumps({'repo':result['repo'],'status':result['status'],'error':result.get('error')}),flush=True)
(root/'manifest.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8')
if any(r['status']!='downloaded' for r in results):raise SystemExit(2)
