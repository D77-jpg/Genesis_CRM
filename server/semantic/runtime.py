"""Genesis S2 local-only ONNX + sqlite-vec. JSON stdin/stdout; no CRM credentials."""
import ctypes
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

VERSION = "genesis-semantic-s2.1"


class Failure(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def digest(value):
    return hashlib.sha256(value).hexdigest()


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



def main():
    restrict()
    started = time.perf_counter()
    request = json.loads(sys.stdin.buffer.readline(8 * 1024**2))
    lock = json.loads(Path(__file__).with_name("model.json").read_text("utf-8"))
    model_dir = Path(os.environ["KNOWLEDGE_MODEL_DIR"]).resolve()
    for key, expected in lock["packages"].items():
        if importlib.metadata.version(key) != expected:
            raise Failure("runtime_changed", "本地语义组件版本与锁定版本不一致，请检查安装")
    for name, expected in lock["files"].items():
        if digest((model_dir / name).read_bytes()) != expected:
            raise Failure("model_changed", "本地模型文件校验失败，请恢复锁定版本后重建")
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    import sqlite_vec
    import psutil
    # No download client, document executors, or untrusted code in this adapter.
    def audit(event, args):
        if event.startswith(("socket.", "subprocess.")) or event in ("os.system", "os.exec", "os.posix_spawn"):
            raise Failure("network_denied", "本地向量进程不允许访问网络或启动其他程序")
    sys.addaudithook(audit)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    options.enable_mem_pattern = False
    options.log_severity_level = 3
    ort.disable_telemetry_events()
    tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
    tokenizer.no_truncation()
    tokenizer.enable_padding()
    session = None
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
    project, generation = request["projectId"], request.get("generation", "")
    command = request["command"]
    result = {}
    if command == "embed":
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
        result = {"count": len(items), "embedded": len(missing), "reused": reused}
    elif command == "verify":
        rows = db.execute("SELECT item,model,hash,length(vector) FROM vectors WHERE project=? AND generation=? ORDER BY item", (project, generation)).fetchall()
        if any(r[1] != identity or r[3] != lock["dimension"] * 4 for r in rows):
            raise Failure("dimension_mismatch", "索引模型或维度不一致，请重建")
        for vector, in db.execute('SELECT vector FROM vectors WHERE project=? AND generation=?',(project,generation)):
            array=np.frombuffer(vector,dtype=np.float32)
            if not np.isfinite(array).all() or abs(float(np.linalg.norm(array))-1)>0.001:
                raise Failure('invalid_vector', '索引向量数值或归一化校验失败，请重建')
        result = {"count": len(rows), "checksum": digest(json.dumps([[r[0], r[2]] for r in rows], separators=(",", ":")).encode())}
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
        vector = embed([request["query"]])[0].tobytes()
        rows = db.execute("""SELECT v.item,vec_distance_cosine(v.vector,?) AS distance FROM vectors v
          JOIN allowed a ON a.item=v.item WHERE v.project=? AND v.generation=? AND v.model=?
          AND length(v.vector)=? ORDER BY distance,v.item LIMIT 30""", (vector, project, generation, identity, lock["dimension"] * 4)).fetchall()
        result = {"hits": [{"id": r[0], "distance": r[1]} for r in rows], "queryDimension": len(vector)//4}
    elif command == "cleanup":
        with db:
            for key in request["generations"]:
                db.execute("DELETE FROM vectors WHERE project=? AND generation=?", (project, key))
            # Remove cache artifacts no longer referenced, scoped to this project only.
            db.execute("DELETE FROM embeddings WHERE project=? AND NOT EXISTS (SELECT 1 FROM vectors WHERE vectors.project=embeddings.project AND vectors.model=embeddings.model AND vectors.hash=embeddings.hash)", (project,))
        result = {"removed": len(request["generations"])}
    else:
        raise Failure("unknown_command", "不支持的本地索引操作")
    db.close()
    result.update({"adapter": VERSION, "dimension": lock["dimension"], "identity": identity,
                   "elapsedMs": round((time.perf_counter()-started)*1000, 2), "rssMiB": round(psutil.Process().memory_info().rss/1024**2, 2)})
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Failure as error:
        print(json.dumps({"ok": False, "code": error.code, "message": error.message}, ensure_ascii=False), flush=True)
        sys.exit(2)
    except Exception:
        print(json.dumps({"ok": False, "code": "local_runtime_failure", "message": "本地模型或索引不可用，请检查路径、固定依赖和磁盘后重试"}, ensure_ascii=False), flush=True)
        sys.exit(3)
