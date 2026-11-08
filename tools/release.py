"""Prepares a new version: python tools/release.py 0.6.0 "First change" "Second change"

Updates version.json (version, date, notes) and adds the section at the top of CHANGELOG.md.
Then just commit and push to main: GitHub Pages publishes and app users see
"Version 0.6.0 is available" with these notes.
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
        sys.exit("The version must look like 0.6.0")
    if not notes:
        sys.exit('Write at least one note, e.g.: python tools/release.py 0.6.0 "New S3 export"')
    vfile = ROOT / "version.json"
    old = json.loads(vfile.read_text(encoding="utf-8"))
    if parse(version) <= parse(old["version"]):
        sys.exit(f"The new version must be greater than {old['version']}")
    today = datetime.date.today()
    vfile.write_text(json.dumps({"version": version, "date": today.isoformat(), "notes": notes}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cl = ROOT / "CHANGELOG.md"
    text = cl.read_text(encoding="utf-8")
    section = f"## {version} – {today:%d/%m/%Y}\n" + "".join(f"- {n}\n" for n in notes) + "\n"
    i = text.find("\n## ")
    text = text[: i + 1] + section + text[i + 1:] if i >= 0 else text + "\n" + section
    cl.write_text(text, encoding="utf-8")
    print(f"Version {version} ready: now commit and push to main.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "", sys.argv[2:])
