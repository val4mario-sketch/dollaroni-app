"""Prepara una nuova versione: python tools/release.py 0.6.0 "Prima novità" "Seconda novità"

Aggiorna version.json (versione, data, note) e aggiunge la sezione in cima a CHANGELOG.md.
Poi basta fare commit e push su main: GitHub Pages pubblica e chi usa l'app vede
"È disponibile la versione 0.6.0" con queste note.
"""
import datetime
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def parse(v):
    return tuple(int(x) for x in v.split("."))


def main(version, notes):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        sys.exit("La versione deve essere tipo 0.6.0")
    if not notes:
        sys.exit('Scrivi almeno una nota, es.: python tools/release.py 0.6.0 "Nuovo export S3"')
    vfile = ROOT / "version.json"
    old = json.loads(vfile.read_text(encoding="utf-8"))
    if parse(version) <= parse(old["version"]):
        sys.exit(f"La versione nuova deve essere maggiore di {old['version']}")
    today = datetime.date.today()
    vfile.write_text(json.dumps({"version": version, "date": today.isoformat(), "notes": notes}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cl = ROOT / "CHANGELOG.md"
    text = cl.read_text(encoding="utf-8")
    section = f"## {version} – {today:%d/%m/%Y}\n" + "".join(f"- {n}\n" for n in notes) + "\n"
    i = text.find("\n## ")
    text = text[: i + 1] + section + text[i + 1:] if i >= 0 else text + "\n" + section
    cl.write_text(text, encoding="utf-8")
    print(f"Versione {version} pronta: ora commit e push su main.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "", sys.argv[2:])
