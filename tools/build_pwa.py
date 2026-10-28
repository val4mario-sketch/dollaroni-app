"""Prepara il sito da pubblicare (GitHub Pages) in una cartella: python tools/build_pwa.py _site

- copia solo i file che servono all'app (niente out/, note interne, strumenti);
- version.json (versione e note) viaggia con il sito: è quello che l'app confronta per gli aggiornamenti;
- scrive in sw.js la versione (impronta dei file) e l'elenco dei file da tenere offline.

Ogni modifica a un file cambia la versione: chi ha l'app aperta o installata vede
"È disponibile una nuova versione" e aggiorna con un clic. Lo usa il workflow
.github/workflows/pages.yml a ogni push; in locale serve per provare l'app installabile:
    python tools/build_pwa.py out/site
    python tools/devserver.py 8766 --root=out/site   ->  http://127.0.0.1:8766/?pwa
"""
import datetime
import hashlib
import json
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
INCLUDE = ["index.html", "manifest.webmanifest", "sw.js", "version.json", "dollaroni.config.json", "styles", "src", "vendor", "data", "icons", "tests"]
NOT_OFFLINE = ("tests/", "vendor/wllama-")  # pubblicati ma non scaricati in anticipo (il motore IA si scarica al primo uso)
SKIP_SUFFIX = (".dollaroni.json",)  # file progetto del team: mai nel sito


def files():
    for name in INCLUDE:
        p = ROOT / name
        if p.is_file():
            yield p
        else:
            yield from sorted(x for x in p.rglob("*") if x.is_file() and "__pycache__" not in x.parts)


def main(out_dir):
    out = pathlib.Path(out_dir)
    if not out.is_absolute():
        out = ROOT / out
    if out.exists():
        shutil.rmtree(out)
    digest = hashlib.sha256()
    precache = ["./"]
    for src in files():
        rel = src.relative_to(ROOT).as_posix()
        if rel.endswith(SKIP_SUFFIX):
            continue
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        digest.update(rel.encode())
        digest.update(src.read_bytes())
        if rel != "sw.js" and not rel.startswith(NOT_OFFLINE):
            precache.append(rel)

    app_version = json.loads((ROOT / "version.json").read_text(encoding="utf-8")).get("version", "0")
    version = f"{app_version}-{datetime.date.today():%Y%m%d}-{digest.hexdigest()[:10]}"
    sw = out / "sw.js"
    text = sw.read_text(encoding="utf-8")
    text, n1 = re.subn(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", text, count=1)
    items = ",\n  ".join(f"'{p}'" for p in precache)
    text, n2 = re.subn(r"const PRECACHE = \[\];", f"const PRECACHE = [\n  {items},\n];", text, count=1)
    if n1 != 1 or n2 != 1:
        sys.exit("sw.js: non trovo VERSION o PRECACHE da riscrivere")
    sw.write_text(text, encoding="utf-8")
    print(f"Sito pronto in {out} - versione {version} - {len(precache)} file offline")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_site")
