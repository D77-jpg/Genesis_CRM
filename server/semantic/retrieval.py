"""S3 retrieval windows are pointers, NEVER independent business facts.
Only Mongo-authorized IDs enter this module. No LLM, network, mail, or DB credentials.
"""
import collections
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
import unicodedata

STOP=set('the a an and or for to of is are your our this that what which does do how can you we it in on by with please fictional fixture only test'.split())
# General bilingual sales vocabulary, not fixture IDs, answers, numbers or policies.
ALIASES=[['珠宝','首饰','jewelry','jewellery'],['包装','packaging'],['绒布','天鹅绒','velvet'],['棉布','cotton'],['缎面','satin'],['尼龙','nylon'],['拉链','zipper'],['抽绳','drawstring'],['袋','pouch','pouches','bag','bags'],['盒','box','boxes'],['旅行','travel'],['样品','打样','sample','samples','prototype'],['起订','最低订','moq','minimum order'],['交期','交货','lead time','delivery'],['运费','freight'],['物流','shipping','logistics'],['付款','payment'],['价格','报价','price','quotation','pricing'],['认证','证书','certification','certificate'],['工厂','factory'],['公司','company'],['健身','fitness','gym'],['深蹲架','squat rack'],['材质','材料','fabric','material'],['刺绣','embroidery'],['烫金','foil'],['尺寸','size','dimension'],['镜面','mirror'],['工艺','finish'],['停用','retired','disabled'],['未发布','unpublished'],['加急','rush'],['分期','installment'],['赊账','赊销','账期','credit'],['未生效','未来','future'],['停产','discontinued'],['快速','express'],['涂层','coating']]

def normalize(text):
    return unicodedata.normalize('NFKC',text).lower()

def tokens(text,expand=True):
    text=normalize(text)
    words=re.findall(r'[a-z0-9]+(?:[-_.][a-z0-9]+)*',text)
    out=[w for w in words if w not in STOP]
    for run in re.findall(r'[\u4e00-\u9fff]+',text):
        out.extend(run[i:i+2] for i in range(len(run)-1))
        if len(run)==1: out.append(run)
    if expand:
        for group in ALIASES:
            if any((re.search(r'\b'+re.escape(w)+r'\b',text) if w.isascii() else w in text) for w in group):
                out.extend(t for w in group for t in tokens(w,False))
    return list(dict.fromkeys(out))

def windows(tokenizer,text,max_tokens=128,limit=128):
    """Lossless overlapping UTF-32 offsets; re-tokenize every slice (never truncate)."""
    tokenizer.no_padding();tokenizer.no_truncation()
    if not text.strip(): return []
    result=[];start=0
    while start<len(text):
        rest=text[start:];encoded=tokenizer.encode(rest)
        if len(encoded.ids)<=max_tokens:
            end=len(text)
        else:
            offsets=[v for v in encoded.offsets if v[1]>v[0]]
            end=start+offsets[max_tokens-4][1]
            while end>start and len(tokenizer.encode(text[start:end]).ids)>max_tokens: end-=1
        if end<=start: raise ValueError('token window cannot advance')
        result.append({'text':text[start:end],'start':start,'end':end,'tokens':len(tokenizer.encode(text[start:end]).ids)})
        if len(result)>limit: raise ValueError('window budget exceeded')
        if end==len(text): break
        # Small overlap is a retrieval aid; full policy/conditions always come from the parent.
        next_start=max(start+1,end-24)
        start=next_start
    return result


def query_parts(tokenizer,query,max_tokens=128):
    # Controlled punctuation/conjunction splitting only; never follows document
    # instructions or invents a translation/price. All nonseparator text survives.
    parts=re.split(r'(?<=[?!。！？;；\n])|\s+and\s+(?=(?:what|which|how|when|where|does|can)\b)|以及|并且',query,flags=re.I)
    result=[]
    for part in parts:
        if part.strip(): result.extend(windows(tokenizer,part.strip(),max_tokens,16))
    if len(result)>16: raise ValueError('query window budget exceeded')
    return result


def segment(tokenizer,atoms):
    result=[]
    for atom in atoms:
        for window in windows(tokenizer,atom['text']):
            result.append({**window,'key':atom['key']})
    return result


def bm25(db,docs,query):
    # A temporary FTS index contains ONLY the preauthorized candidates, including
    # its corpus statistics. Private docs cannot influence another user's scores.
    db.execute('CREATE VIRTUAL TABLE temp.search_lex USING fts5(item UNINDEXED, text, tokenize="unicode61")')
    db.executemany('INSERT INTO search_lex VALUES(?,?)',[(d['id'],' '.join(tokens(d['text']))) for d in docs])
    query_terms=tokens(query)[:160]
    if not query_terms: return []
    expression=' OR '.join('"'+word.replace('"','""')+'"' for word in query_terms)
    return [(r[0],-r[1]) for r in db.execute('SELECT item,bm25(search_lex) score FROM search_lex WHERE search_lex MATCH ? ORDER BY score,item',(expression,))]


def rerank(query,docs,options,Failure):
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    lock=json.loads(Path(__file__).with_name('reranker.json').read_text('utf-8'))
    root=Path(os.environ.get('KNOWLEDGE_RERANKER_DIR',''))
    if not os.environ.get('KNOWLEDGE_RERANKER_DIR'): raise Failure('rerank_unavailable','本地重排模型未配置')
    model_key=(str(root.resolve()),tuple((f['name'],(root/f['name']).stat().st_size,(root/f['name']).stat().st_mtime_ns) for f in lock['files']))
    cached=globals().get('_rerank_cache')
    if cached and cached[0]==model_key:
        tok,model=cached[1],cached[2]
    else:
        tok,model=None,None
    for artifact in ([] if model is not None else lock['files']):
        name,expected=artifact['name'],artifact['sha256']
        if hashlib.sha256((root/name).read_bytes()).hexdigest()!=expected: raise Failure('rerank_changed','重排模型校验失败')
    if model is None:
        tok=Tokenizer.from_file(str(root/'tokenizer.json'))
        model=ort.InferenceSession(str(root/lock['weight']),options,providers=['CPUExecutionProvider'])
        globals()['_rerank_cache']=(model_key,tok,model)
    tok.no_truncation();tok.no_padding()
    queries=query_parts(tok,query,80)
    pairs=[];owners=[]
    for d in docs:
        # Rerank every selected retrieval window, not a silently truncated parent.
        for q in queries:
            for part in windows(tok,d['text'],160,128):
                enc=tok.encode(q['text'],part['text'])
                if len(enc.ids)>256: raise Failure('rerank_budget','重排输入超过预算；未截断')
                pairs.append((q['text'],part['text']));owners.append(d['id'])
                if len(pairs)>256: raise Failure('rerank_budget','问题或候选过长，请拆分问题后重试')
    scores={}
    tok.enable_padding()
    for offset in range(0,len(pairs),8):
        enc=tok.encode_batch(pairs[offset:offset+8]);arrays={'input_ids':np.asarray([e.ids for e in enc],dtype=np.int64),'attention_mask':np.asarray([e.attention_mask for e in enc],dtype=np.int64),'token_type_ids':np.asarray([e.type_ids for e in enc],dtype=np.int64)}
        logits=model.run(None,{i.name:arrays[i.name] for i in model.get_inputs()})[0].reshape(-1)
        if not np.isfinite(logits).all(): raise Failure('rerank_invalid','本地重排结果无效')
        for owner,value in zip(owners[offset:offset+8],logits): scores[owner]=max(scores.get(owner,-math.inf),float(value))
    return scores,{'model':lock['model'],'revision':lock['revision'],'pairs':len(pairs)}


def retrieve(db,request,tokenizer,embed,options,Failure):
    import numpy as np
    started=time.perf_counter();mode=request.get('mode','hybrid_rerank')
    if mode not in ['bm25','vector','hybrid','hybrid_rerank']: raise Failure('mode_invalid','不支持的检索方式')
    docs=[{'id':r[0],'text':r[1],'parent':r[2]} for r in db.execute('SELECT t.item,t.text,t.parent FROM texts t JOIN allowed a ON a.item=t.item WHERE t.project=? AND t.generation=?',(request['projectId'],request['generation']))]
    byid={d['id']:d for d in docs}
    stored=dict(db.execute('SELECT item,hash FROM vectors WHERE project=? AND generation=?',(request['projectId'],request['generation'])))
    if any(hashlib.sha256(d['text'].encode()).hexdigest()!=stored.get(d['id']) for d in docs): raise Failure('lexical_corrupt','词项内容与已发布索引摘要不一致，请重建')
    if len(docs)!=len(set(request['allowed'])): raise Failure('lexical_missing','词项索引缺失，请重建资料')
    query=unicodedata.normalize('NFKC',request['query']).strip()
    if not query or len(query)>16000: raise Failure('query_budget','问题为空或过长，请拆分后查询')
    try: query_windows=query_parts(tokenizer,query,128)
    except ValueError: raise Failure('query_budget','问题超出单次处理预算，请拆分后查询；未截断')
    timings={};vector_scores={};lexical=[];query_vectors=[]
    now=time.perf_counter()
    if mode!='bm25':
        for offset in range(0,len(query_windows),8):
            for vector in embed([q['text'] for q in query_windows[offset:offset+8]]):
                query_vectors.append(vector)
                rows=db.execute('SELECT v.item,vec_distance_cosine(v.vector,?) distance FROM vectors v JOIN allowed a ON a.item=v.item WHERE v.project=? AND v.generation=? AND v.model=?',(vector.tobytes(),request['projectId'],request['generation'],request['identity'])).fetchall()
                for item,distance in rows: vector_scores[item]=max(vector_scores.get(item,-1),1-float(distance))
    timings['vectorMs']=round((time.perf_counter()-now)*1000,2);now=time.perf_counter()
    if mode!='vector': lexical=bm25(db,docs,query)
    timings['bm25Ms']=round((time.perf_counter()-now)*1000,2)
    # Deduplicate each branch by publication BEFORE top-k, avoiding sibling starvation.
    def distinct(pairs):
        seen=set();out=[]
        for item,score in pairs:
            parent=byid[item]['parent']
            if parent not in seen: seen.add(parent);out.append((item,score))
            if len(out)>=50: break
        return out
    vectors=distinct(sorted(vector_scores.items(),key=lambda p:(-p[1],p[0])))
    lexical=distinct(lexical);fused={};best={};details={}
    for branch,pairs in [('vector',vectors),('bm25',lexical)]:
        for rank,(item,score) in enumerate(pairs):
            parent=byid[item]['parent'];fused[parent]=fused.get(parent,0)+1/(60+rank+1)
            best.setdefault(parent,item);details.setdefault(parent,{})[branch]=score
            details[parent][branch+'Rank']=rank+1
    ordered=sorted(fused,key=lambda p:(-fused[p],p))[:30]
    degraded=None;rerank_meta=None;now=time.perf_counter();rerank_scores={}
    if mode=='hybrid_rerank' and ordered:
        selected=[byid[best[p]] for p in ordered[:30]]
        try:
            scores,rerank_meta=rerank(query,selected,options,Failure)
            rerank_scores={p:scores[best[p]] for p in ordered[:30]}
            ordered=sorted(ordered[:30],key=lambda p:(-rerank_scores[p],-fused[p],p))+ordered[30:]
        except Exception as e:
            degraded={'code':getattr(e,'code','rerank_failed'),'message':'重排暂时不可用，本次使用已授权的混合召回；排序质量可能下降'}
    timings['rerankMs']=round((time.perf_counter()-now)*1000,2)
    diagnostic=[]
    query_set=set(tokens(query));anchors=set(re.findall(r'\b[a-z]+(?:-[a-z]+)*-\d+[a-z0-9-]*\b',normalize(query)))
    diagnostic_rows=request.get('diagnostics',[])
    diagnostic_warning=None
    # State discovery searches authorized titles only, never unpublished/expired
    # policy bodies. No hidden policies are used as current business evidence.
    # A large historical archive is a maintenance warning, not a reason to fail a
    # normal query: old records can never become current evidence through this path.
    if len(diagnostic_rows)>128:
        diagnostic_warning={'code':'diagnostic_budget','message':f'历史资料状态检查共 {len(diagnostic_rows)} 条，超过建议的 128 条；本次继续使用受控匹配，旧政策不会作为当前依据'}
    if len(diagnostic_rows)>500:
        omitted=len(diagnostic_rows)-500
        diagnostic_rows=diagnostic_rows[:500]
        diagnostic_warning={'code':'diagnostic_budget','message':f'历史资料状态检查共 {len(diagnostic_rows)+omitted} 条；为控制单次开销，本次检查前 500 条（另有 {omitted} 条未检查），旧政策不会作为当前依据'}
    semantic_titles={}
    if query_vectors and diagnostic_rows:
        for row in diagnostic_rows:
            title_parts=windows(tokenizer,row['title'],128,4)
            vectors_for_title=embed([part['text'] for part in title_parts])
            semantic_titles[row['sourceId']]=max(float(v@q) for v in vectors_for_title for q in query_vectors)
    best_active=max(vector_scores.values(),default=0)
    for row in diagnostic_rows:
        title_set=set(tokens(row['title']));common=query_set&title_set
        exact=any(a in normalize(row['title']) for a in anchors)
        lexical=len(common)>=2 and len(common)/max(len(title_set),1)>=0.65
        similarity=semantic_titles.get(row['sourceId'],-1)
        semantic=similarity>=0.5 and similarity>=best_active+0.04
        if exact or lexical or semantic: diagnostic.append({'code':row['code'],'sourceId':row['sourceId'],'title':row['title']})
    hits=[]
    for parent in ordered:
        item=best[parent];score=details[parent]
        # Similarity/logits are ranking signals, never calibrated fact confidence.
        accepted=rerank_scores[parent]>=-4.3 if parent in rerank_scores else score.get('vector',-1)>=0.35 or score.get('bm25',0)>0
        if anchors:
            available=any(all(a in normalize(d['text']) for a in anchors) for d in docs)
            competing=set(re.findall(r'\b[a-z]+(?:-[a-z]+)*-\d+[a-z0-9-]*\b',normalize(byid[item]['text'])))
            if not available or (competing and not anchors<=competing): accepted=False
        hits.append({'id':item,'distance':1-score.get('vector',0),'accepted':accepted,'scores':{**score,'rrf':fused[parent],**({'rerank':rerank_scores[parent]} if parent in rerank_scores else {})}})
    timings['retrievalMs']=round((time.perf_counter()-started)*1000,2)
    return {'hits':hits,'trace':{'mode':mode,'queryParts':len(query_windows),'allowedItems':len(docs),'candidates':len(ordered),'timings':timings,'reranker':rerank_meta,'degraded':degraded,'warnings':[diagnostic_warning] if diagnostic_warning else [],'diagnostics':diagnostic}}
