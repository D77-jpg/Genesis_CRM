"""S0 offline component experiment; only fictional development data, never a CRM database.
Download weights separately, then this process runs with network connections blocked.
"""
import argparse, json, pathlib, time, hashlib, platform, sys, os, sqlite3, importlib.metadata, threading, socket
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
import psutil

parser=argparse.ArgumentParser();parser.add_argument('--fixtures',type=pathlib.Path,required=True);parser.add_argument('--models',type=pathlib.Path,required=True);parser.add_argument('--output',type=pathlib.Path,required=True)
args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
# No HTTP inference, telemetry or credential discovery is possible in the probe process.
def offline(*_args,**_kwargs):raise RuntimeError('Network disabled in local component probe')
socket.create_connection=offline
socket.socket.connect=offline
ort.disable_telemetry_events()
corpus=json.loads((args.fixtures/'corpus.json').read_text(encoding='utf-8'))
dev=json.loads((args.fixtures/'cases.dev.json').read_text(encoding='utf-8'))
probe=json.loads((args.fixtures/'probe-set.json').read_text(encoding='utf-8'))
bycase={c['id']:c for c in dev};queries=[bycase[i] for i in probe['caseIds']]
assert len(queries)==12 and all(c['split']=='dev' for c in queries)
docs=[s for s in corpus['sources'] if s['kind']=='knowledge' and s['state']=='active' and s['category']!='sales_rules']
text=[s['title']+'\n'+s['content'] for s in docs]
process=psutil.Process();measurements=[];stop=threading.Event()
def sample():
    while not stop.wait(.02):measurements.append(process.memory_info().rss)
monitor=threading.Thread(target=sample,daemon=True);monitor.start()
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def score(ranks):
    rows=[]
    for case,rank in zip(queries,ranks):
        need={ref.rsplit('.',1)[0] for ref in case['required']};hits=[docs[i]['id'] for i in rank]
        rows.append({'caseId':case['id'],'recallAt10':len(need.intersection(hits[:10]))/len(need),'reciprocalRank':next((1/(i+1) for i,key in enumerate(hits[:10]) if key in need),0),'top3':hits[:3]})
    return {'unit':'source-level, development probe only; not span-level baseline and not final quality','cases':12,'recallAt10':sum(r['recallAt10'] for r in rows)/12,'mrrAt10':sum(r['reciprocalRank'] for r in rows)/12,'rows':rows}
def resource(start,base):return {'seconds':round(time.perf_counter()-start,3),'rssBeforeMiB':round(base/2**20,2),'rssAfterMiB':round(process.memory_info().rss/2**20,2),'processPeakSoFarMiB':round(max(measurements+[process.memory_info().rss])/2**20,2),'processCpuSecondsTotal':round(sum(process.cpu_times()[:2]),3)}
def session(repo,max_tokens):
    root=args.models/repo.replace('/','--')
    pinned=next(m for m in json.loads((args.fixtures/'model-lock.json').read_text(encoding='utf-8'))['models'] if m['repo']==repo)
    for artifact in pinned['files']:
        if digest(root/artifact['file'])!=artifact['sha256']:raise RuntimeError('Model artifact hash mismatch')
    tok=Tokenizer.from_file(str(root/'tokenizer.json'));tok.enable_padding();tok.enable_truncation(max_length=max_tokens)
    settings=ort.SessionOptions();settings.intra_op_num_threads=4;settings.inter_op_num_threads=1
    weight=root/('onnx/model_quint8_avx2.onnx' if repo.startswith(('cross-encoder/','sentence-transformers/')) else 'onnx/model_quantized.onnx')
    model=ort.InferenceSession(str(weight),sess_options=settings,providers=['CPUExecutionProvider'])
    def run(batch):
        enc=tok.encode_batch(batch);arrays={'input_ids':np.asarray([e.ids for e in enc],dtype=np.int64),'attention_mask':np.asarray([e.attention_mask for e in enc],dtype=np.int64),'token_type_ids':np.asarray([e.type_ids for e in enc],dtype=np.int64)}
        result=model.run(None,{item.name:arrays[item.name] for item in model.get_inputs()})
        return result,arrays['attention_mask']
    return run,{'weight':weight.name,'sha256':digest(weight),'bytes':weight.stat().st_size,'threads':4,'provider':'CPUExecutionProvider','maxTokens':max_tokens}
manifest=json.loads((args.models/'manifest.json').read_text(encoding='utf-8'))
report={'schemaVersion':1,'createdAt':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'network':'Python socket connections denied; ONNX telemetry disabled; local inference only','scope':'12 development questions only; no holdout, no LLM, no live CRM access','fixtureHashes':{p.name:digest(p) for p in [args.fixtures/'corpus.json',args.fixtures/'cases.dev.json',args.fixtures/'probe-set.json']},'codeSha256':digest(pathlib.Path(__file__)),'modelLockSha256':digest(args.fixtures/'model-lock.json'),'runtime':{'python':sys.version,'platform':platform.platform(),'cpuLogical':os.cpu_count(),'ramBytes':psutil.virtual_memory().total,'packages':{p:importlib.metadata.version(p) for p in ['onnxruntime','tokenizers','numpy','psutil','sqlite-vec','rapidocr-onnxruntime','Pillow']}},'models':manifest,'components':{}}
vectors=None;query_vectors=None
for repo in ['Xenova/all-MiniLM-L6-v2','sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2']:
    start=time.perf_counter();base=process.memory_info().rss
    try:
        run,meta=session(repo,128)
        def embed(items):
            blocks=[]
            for i in range(0,len(items),8):
                result,mask=run(items[i:i+8]);hidden=next(x for x in result if x.ndim==3);pooled=(hidden*mask[...,None]).sum(1)/np.maximum(mask.sum(1)[:,None],1);pooled/=np.maximum(np.linalg.norm(pooled,axis=1,keepdims=True),1e-12);blocks.append(pooled.astype(np.float32))
            return np.vstack(blocks)
        dv=embed(text);qv=embed([q['query'] for q in queries]);ranks=[sorted([i for i,s in enumerate(docs) if s['project']==case['project']],key=lambda i:float(dv[i]@q),reverse=True)[:10] for case,q in zip(queries,qv)]
        report['components'][repo]={'status':'verified',**meta,**resource(start,base),'dimensions':dv.shape[1],'finite':bool(np.isfinite(dv).all()),'probe':score(ranks)}
        if repo.startswith('sentence-transformers/'):
            vectors=dv;query_vectors=qv
            np.save(args.output/'document-vectors.npy',dv);np.save(args.output/'query-vectors.npy',qv)
        print(json.dumps({'component':repo,'status':'verified','seconds':round(time.perf_counter()-start,2)}),flush=True)
    except Exception as error:report['components'][repo]={'status':'unverified','error':type(error).__name__+': '+str(error)[:250]};print(json.dumps({'component':repo,'status':'unverified','error':str(error)[:180]}),flush=True)
    finally:(args.output/'components.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
start=time.perf_counter();base=process.memory_info().rss
try:
    repo='cross-encoder/mmarco-mMiniLMv2-L12-H384-v1';run,meta=session(repo,256);ranks=[];latencies=[]
    if vectors is None:raise RuntimeError('No verified embedding vectors')
    for query,qv in zip(queries,query_vectors):
        eligible=[i for i,s in enumerate(docs) if s['project']==query['project']]
        candidate=sorted(eligible,key=lambda i:float(vectors[i]@qv),reverse=True)[:20]
        now=time.perf_counter();raw,_=run([(query['query'],text[i]) for i in candidate]);values=raw[0].reshape(-1);ranks.append([candidate[i] for i in np.argsort(-values)[:10]]);latencies.append((time.perf_counter()-now)*1000)
    report['components']['rerank']={'status':'verified','repo':repo,**meta,**resource(start,base),'latencyMs':{'p50':float(np.percentile(latencies,50)),'p95':float(np.percentile(latencies,95))},'probe':score(ranks),'authority':'project filter before model, but not production scope/version implementation'}
    print(json.dumps({'component':'rerank','status':'verified','p95Ms':round(float(np.percentile(latencies,95)),2)}),flush=True)
except Exception as error:report['components']['rerank']={'status':'unverified','error':type(error).__name__+': '+str(error)[:250]}
(args.output/'components.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
start=time.perf_counter();base=process.memory_info().rss
try:
    import sqlite_vec
    if vectors is None:raise RuntimeError('No verified embedding vectors')
    dbpath=args.output/'fixture-index.sqlite';dbpath.unlink(missing_ok=True)
    def connect():
        db=sqlite3.connect(dbpath);db.enable_load_extension(True);sqlite_vec.load(db);db.enable_load_extension(False);return db
    db=connect();extension_version=db.execute('select vec_version()').fetchone()[0]
    db.execute('create table chunks(id integer primary key, project text not null, generation text not null, active integer not null, vector blob not null)');db.execute('create index scope on chunks(project,generation,active)')
    db.executemany('insert into chunks values (?,?,?,?,?)',[(i,docs[i%len(docs)]['project'],'g1',1,vectors[i%len(docs)].tobytes()) for i in range(10000)]);db.commit();latencies=[]
    def query(vector,project):return db.execute('select id,project,vec_distance_cosine(vector,?) distance from chunks where project=? and generation=? and active=1 order by distance,id limit 10',(vector.tobytes(),project,'g1')).fetchall()
    for q,qv in zip(queries,query_vectors):
        now=time.perf_counter();hits=query(qv,q['project']);latencies.append((time.perf_counter()-now)*1000);assert hits and all(hit[1]==q['project'] for hit in hits)
    before=query(query_vectors[0],queries[0]['project']);db.close();db=connect();assert query(query_vectors[0],queries[0]['project'])==before
    db.execute('update chunks set active=0 where id=?',(before[0][0],));db.commit();assert before[0][0] not in [h[0] for h in query(query_vectors[0],queries[0]['project'])]
    db.execute('create virtual table lexical using fts5(content)');db.execute('insert into lexical values (?)',('standard velvet pouch',));assert db.execute("select count(*) from lexical where lexical match 'velvet'").fetchone()[0]==1
    db.close();report['components']['index']={'status':'verified','component':'SQLite + sqlite-vec scalar cosine + FTS5','version':extension_version,'sqlite':sqlite3.sqlite_version,'kind':'exact filtered flat search, not ANN','persistentReload':True,'projectFilter':True,'disabledExclusion':True,'fts5EnglishSmoke':True,'rows':10000,'scaleCaveat':'50-source corpus active knowledge vectors repeated; not 10k independent documents; vector query only, no concurrency or end-to-end model latency','diskBytes':dbpath.stat().st_size,'latencyMs':{'p50':float(np.percentile(latencies,50)),'p95':float(np.percentile(latencies,95))},**resource(start,base)}
    print(json.dumps({'component':'index','status':'verified','p95Ms':round(float(np.percentile(latencies,95)),2)}),flush=True)
except Exception as error:report['components']['index']={'status':'unverified','error':type(error).__name__+': '+str(error)[:250]}
(args.output/'components.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
start=time.perf_counter();base=process.memory_info().rss
try:
    from rapidocr_onnxruntime import RapidOCR
    from PIL import Image,ImageDraw,ImageFont
    import rapidocr_onnxruntime
    lines=['FICTIONAL S0 TEST - NOT A REAL POLICY','Velvet pouch MOQ 73 pcs','Production 19 working days after artwork approval','虚构测试：绒布袋起订量 73 件','图稿确认后起算，运费需另外确认']
    image=Image.new('RGB',(1600,520),'white');draw=ImageDraw.Draw(image);font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',38)
    for i,line in enumerate(lines):draw.text((40,25+i*90),line,fill='black',font=font)
    engine=RapidOCR(intra_op_num_threads=4,inter_op_num_threads=1);ocr=[]
    for name,sample_image in [('clean',image),('rotated',image.rotate(2,resample=Image.Resampling.BICUBIC,expand=True,fillcolor='white'))]:
        path=args.output/('ocr-'+name+'.png');sample_image.save(path);now=time.perf_counter();result,_=engine(str(path));recognized='\n'.join(item[1] for item in (result or []));expected='\n'.join(lines)
        def norm(s):return ''.join(c for c in s.lower() if c.isalnum())
        a,b=norm(expected),norm(recognized);previous=list(range(len(b)+1))
        for i,ca in enumerate(a):
            current=[i+1]
            for j,cb in enumerate(b):current.append(min(current[-1]+1,previous[j+1]+1,previous[j]+(ca!=cb)))
            previous=current
        ocr.append({'fixture':name,'sha256':digest(path),'expected':expected,'recognized':recognized,'normalizedCER':previous[-1]/len(a),'numericTokensPreserved':all(n in recognized for n in ['73','19']),'seconds':round(time.perf_counter()-now,3)})
    models_dir=pathlib.Path(rapidocr_onnxruntime.__file__).parent/'models';weights=[{'file':p.name,'sha256':digest(p),'bytes':p.stat().st_size} for p in models_dir.glob('*.onnx')]
    report['components']['ocr']={'status':'verified','component':'rapidocr-onnxruntime bundled PP-OCR','version':importlib.metadata.version('rapidocr-onnxruntime'),'models':weights,'tests':ocr,'scope':'generated clean/2-degree rotated image only; PDF rendering, noisy photos, complex tables, certificate verification are not evaluated',**resource(start,base)}
    print(json.dumps({'component':'ocr','status':'verified','cer':[round(x['normalizedCER'],4) for x in ocr]}),flush=True)
except Exception as error:report['components']['ocr']={'status':'unverified','error':type(error).__name__+': '+str(error)[:250]}
stop.set();monitor.join();report['processPeakMiB']=round(max(measurements+[process.memory_info().rss])/2**20,2)
(args.output/'components.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if any(c['status']!='verified' for c in report['components'].values()):sys.exit(2)
