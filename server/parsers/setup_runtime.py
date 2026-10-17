"""Explicit installation only. Runtime parsing never downloads anything.
Run with the Python interpreter of a dedicated virtual environment after pip
install -r requirements.txt. Downloads one PUBLIC, pinned tokenizer artifact.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request


def main():
    cli=argparse.ArgumentParser()
    cli.add_argument('--assets',type=Path,required=True)
    args=cli.parse_args()
    lock=json.loads((Path(__file__).parent/'runtime-lock.json').read_text(encoding='utf-8'))
    target=args.assets/'tokenizer.json'
    args.assets.mkdir(parents=True,exist_ok=True)
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==lock['vocabularyDigest']:
        print('Pinned tokenizer already verified');return
    url=f"https://huggingface.co/{lock['vocabularyRepository']}/resolve/{lock['vocabularyRevision']}/tokenizer.json"
    with urllib.request.urlopen(url,timeout=90) as response:
        data=response.read(24*1024**2+1)
    if len(data)>24*1024**2 or hashlib.sha256(data).hexdigest()!=lock['vocabularyDigest']:
        raise RuntimeError('Public tokenizer integrity check failed')
    target.write_bytes(data)
    print('Public pinned tokenizer installed; no business data transmitted')


if __name__=='__main__':main()
