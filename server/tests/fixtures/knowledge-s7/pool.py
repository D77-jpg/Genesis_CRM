import sys,json,time,os
for line in sys.stdin:
 r=json.loads(line)
 if r.get('delay'):time.sleep(r['delay'])
 print(json.dumps({'ok':not r.get('fail'), 'code':'local_runtime_failure' if r.get('fail') else None,'requestId':r['requestId'],'pid':os.getpid(),'identity':r.get('identity'),'result':{'rssMiB':10}}),flush=True)
