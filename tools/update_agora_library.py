"""Downloads the SuMoth Agora library (prices and resin fractions for the 2027 rules) into data/official/.

Usage:  python tools/update_agora_library.py
Prints the new version and the values that changed; then run the tests (some 2027 totals may change).
"""
import json
import pathlib
import urllib.request

URL = 'https://agora.sumoth.org/library.json'
DEST = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'official' / '2027_SuMoth_Agora_library.json'


def flat(x, path=''):
    if isinstance(x, dict):
        for k, v in x.items():
            yield from flat(v, f'{path}/{k}')
    else:
        yield path, x


def main():
    req = urllib.request.Request(URL, headers={'User-Agent': 'Dollaroni'})
    raw = urllib.request.urlopen(req, timeout=30).read()
    new = json.loads(raw)
    if new.get('app') != 'sumoth-agora' or new.get('kind') != 'library' or 'fibers' not in new.get('lib', {}):
        raise SystemExit('Unexpected file: it is not the SuMoth Agora library')
    old = json.loads(DEST.read_text(encoding='utf-8')) if DEST.exists() else {'lib': {}}
    a, b = dict(flat(old['lib'])), dict(flat(new['lib']))
    changes = [f'  {k}: {a.get(k, "-")} -> {b.get(k, "-")}' for k in sorted(a.keys() | b.keys()) if a.get(k) != b.get(k)]
    DEST.write_bytes(raw)
    print(f"Agora library {old.get('version', '-')} -> {new['version']} ({new.get('updated', '')})")
    print('\n'.join(changes) if changes else '  no value changed')


if __name__ == '__main__':
    main()
