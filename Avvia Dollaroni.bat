@echo off
rem Avvia Dollaroni in locale e lo apre nel browser. Chiudi questa finestra per spegnerlo.
cd /d "%~dp0"
python tools\devserver.py 8765 --open
if errorlevel 1 (
  echo.
  echo Serve Python installato: https://www.python.org/downloads/
  pause
)
