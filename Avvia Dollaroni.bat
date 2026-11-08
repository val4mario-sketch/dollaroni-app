@echo off
rem Starts Dollaroni locally and opens it in the browser. Close this window to shut it down.
cd /d "%~dp0"
python tools\devserver.py 8765 --open
if errorlevel 1 (
  echo.
  echo Python must be installed: https://www.python.org/downloads/
  pause
)
