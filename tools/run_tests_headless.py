"""Runs the browser tests without opening windows: python tools/run_tests_headless.py

Starts the local server on a free port, opens tests/ with headless Chrome or Edge (no window)
and reads the result the test page saves in out/test-results.json.
Exits with code 1 if a test fails: GitHub also uses it (.github/workflows/pages.yml) before publishing,
so a broken version does not reach the team.

The browser can be set with the CHROME variable (path of the executable).
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
    sys.exit("Cannot find Chrome or Edge: set the path with the CHROME variable")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_results(result_file, chrome, limit=180):
    """Waits for out/test-results.json; False if Chrome closes before opening the page."""
    print("Tests running (usually under a minute, at most 3)", end="", flush=True)
    start = time.time()
    while time.time() - start < limit and not result_file.exists():
        time.sleep(0.5)
        if chrome is not None and chrome.poll() is not None and not result_file.exists():
            print(f" Chrome closed by itself (code {chrome.returncode})", flush=True)
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
    print(f"Starting the test server on port {port}…", flush=True)
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
            sys.exit("The test server does not respond: see out/test-server.log")
        print("Server ready.", flush=True)
        url = f"http://127.0.0.1:{port}/tests/"
        # 1) Chrome without a window (two ways of starting it); 2) if it does not start on this PC, a normal browser tab
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
            print("Chrome without a window does not start on this PC: opening the tests in a browser tab.", flush=True)
            webbrowser.open(url)
            wait_results(result_file, None)
    finally:
        if chrome and chrome.poll() is None:
            chrome.kill()
        server.terminate()
        server_log.close()
        chrome_log.close()
    if not result_file.exists():
        sys.exit("The tests did not respond within 3 minutes. Details in out/test-chrome.log and out/test-server.log.")
    res = json.loads(result_file.read_text(encoding="utf-8"))
    print(f"{res['passed']}/{res['total']} tests passed")
    for f in res["failed"]:
        print(f"  ✗ {f['suite']} – {f['name']}\n      {f['error']}")
    if res["passed"] != res["total"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
