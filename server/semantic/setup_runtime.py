"""Explicit public model installation only; the serving adapter never downloads."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--model-dir',required=True)
    parser.add_argument('--reranker-dir')
    args=parser.parse_args()
    lock=json.loads(Path(__file__).with_name('model.json').read_text('utf-8'))
    root=Path(args.model_dir).resolve()
    for name, expected in lock['files'].items():
        target=root/name
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==expected:
            continue
        url='https://huggingface.co/'+lock['model']+'/resolve/'+lock['revision']+'/'+name
        with urllib.request.urlopen(url,timeout=90) as response:
            data=response.read(150*1024**2)
        if hashlib.sha256(data).hexdigest()!=expected:
            raise RuntimeError('Public model checksum mismatch: '+name)
        temporary=target.with_name(target.name+'.partial')
        temporary.write_bytes(data)
        temporary.replace(target)
    if args.reranker_dir:
        import subprocess,sys
        # Explicit installation only: same pinned-download verifier, no business text.
        rerank=json.loads(Path(__file__).with_name('reranker.json').read_text('utf-8'))
        target_root=Path(args.reranker_dir).resolve()
        for artifact in rerank['files']:
            name,expected=artifact['name'],artifact['sha256']
            target=target_root/name; target.parent.mkdir(parents=True,exist_ok=True)
            if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==expected: continue
            url='https://huggingface.co/'+rerank['model']+'/resolve/'+rerank['revision']+'/'+name
            with urllib.request.urlopen(url,timeout=90) as response: data=response.read(150*1024**2)
            if hashlib.sha256(data).hexdigest()!=expected: raise RuntimeError('Reranker checksum mismatch: '+name)
            temporary=target.with_name(target.name+'.partial'); temporary.write_bytes(data); temporary.replace(target)
    print('Public pinned model installed and SHA-256 verified; no business documents transmitted.')
