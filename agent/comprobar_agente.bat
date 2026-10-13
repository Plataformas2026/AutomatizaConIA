@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo No se encuentra el entorno de Python. Sigue el paso 3 de README.md.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" agent.py --check
echo.
pause
