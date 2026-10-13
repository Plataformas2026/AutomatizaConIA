@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo No se encuentra el entorno de Python. Sigue el paso 3 de README.md.
  pause
  exit /b 1
)
echo Agente en marcha. Cierra esta ventana (o pulsa Ctrl+C) para detenerlo.
".venv\Scripts\python.exe" agent.py -v
pause
