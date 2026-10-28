"""Server locale di Dollaroni (lo avvia "Avvia Dollaroni.bat").

Serve i file dell'app su http://127.0.0.1:<porta>/ e in più:
- accetta PUT verso /out/... per salvare su disco i file generati dai test;
- manda gli header COOP/COEP, così l'IA locale può usare tutti i core del processore;
- GET  /__dollaroni/info    versione installata e repository GitHub da cui aggiornarsi;
- POST /__dollaroni/update  scarica l'ultima versione da GitHub e sostituisce i file dell'app
                            (copia di sicurezza in out/backup-...; i file progetto non si toccano).
                            Se la cartella è un clone git fa "git pull --ff-only".

Uso:  python tools/devserver.py [porta] [--open] [--root=cartella] [--no-isolation]
      --open apre anche il browser (usato da "Avvia Dollaroni.bat")
      --root serve un'altra cartella, es. il sito preparato da tools/build_pwa.py
      --no-isolation non manda gli header COOP/COEP (l'IA locale userà un solo core)
"""
import datetime
import http.server
import io
import json
import pathlib
import shutil
import socket
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
import zipfile

APP = pathlib.Path(__file__).resolve().parent.parent
_root = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--root=")), None)
ROOT = (APP / _root).resolve() if _root else APP
OUT = APP / "out"
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(ARGS[0]) if ARGS else 8765
OPEN = "--open" in sys.argv
ISOLATION = "--no-isolation" not in sys.argv

# Durante un aggiornamento questi percorsi non si sovrascrivono mai:
# file generati, progetti del team, il .bat (Windows lo rilegge mentre gira) e la cartella git.
KEEP = ("out/", ".git/", "_site/")
KEEP_SUFFIX = (".dollaroni.json",)
KEEP_FILES = ("Avvia Dollaroni.bat",)


def read_json(path, default=None):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def git(*args, timeout=60):
    return subprocess.run(["git", "-C", str(APP), *args], capture_output=True, text=True, timeout=timeout)


def is_git_clone():
    return (APP / ".git").exists() and shutil.which("git") is not None


def update_config():
    return (read_json(APP / "dollaroni.config.json", {}) or {}).get("updates", {}) or {}


def repository():
    """owner/nome del repository: da dollaroni.config.json, altrimenti dal remote git."""
    cfg = update_config()
    repo = (cfg.get("repository") or "").strip().strip("/")
    branch = (cfg.get("branch") or "main").strip()
    if not repo and is_git_clone():
        try:
            url = git("config", "--get", "remote.origin.url", timeout=10).stdout.strip()
            if "github.com" in url:
                repo = url.split("github.com", 1)[1].lstrip(":/").removesuffix(".git")
        except (OSError, subprocess.SubprocessError):
            pass
    return repo, branch


def info():
    v = read_json(APP / "version.json", {}) or {}
    repo, branch = repository()
    cfg = update_config()
    return {
        "app": "dollaroni", "version": v.get("version"), "date": v.get("date"),
        "repository": repo or None, "branch": branch,
        # facoltativi, per aggiornarsi da un indirizzo diverso da GitHub
        "versionUrl": cfg.get("versionUrl") or None,
        "mode": "git" if is_git_clone() else "zip", "canUpdate": bool(repo or (cfg.get("versionUrl") and cfg.get("zipUrl"))),
    }


def update_from_github():
    """Porta l'app all'ultima versione del branch su GitHub. Ritorna un dict per il browser."""
    before = (read_json(APP / "version.json", {}) or {}).get("version")
    repo, branch = repository()
    zip_url = update_config().get("zipUrl")
    if not repo and not zip_url:
        return {"ok": False, "error": "Repository GitHub non configurato (dollaroni.config.json)."}

    if is_git_clone() and not zip_url:
        r = git("pull", "--ff-only", "origin", branch, timeout=120)
        if r.returncode != 0:
            return {"ok": False, "error": "git pull non riuscito: " + (r.stderr or r.stdout).strip()[-400:]}
        after = (read_json(APP / "version.json", {}) or {}).get("version")
        changed = git("diff", "--name-only", "HEAD@{1}", "HEAD", timeout=30).stdout.split()
        return {"ok": True, "from": before, "to": after, "mode": "git", "written": len(changed),
                "restartNeeded": "tools/devserver.py" in changed}

    url = zip_url or f"https://codeload.github.com/{repo}/zip/refs/heads/{branch}"
    try:
        with urllib.request.urlopen(url, timeout=90) as resp:
            data = resp.read()
    except OSError as e:
        return {"ok": False, "error": f"Download da GitHub non riuscito: {e}"}

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = OUT / f"backup-{before or 'vecchia'}-{stamp}"
    written = 0
    restart = False
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        prefix = names[0].split("/", 1)[0] + "/" if names else ""
        if not any(n == prefix + "version.json" for n in names):
            return {"ok": False, "error": "Lo zip scaricato non sembra Dollaroni (manca version.json)."}
        for name in names:
            rel = name[len(prefix):]
            if not rel or rel.startswith(KEEP) or rel.endswith(KEEP_SUFFIX) or rel in KEEP_FILES:
                continue
            target = (APP / rel).resolve()
            if APP not in target.parents:
                continue  # percorso strano nello zip: si ignora
            content = z.read(name)
            if target.exists():
                if target.read_bytes() == content:
                    continue
                dest = backup / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, dest)
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + ".tmp-update")
            tmp.write_bytes(content)
            tmp.replace(target)
            written += 1
            restart = restart or rel == "tools/devserver.py"
    after = (read_json(APP / "version.json", {}) or {}).get("version")
    return {"ok": True, "from": before, "to": after, "mode": "zip", "written": written,
            "backup": str(backup.relative_to(APP)) if backup.exists() else None, "restartNeeded": restart}


class Handler(http.server.SimpleHTTPRequestHandler):
    # Su Windows il registro può mappare .js su text/plain: i moduli ES non partirebbero.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".wasm": "application/wasm",
        ".gguf": "application/octet-stream",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        # "Cross-origin isolation": permette all'IA locale di usare tutti i core del processore
        # (SharedArrayBuffer). L'app non carica risorse da altri siti, quindi non rompe niente.
        if ISOLATION:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def same_origin(self):
        # solo la pagina di Dollaroni può chiedere l'aggiornamento: un sito esterno non può mandare
        # l'header personalizzato senza un preflight CORS, che questo server non approva
        origin = self.headers.get("Origin", "")
        ok_origin = origin in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}")
        return ok_origin and self.headers.get("X-Dollaroni") == "update"

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/__dollaroni/info":
            self.send_json(info())
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/__dollaroni/update":
            self.send_error(404)
            return
        if not self.same_origin():
            self.send_error(403, "Richiesta non ammessa")
            return
        try:
            self.send_json(update_from_github())
        except Exception as e:  # noqa: BLE001 - si riporta l'errore al browser
            self.send_json({"ok": False, "error": f"Aggiornamento non riuscito: {e}"}, 500)

    def do_PUT(self):
        rel = urllib.parse.unquote(self.path.split("?", 1)[0]).lstrip("/")
        target = (APP / rel).resolve()
        if OUT.resolve() not in target.parents:
            self.send_error(403, "Si può scrivere solo dentro out/")
            return
        length = int(self.headers.get("Content-Length", 0))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(self.rfile.read(length))
        self.send_response(201)
        self.end_headers()


class Server(http.server.ThreadingHTTPServer):
    # Su Windows SO_REUSEADDR (attivo di default in http.server) permette a due server di
    # prendersi la stessa porta: lo disattiviamo e chiediamo l'uso esclusivo.
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    url = f"http://127.0.0.1:{PORT}/"
    try:
        httpd = Server(("127.0.0.1", PORT), Handler)
    except OSError:
        # porta già occupata: probabilmente Dollaroni è già acceso, basta aprire il browser
        print(f"La porta {PORT} è già in uso: apro {url}", flush=True)
        if OPEN:
            webbrowser.open(url)
        sys.exit(0)
    with httpd:
        v = info().get("version") or "?"
        print(f"Dollaroni {v}: {url}  (chiudi questa finestra per spegnerlo)", flush=True)
        if OPEN:
            threading.Timer(0.6, webbrowser.open, args=[url]).start()
        httpd.serve_forever()
