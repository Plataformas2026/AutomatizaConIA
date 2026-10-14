# Registra en Windows el enlace «automatiza-outlook://» para que el botón «Abrir en Outlook» de la web
# abra el correo en tu Outlook CLÁSICO. Se hace UNA sola vez. No hace falta ser administrador:
# solo escribe en tu usuario (HKEY_CURRENT_USER).
# Uso: clic derecho sobre el archivo → «Ejecutar con PowerShell».
$ErrorActionPreference = 'Stop'
$dir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $dir '.venv\Scripts\pythonw.exe'
$script = Join-Path $dir 'abrir_outlook.py'

if (-not (Test-Path $python)) { throw "No se encuentra $python. Crea primero el entorno de Python (paso 3 del README)." }
if (-not (Test-Path $script)) { throw "No se encuentra $script." }

$raiz = 'HKCU:\Software\Classes\automatiza-outlook'
New-Item -Path $raiz -Force | Out-Null
Set-ItemProperty -Path $raiz -Name '(default)' -Value 'URL:Automatizacion con IA - Outlook clasico'
New-ItemProperty -Path $raiz -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path "$raiz\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$raiz\shell\open\command" -Name '(default)' -Value ('"{0}" "{1}" "%1"' -f $python, $script)

Write-Host ''
Write-Host 'Listo: el botón «Abrir en Outlook» de la web ya abre tu Outlook clásico.' -ForegroundColor Green
Write-Host 'La primera vez, el navegador te preguntará si permite abrir la aplicación: marca «Permitir siempre».'
Write-Host 'Para quitarlo:  Remove-Item -Recurse "HKCU:\Software\Classes\automatiza-outlook"'
Read-Host 'Pulsa Intro para cerrar'
