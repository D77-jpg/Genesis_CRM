"""Genesis S2 local-only ONNX + sqlite-vec. JSON stdin/stdout; no CRM credentials."""
import ctypes
from collections import Counter
import socket
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
sys.stdout.reconfigure(encoding="utf-8", errors="strict")

VERSION = "genesis-semantic-s3.1"
# -I excludes the script directory; import only this audited sibling explicitly.
sys.dont_write_bytecode = True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from retrieval import segment,retrieve,tokens as lexical_tokens


class Failure(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def digest(value):
    return hashlib.sha256(value).hexdigest()


def lexical_row(text):
    """Build the immutable lexical postings once, at index build time.

    FTS5's corpus statistics are global to a virtual table. Sharing one FTS
    table across projects or access scopes would let private terms affect
    another user's BM25 scores, so the portable index stores postings and
    computes BM25 over the current authorized candidate set instead.
    """
    terms = lexical_tokens(text)
    return ' '.join(terms), len(terms), Counter(terms)


def copy_lexical(db, project, source, target, item_ids):
    """Copy already verified local rows in bounded batches (SQLite parameter cap)."""
    copied = 0
    for offset in range(0, len(item_ids), 400):
        chunk = item_ids[offset:offset + 400]
        marks = ','.join('?' * len(chunk))
        db.execute(
            f'INSERT OR IGNORE INTO texts SELECT project,?,item,text,parent FROM texts '
            f'WHERE project=? AND generation=? AND item IN ({marks})',
            (target, project, source, *chunk),
        )
        db.execute(
            f'INSERT OR IGNORE INTO vectors SELECT project,?,item,model,hash,vector FROM vectors '
            f'WHERE project=? AND generation=? AND item IN ({marks})',
            (target, project, source, *chunk),
        )
        db.execute(
            f'INSERT OR IGNORE INTO lexical SELECT project,?,item,parent,scope,hash,length,text,terms FROM lexical '
            f'WHERE project=? AND generation=? AND item IN ({marks})',
            (target, project, source, *chunk),
        )
        db.execute(
            f'INSERT OR IGNORE INTO lexical_terms SELECT project,?,item,term,tf FROM lexical_terms '
            f'WHERE project=? AND generation=? AND item IN ({marks})',
            (target, project, source, *chunk),
        )
        copied += db.execute(
            f'SELECT COUNT(*) FROM texts WHERE project=? AND generation=? AND item IN ({marks})',
            (project, target, *chunk),
        ).fetchone()[0]
    return copied


def restrict():
    # Limits are installed before loading native PDF/OCR libraries. Windows Job
    # Objects enforce process memory and CPU, Linux uses kernel rlimits.
    if os.name == "nt":
        from ctypes import wintypes as W
        class Basic(ctypes.Structure):
            _fields_ = [("perProcess", ctypes.c_longlong), ("perJob", ctypes.c_longlong),
                        ("flags", W.DWORD), ("minWork", ctypes.c_size_t), ("maxWork", ctypes.c_size_t),
                        ("active", W.DWORD), ("affinity", ctypes.c_size_t), ("priority", W.DWORD), ("scheduling", W.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(n, ctypes.c_ulonglong) for n in ["readOps", "writeOps", "otherOps", "readBytes", "writeBytes", "otherBytes"]]
        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", IO), ("processMemory", ctypes.c_size_t),
                        ("jobMemory", ctypes.c_size_t), ("peakProcess", ctypes.c_size_t), ("peakJob", ctypes.c_size_t)]
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.CreateJobObjectW.restype = W.HANDLE
        k.SetInformationJobObject.argtypes = [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD]
        k.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
        k.GetCurrentProcess.restype = W.HANDLE
        job = k.CreateJobObjectW(None, None)
        limits = Extended()
        limits.basic.flags = 0x100 | 0x2 | 0x8  # process memory, CPU time, active-process limit
        limits.basic.perProcess = 120 * 10000000
        limits.basic.active = 1
        limits.processMemory = 1536 * 1024**2
        if not job or not k.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not k.AssignProcessToJobObject(job, k.GetCurrentProcess()):
            raise Failure("resource_limits", "无法建立本地语义资源限制，请检查运行环境")
        # Keep the handle open until process exit.
        globals()["_job"] = job
    else:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
        resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
    def blocked(*_args, **_kwargs):
        raise PermissionError("Parser network access is disabled")
    socket.socket.connect = blocked
    socket.socket.connect_ex = blocked
    socket.create_connection = blocked
    def audit(event, _args):
        if event in {"subprocess.Popen", "os.system", "os.exec", "socket.connect", "socket.bind"}:
            blocked()
    sys.addaudithook(audit)



def main(request=None):
    if not globals().get("_restricted"):
        restrict()
        globals()["_restricted"] = True
    started = time.perf_counter()
    request = request if request is not None else json.loads(sys.stdin.buffer.readline(8 * 1024**2))
    lock = json.loads(Path(__file__).with_name("model.json").read_text("utf-8"))
    model_dir = Path(os.environ["KNOWLEDGE_MODEL_DIR"]).resolve()
    for key, expected in lock["packages"].items():
        if importlib.metadata.version(key) != expected:
            raise Failure("runtime_changed", "本地语义组件版本与锁定版本不一致，请检查安装")
    stamps = tuple((name,(model_dir/name).stat().st_size,(model_dir/name).stat().st_mtime_ns) for name in lock['files'])
    model_key = (str(model_dir),digest(json.dumps(lock,sort_keys=True).encode()),stamps)
    if globals().get('_model_key') != model_key:
        for name, expected in lock['files'].items():
            if digest((model_dir/name).read_bytes()) != expected:
                raise Failure('model_changed','本地模型文件校验失败，请恢复锁定版本后重建')
        globals()['_model_key'] = model_key
        globals().pop('_session',None)
        globals().pop('_tokenizer',None)
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    import sqlite_vec
    import psutil
    # No download client, document executors, or untrusted code in this adapter.
    def audit(event, args):
        if event.startswith(("socket.", "subprocess.")) or event in ("os.system", "os.exec", "os.posix_spawn"):
            raise Failure("network_denied", "本地向量进程不允许访问网络或启动其他程序")
    if not globals().get("_native_audit"):
        sys.addaudithook(audit)
        globals()["_native_audit"] = True
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    options.enable_mem_pattern = False
    options.log_severity_level = 3
    ort.disable_telemetry_events()
    tokenizer = globals().get("_tokenizer")
    if tokenizer is None:
        tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        globals()["_tokenizer"] = tokenizer
    tokenizer.no_truncation()
    tokenizer.enable_padding()
    session = globals().get("_session")
    def embed(texts):
        nonlocal session
        tokenizer.no_padding()
        lengths = [len(tokenizer.encode(text).ids) for text in texts]
        if any(n > lock["maxTokens"] for n in lengths):
            raise Failure("atom_too_long", "发布片段或适用条件超过模型 128 token 上限，请拆成条件完整的小条目后重建；未截断正文")
        tokenizer.enable_padding()
        enc = tokenizer.encode_batch(texts)
        if session is None:
            session = ort.InferenceSession(str(model_dir / lock["weight"]), options, providers=["CPUExecutionProvider"])
            globals()["_session"] = session
        arrays = {"input_ids": np.array([e.ids for e in enc], dtype=np.int64),
                  "attention_mask": np.array([e.attention_mask for e in enc], dtype=np.int64),
                  "token_type_ids": np.array([e.type_ids for e in enc], dtype=np.int64)}
        output = session.run(None, {i.name: arrays[i.name] for i in session.get_inputs()})
        hidden = next(x for x in output if x.ndim == 3)
        mask = arrays["attention_mask"][..., None]
        pooled = (hidden * mask).sum(1) / np.maximum(mask.sum(1), 1)
        pooled /= np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12)
        if pooled.shape != (len(texts), lock["dimension"]) or not np.isfinite(pooled).all():
            raise Failure("invalid_vector", "模型输出维度或数值无效")
        return pooled.astype(np.float32)
    identity = request["identity"]
    if request["dimension"] != lock["dimension"]:
        raise Failure("dimension_mismatch", "索引维度与模型不兼容，请建立新索引代次")
    root = Path(os.environ["KNOWLEDGE_INDEX_DIR"]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(root / "semantic.sqlite3", timeout=20)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=20000")
    db.enable_load_extension(True)
    sqlite_vec.load(db)
    db.enable_load_extension(False)
    db.executescript("""
    CREATE TABLE IF NOT EXISTS vectors(project TEXT, generation TEXT, item TEXT, model TEXT, hash TEXT, vector BLOB,
      PRIMARY KEY(project,generation,item));
    CREATE TABLE IF NOT EXISTS embeddings(project TEXT, scope TEXT, model TEXT, hash TEXT, vector BLOB,
      PRIMARY KEY(project,scope,model,hash));
    CREATE INDEX IF NOT EXISTS vectors_generation ON vectors(project,generation);
    """)
    db.execute("CREATE TABLE IF NOT EXISTS texts(project TEXT,generation TEXT,item TEXT,text TEXT,parent TEXT,PRIMARY KEY(project,generation,item))")
    # Persistent lexical postings. They are derived data and can be rebuilt;
    # source publications remain in Mongo and are never rewritten here.
    db.executescript("""
    CREATE TABLE IF NOT EXISTS lexical(project TEXT,generation TEXT,item TEXT,parent TEXT,scope TEXT,hash TEXT,
      length INTEGER,text TEXT,terms TEXT,PRIMARY KEY(project,generation,item));
    CREATE INDEX IF NOT EXISTS lexical_generation ON lexical(project,generation);
    CREATE TABLE IF NOT EXISTS lexical_terms(project TEXT,generation TEXT,item TEXT,term TEXT,tf INTEGER,
      PRIMARY KEY(project,generation,item,term));
    CREATE INDEX IF NOT EXISTS lexical_terms_lookup ON lexical_terms(project,generation,term);
    """)
    project, generation = request["projectId"], request.get("generation", "")
    command = request["command"]
    result = {}
    if command == "segment":
        try: result={"segments":segment(tokenizer,request["atoms"])}
        except ValueError: raise Failure("window_budget", "资料过长，超过单条检索窗口预算；原文未截断，请按主题拆分")
    elif command == "embed":
        texts=request["texts"]
        if not 0<len(texts)<=16:
            raise Failure("batch_limit", "每次向量化最多 16 个片段")
        result={"vectors":embed(texts).tolist()}
    elif command == "upsert":
        items = request["items"]
        if not 0 < len(items) <= 16:
            raise Failure("batch_limit", "索引批次大小无效")
        missing, reused = [], 0
        for item in items:
            row = db.execute("SELECT vector FROM embeddings WHERE project=? AND scope=? AND model=? AND hash=?",
                             (project, item["scope"], identity, item["hash"])).fetchone()
            if row:
                item["vector"] = row[0]
                reused += 1
            else:
                missing.append(item)
        if missing:
            for item, vector in zip(missing, embed([i["text"] for i in missing])):
                item["vector"] = vector.tobytes()
        with db:
            for item in items:
                if len(item["vector"]) != lock["dimension"] * 4:
                    raise Failure("dimension_mismatch", "持久向量长度异常，请重建")
                db.execute("INSERT OR IGNORE INTO embeddings VALUES(?,?,?,?,?)", (project, item["scope"], identity, item["hash"], item["vector"]))
                existing = db.execute("SELECT model,hash FROM vectors WHERE project=? AND generation=? AND item=?", (project, generation, item["id"])).fetchone()
                if existing and existing != (identity, item["hash"]):
                    raise Failure("immutable_collision", "代次内的片段发生变化，请建立新代次")
                db.execute("INSERT OR IGNORE INTO vectors VALUES(?,?,?,?,?,?)", (project, generation, item["id"], identity, item["hash"], item["vector"]))
                db.execute("INSERT OR IGNORE INTO texts VALUES(?,?,?,?,?)",(project,generation,item["id"],item["text"],item.get("parent",item["id"])))
                token_text, token_length, postings = lexical_row(item["text"])
                existing_lex = db.execute("SELECT hash FROM lexical WHERE project=? AND generation=? AND item=?", (project, generation, item["id"])).fetchone()
                if existing_lex and existing_lex[0] != item["hash"]:
                    raise Failure("immutable_collision", "代次内的词项内容发生变化，请建立新代次")
                db.execute(
                    "INSERT OR IGNORE INTO lexical(project,generation,item,parent,scope,hash,length,text,terms) VALUES(?,?,?,?,?,?,?,?,?)",
                    (project, generation, item["id"], item.get("parent", item["id"]), item["scope"], item["hash"], token_length, item["text"], token_text),
                )
                # Retried writes replace only this item's postings; no global rebuild.
                db.execute("DELETE FROM lexical_terms WHERE project=? AND generation=? AND item=?", (project, generation, item["id"]))
                db.executemany(
                    "INSERT INTO lexical_terms(project,generation,item,term,tf) VALUES(?,?,?,?,?)",
                    [(project, generation, item["id"], term, count) for term, count in postings.items()],
                )
        result = {"count": len(items), "embedded": len(missing), "reused": reused}
    elif command == "copy":
        source = str(request["sourceGeneration"])
        target = str(request["generation"])
        item_ids = [str(i) for i in request.get("items", [])]
        if not item_ids or len(item_ids) > 50000:
            raise Failure("batch_limit", "增量复制批次为空或超过上限")
        if source == target:
            raise Failure("copy_invalid", "增量复制源代次与目标代次相同")
        with db:
            copied = copy_lexical(db, project, source, target, item_ids)
        result = {"count": copied}
    elif command == "verify":
        rows = db.execute("SELECT item,model,hash,length(vector) FROM vectors WHERE project=? AND generation=? ORDER BY item", (project, generation)).fetchall()
        if any(r[1] != identity or r[3] != lock["dimension"] * 4 for r in rows):
            raise Failure("dimension_mismatch", "索引模型或维度不一致，请重建")
        for vector, in db.execute('SELECT vector FROM vectors WHERE project=? AND generation=?',(project,generation)):
            array=np.frombuffer(vector,dtype=np.float32)
            if not np.isfinite(array).all() or abs(float(np.linalg.norm(array))-1)>0.001:
                raise Failure('invalid_vector', '索引向量数值或归一化校验失败，请重建')
        texts=db.execute("SELECT item,text FROM texts WHERE project=? AND generation=? ORDER BY item",(project,generation)).fetchall()
        if len(texts)!=len(rows) or any(a[0]!=b[0] or digest(b[1].encode())!=a[2] for a,b in zip(rows,texts)):
            raise Failure("lexical_missing", "词项索引缺失或不完整，请重建资料")
        lexical_count=db.execute("SELECT COUNT(*) FROM lexical WHERE project=? AND generation=?",(project,generation)).fetchone()[0]
        lexical_terms_count=db.execute("SELECT COUNT(DISTINCT item) FROM lexical_terms WHERE project=? AND generation=?",(project,generation)).fetchone()[0]
        if lexical_count:
            lexical_rows=db.execute("SELECT item,hash,text FROM lexical WHERE project=? AND generation=? ORDER BY item",(project,generation)).fetchall()
            if len(lexical_rows)!=len(rows) or any(a[0]!=b[0] or a[1]!=b[2] or digest(a[2].encode())!=a[1] for a,b in zip(lexical_rows,rows)):
                raise Failure("lexical_missing", "词项索引缺失或不完整，请重建资料")
        result = {"count": len(rows), "checksum": digest(json.dumps([[r[0], r[2]] for r in rows], separators=(",", ":")).encode()),
                  "lexical": lexical_count, "lexicalTerms": lexical_terms_count}
    elif command == "query":
        stored = db.execute('SELECT item,hash,model,length(vector) FROM vectors WHERE project=? AND generation=? ORDER BY item', (project,generation)).fetchall()
        signature = digest(json.dumps([[r[0],r[1]] for r in stored], separators=(',',':')).encode())
        if len(stored)!=request['expectedCount'] or signature!=request['expectedChecksum'] or any(r[2]!=identity or r[3]!=lock['dimension']*4 for r in stored):
            raise Failure('index_missing_or_corrupt', '本地索引缺失或不完整，请管理员重建；不能作为没有相关知识处理')
        allowed = request["allowed"]
        if len(allowed) > 50000:
            raise Failure("scope_limit", "候选范围超过首版索引上限")
        # SQL join applies the current Mongo-authorized candidate IDs BEFORE distance evaluation.
        db.execute("CREATE TEMP TABLE allowed(item TEXT PRIMARY KEY)")
        db.executemany("INSERT OR IGNORE INTO allowed VALUES(?)", [(i,) for i in allowed])
        result = retrieve(db,request,tokenizer,embed,options,Failure)
    elif command == "cleanup":
        with db:
            for key in request["generations"]:
                db.execute("DELETE FROM vectors WHERE project=? AND generation=?", (project, key))
                db.execute("DELETE FROM texts WHERE project=? AND generation=?", (project,key))
                db.execute("DELETE FROM lexical WHERE project=? AND generation=?", (project,key))
                db.execute("DELETE FROM lexical_terms WHERE project=? AND generation=?", (project,key))
            # Remove cache artifacts no longer referenced, scoped to this project only.
            db.execute("DELETE FROM embeddings WHERE project=? AND NOT EXISTS (SELECT 1 FROM vectors WHERE vectors.project=embeddings.project AND vectors.model=embeddings.model AND vectors.hash=embeddings.hash)", (project,))
        result = {"removed": len(request["generations"])}
    else:
        raise Failure("unknown_command", "不支持的本地索引操作")
    db.close()
    result.update({"adapter": VERSION, "dimension": lock["dimension"], "identity": identity,
                   "elapsedMs": round((time.perf_counter()-started)*1000, 2), "rssMiB": round(psutil.Process().memory_info().rss/1024**2, 2)})
    print(json.dumps({"ok": True, "result": result, "requestId":request.get("requestId")}, ensure_ascii=False), flush=True)


def execute(request=None):
    try:
        main(request)
    except Failure as error:
        print(json.dumps({'ok':False,'code':error.code,'message':error.message,'requestId':(request or {}).get('requestId')},ensure_ascii=False),flush=True)
        return 2
    except Exception:
        print(json.dumps({'ok':False,'code':'local_runtime_failure','message':'本地模型或索引不可用，请检查固定组件与存储','requestId':(request or {}).get('requestId')},ensure_ascii=False),flush=True)
        return 3
    return 0

if __name__ == '__main__':
    if '--worker' in sys.argv:
        while True:
            line=sys.stdin.buffer.readline(8*1024**2+1)
            if not line: break
            if len(line)>8*1024**2: sys.exit(4)
            try: request=json.loads(line)
            except Exception: sys.exit(4)
            execute(request)
    else:
        sys.exit(execute())
