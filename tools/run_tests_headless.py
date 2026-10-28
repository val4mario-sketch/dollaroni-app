"""Esegue i test del browser senza aprire finestre: python tools/run_tests_headless.py

Avvia il server locale su una porta libera, apre tests/ con Chrome o Edge "headless" (senza finestra)
e legge il risultato che la pagina dei test salva in out/test-results.json.
Esce con codice 1 se qualche test fallisce: lo usa anche GitHub (.github/workflows/pages.yml) prima di pubblicare,
così una versione rotta non arriva al team.

Si può indicare il browser con la variabile CHROME (percorso dell'eseguibile).
"""
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent.parent

CANDIDATES = [
    os.environ.get("CHROME"),
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_browser():
    for c in CANDIDATES:
        if not c:
            continue
        p = shutil.which(c) or (c if os.path.exists(c) else None)
        if p:
            return p
    sys.exit("Non trovo Chrome o Edge: indica il percorso con la variabile CHROME")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_results(result_file, chrome, limit=180):
    """Aspetta out/test-results.json; False se Chrome si chiude prima di aver aperto la pagina."""
    print("Test in corso (di solito meno di un minuto, al massimo 3)", end="", flush=True)
    start = time.time()
    while time.time() - start < limit and not result_file.exists():
        time.sleep(0.5)
        if chrome is not None and chrome.poll() is not None and not result_file.exists():
            print(f" Chrome si è chiuso da solo (codice {chrome.returncode})", flush=True)
            return False
        if int((time.time() - start) * 2) % 10 == 0:
            print(".", end="", flush=True)
    print(f" {time.time() - start:.0f} s", flush=True)
    time.sleep(0.3)
    return result_file.exists()


def stop(chrome):
    if chrome.poll() is None:
        chrome.terminate()
        try:
            chrome.wait(10)
        except subprocess.TimeoutExpired:
            chrome.kill()


def main():
    browser = find_browser()
    port = free_port()
    print(f"Browser: {browser}", flush=True)
    print(f"Avvio il server di prova sulla porta {port}…", flush=True)
    result_file = ROOT / "out" / "test-results.json"
    result_file.unlink(missing_ok=True)
    (ROOT / "out").mkdir(exist_ok=True)
    server_log = open(ROOT / "out" / "test-server.log", "w", encoding="utf-8")
    chrome_log = open(ROOT / "out" / "test-chrome.log", "w", encoding="utf-8")
    server = subprocess.Popen([sys.executable, str(ROOT / "tools" / "devserver.py"), str(port)], cwd=ROOT,
                              stdout=server_log, stderr=subprocess.STDOUT)
    chrome = None
    try:
        up = False
        for _ in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/tests/index.html", timeout=2).read()
                up = True
                break
            except OSError:
                time.sleep(0.1)
        if not up:
            sys.exit("Il server di prova non risponde: vedi out/test-server.log")
        print("Server pronto.", flush=True)
        url = f"http://127.0.0.1:{port}/tests/"
        # 1) Chrome senza finestra (due modi di avviarlo); 2) se su questo PC non parte, una scheda del browser normale
        attempts = [["--headless=new"], ["--headless=new", "--remote-debugging-port=0", "--disable-extensions"]]
        for extra in attempts:
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile:
                cmd = [browser, *extra, "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                       f"--user-data-dir={profile}", url]
                if hasattr(os, "geteuid") and os.geteuid() == 0:
                    cmd.insert(1, "--no-sandbox")
                chrome_log.write(f"\n$ {' '.join(cmd)}\n")
                chrome_log.flush()
                chrome = subprocess.Popen(cmd, stdout=chrome_log, stderr=subprocess.STDOUT)
                ok = wait_results(result_file, chrome)
                stop(chrome)
                chrome = None
            if ok or result_file.exists():
                break
        if not result_file.exists():
            print("Chrome senza finestra non parte su questo PC: apro i test in una scheda del browser.", flush=True)
            webbrowser.open(url)
            wait_results(result_file, None)
    finally:
        if chrome and chrome.poll() is None:
            chrome.kill()
        server.terminate()
        server_log.close()
        chrome_log.close()
    if not result_file.exists():
        sys.exit("I test non hanno risposto entro 3 minuti. Dettagli in out/test-chrome.log e out/test-server.log.")
    res = json.loads(result_file.read_text(encoding="utf-8"))
    print(f"{res['passed']}/{res['total']} test superati")
    for f in res["failed"]:
        print(f"  ✗ {f['suite']} – {f['name']}\n      {f['error']}")
    if res["passed"] != res["total"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
