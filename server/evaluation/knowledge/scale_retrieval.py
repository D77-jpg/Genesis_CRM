"""B2 scale probe: persistent lexical + sqlite-vec retrieval, fictional data only.

This is an engineering latency probe, not a relevance/quality benchmark. It
builds an isolated SQLite index with ten thousand synthetic fragments, then
measures warm retrieval with two concurrent worker processes. The production
authorization join (`allowed`) is still applied for every query; no Mongo or
mail/LLM credentials are used.
"""
import argparse
import hashlib
import json
import math
import multiprocessing as mp
import os
from pathlib import Path
import sqlite3
import sys
import time
from collections import Counter

import numpy as np
import psutil

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "semantic"))
from retrieval import retrieve, tokens  # noqa: E402


def digest(value):
    return hashlib.sha256(value).hexdigest()


def make_corpus(count):
    """Small English fictional records; repeated vocabulary makes BM25 realistic."""
    products = ["velvet pouch", "cotton bag", "satin box", "nylon wallet", "drawstring bag"]
    materials = ["velvet", "cotton", "satin", "nylon", "canvas"]
    colors = ["black", "navy", "ivory", "sage", "burgundy"]
    rows = []
    for i in range(count):
        product = products[i % len(products)]
        material = materials[(i // 3) % len(materials)]
        color = colors[(i // 7) % len(colors)]
        text = (
            f"Fictional catalog item {i:05d}. {material} {product} in {color}. "
            f"Custom logo, sample lead time and packaging options are confirmed by the supplier. "
            f"Reference window {i:05d} is for local scale testing only."
        )
        rows.append({"id": f"item-{i:05d}", "parent": f"doc-{i:05d}", "text": text})
    return rows


def build_database(path, rows, identity, dimension):
    import sqlite_vec

    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.enable_load_extension(True)
    sqlite_vec.load(db)
    db.enable_load_extension(False)
    db.executescript("""
    CREATE TABLE texts(project TEXT,generation TEXT,item TEXT,text TEXT,parent TEXT,PRIMARY KEY(project,generation,item));
    CREATE TABLE vectors(project TEXT,generation TEXT,item TEXT,model TEXT,hash TEXT,vector BLOB,PRIMARY KEY(project,generation,item));
    CREATE TABLE lexical(project TEXT,generation TEXT,item TEXT,parent TEXT,scope TEXT,hash TEXT,length INTEGER,text TEXT,terms TEXT,PRIMARY KEY(project,generation,item));
    CREATE TABLE lexical_terms(project TEXT,generation TEXT,item TEXT,term TEXT,tf INTEGER,PRIMARY KEY(project,generation,item,term));
    CREATE INDEX lexical_terms_lookup ON lexical_terms(project,generation,term);
    """)
    rng = np.random.default_rng(42)
    vectors = rng.normal(size=(len(rows), dimension)).astype(np.float32)
    vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
    for offset in range(0, len(rows), 100):
        batch = rows[offset:offset + 100]
        text_rows = []
        vector_rows = []
        lexical_rows = []
        term_rows = []
        for j, row in enumerate(batch):
            text_hash = digest(row["text"].encode())
            token_list = tokens(row["text"])
            counts = Counter(token_list)
            index = offset + j
            text_rows.append(("scale", "g1", row["id"], row["text"], row["parent"]))
            vector_rows.append(("scale", "g1", row["id"], identity, text_hash, vectors[index].tobytes()))
            lexical_rows.append(("scale", "g1", row["id"], row["parent"], "project", text_hash, len(token_list), row["text"], " ".join(token_list)))
            term_rows.extend(("scale", "g1", row["id"], term, count) for term, count in counts.items())
        db.executemany("INSERT INTO texts VALUES(?,?,?,?,?)", text_rows)
        db.executemany("INSERT INTO vectors VALUES(?,?,?,?,?,?)", vector_rows)
        db.executemany("INSERT INTO lexical VALUES(?,?,?,?,?,?,?,?,?)", lexical_rows)
        db.executemany("INSERT INTO lexical_terms VALUES(?,?,?,?,?)", term_rows)
        db.commit()
    checksum = digest(json.dumps([[r["id"], digest(r["text"].encode())] for r in sorted(rows, key=lambda r: r["id"])], separators=(",", ":")).encode())
    db.close()
    return checksum


def worker(args):
    db_path, model_dir, reranker_dir, identity, dimension, mode, queries, checksum, warmup, fragments = args
    os.environ["KNOWLEDGE_MODEL_DIR"] = model_dir
    if reranker_dir:
        os.environ["KNOWLEDGE_RERANKER_DIR"] = reranker_dir
    import sqlite_vec
    from tokenizers import Tokenizer
    import onnxruntime as ort

    db = sqlite3.connect(db_path, timeout=30)
    db.execute("PRAGMA busy_timeout=30000")
    db.enable_load_extension(True)
    sqlite_vec.load(db)
    db.enable_load_extension(False)
    db.execute("CREATE TEMP TABLE IF NOT EXISTS allowed(item TEXT PRIMARY KEY)")
    db.execute("DELETE FROM allowed")
    db.executemany("INSERT INTO allowed VALUES(?)", [(f"item-{i:05d}",) for i in range(fragments)])
    tokenizer = Tokenizer.from_file(str(Path(model_dir) / "tokenizer.json"))
    tokenizer.no_padding()
    tokenizer.no_truncation()

    # A fixed local query vector is enough to exercise the exact sqlite-vec
    # branch; relevance is covered by the separate S3 evaluation.
    query_vector = np.ones(dimension, dtype=np.float32)
    query_vector /= np.linalg.norm(query_vector)

    def embed(texts):
        return [query_vector for _ in texts]

    ort_options = ort.SessionOptions()
    ort_options.intra_op_num_threads = 4
    ort_options.inter_op_num_threads = 1
    ort_options.enable_mem_pattern = False
    ort_options.log_severity_level = 3

    request = {
        "projectId": "scale",
        "generation": "g1",
        "identity": identity,
        "allowed": [f"item-{i:05d}" for i in range(fragments)],
        "mode": mode,
        "expectedCount": fragments,
        "expectedChecksum": checksum,
        "diagnostics": [],
    }
    latencies = []
    errors = 0
    degraded = 0
    started = time.perf_counter()
    cpu_started = sum(psutil.Process().cpu_times()[:2])
    for q in queries[:warmup]:
        try:
            result = retrieve(db, {**request, "query": q}, tokenizer, embed, ort_options, RuntimeError)
            degraded += int(bool(result["trace"].get("degraded")))
        except Exception:
            errors += 1
    for q in queries[warmup:]:
        now = time.perf_counter()
        try:
            result = retrieve(db, {**request, "query": q}, tokenizer, embed, ort_options, RuntimeError)
            degraded += int(bool(result["trace"].get("degraded")))
        except Exception:
            errors += 1
        latencies.append((time.perf_counter() - now) * 1000)
    elapsed = time.perf_counter() - started
    cpu_seconds = sum(psutil.Process().cpu_times()[:2]) - cpu_started
    rss_mib = psutil.Process().memory_info().rss / 1024**2
    db.close()
    return {"latenciesMs": latencies, "errors": errors, "degraded": degraded, "elapsedSeconds": elapsed, "cpuSeconds": cpu_seconds, "rssMiB": rss_mib}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fragments", type=int, default=10000)
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--queries", type=int, default=20, help="timed queries per worker")
    parser.add_argument("--warmup", type=int, default=3)
    parser.add_argument("--mode", default="hybrid_rerank", choices=["bm25", "vector", "hybrid", "hybrid_rerank"])
    parser.add_argument("--output", type=Path, default=ROOT.parent / "docs" / "knowledge-b1-b2-results" / "scale-retrieval.json")
    args = parser.parse_args()
    model_dir = os.environ.get("KNOWLEDGE_MODEL_DIR")
    reranker_dir = os.environ.get("KNOWLEDGE_RERANKER_DIR", "")
    if not model_dir:
        raise SystemExit("KNOWLEDGE_MODEL_DIR is required")
    if args.mode == "hybrid_rerank" and not reranker_dir:
        raise SystemExit("KNOWLEDGE_RERANKER_DIR is required for hybrid_rerank")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    work = args.output.parent / "scale-index.sqlite3"
    work.unlink(missing_ok=True)
    rows = make_corpus(args.fragments)
    identity = "scale-fixture-identity"
    dimension = 384
    started = time.perf_counter()
    checksum = build_database(work, rows, identity, dimension)
    build_seconds = time.perf_counter() - started
    queries = [
        "velvet jewelry pouch with custom logo and sample lead time",
        "cotton drawstring bag packaging options",
        "satin gift box in navy color",
        "nylon travel wallet with supplier confirmation",
        "canvas pouch sample and delivery",
        "fictional catalog item with velvet material",
    ]
    # Repeat the controlled query families so P95 is based on a useful sample
    # rather than only one or two warm requests.
    queries = [f"{queries[i % len(queries)]} variant {i}" for i in range(args.queries + args.warmup)]
    workers = min(max(args.concurrency, 1), 4)
    with mp.Pool(workers) as pool:
        results = pool.map(worker, [(str(work), model_dir, reranker_dir, identity, dimension, args.mode, queries, checksum, args.warmup, args.fragments) for _ in range(workers)])
    values = sorted(x for result in results for x in result["latenciesMs"])
    p50 = float(np.percentile(values, 50)) if values else None
    p95 = float(np.percentile(values, 95)) if values else None
    p99 = float(np.percentile(values, 99)) if values else None
    report = {
        "schemaVersion": 1,
        "scope": "B2 engineering scale probe; synthetic fictional fragments; no quality claim, no live CRM, no customer data",
        "mode": args.mode,
        "fragments": args.fragments,
        "concurrency": workers,
        "timedQueriesPerWorker": args.queries,
        "warmupPerWorker": args.warmup,
        "model": {
            "embedding": json.loads((ROOT / "semantic" / "model.json").read_text(encoding="utf-8")).get("model"),
            "reranker": json.loads((ROOT / "semantic" / "reranker.json").read_text(encoding="utf-8")).get("model") if reranker_dir else None,
        },
        "buildSeconds": round(build_seconds, 2),
        "indexBytes": work.stat().st_size,
        "sqliteVersion": sqlite3.sqlite_version,
        "python": sys.version,
        "checksum": checksum,
        "latencyMs": {"p50": round(p50, 2) if p50 is not None else None, "p95": round(p95, 2) if p95 is not None else None, "p99": round(p99, 2) if p99 is not None else None, "max": round(max(values), 2) if values else None},
        "workers": results,
        "totalErrors": sum(result["errors"] for result in results),
        "totalDegraded": sum(result["degraded"] for result in results),
        "workerRssMiB": {"max": round(max((result["rssMiB"] for result in results), default=0), 2)},
        "workerCpuSeconds": {"max": round(max((result["cpuSeconds"] for result in results), default=0), 2)},
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    report["pass"] = bool(p95 is not None and p95 <= 5000 and report["totalErrors"] == 0)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for suffix in ("", "-wal", "-shm"):
        Path(str(work) + suffix).unlink(missing_ok=True)
    print(json.dumps({"output": str(args.output), "p95Ms": report["latencyMs"]["p95"], "pass": report["pass"], "errors": report["totalErrors"]}))


if __name__ == "__main__":
    main()
