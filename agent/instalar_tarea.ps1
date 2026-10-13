# Crea la tarea programada de Windows que arranca el agente al iniciar sesión.
# Uso: clic derecho sobre el archivo → «Ejecutar con PowerShell».  No hace falta ser administrador.
$ErrorActionPreference = 'Stop'
$nombre = 'Automatizacion con IA - Agente'
$dir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $dir '.venv\Scripts\pythonw.exe'

if (-not (Test-Path $python)) {
    throw "No se encuentra $python. Crea primero el entorno de Python (paso 3 del README)."
}
if (-not (Test-Path (Join-Path $dir '.env'))) {
    throw "No se encuentra el archivo .env en $dir. Créalo primero (paso 4 del README)."
}

$accion  = New-ScheduledTaskAction -Execute $python -Argument 'agent.py' -WorkingDirectory $dir
$disparo = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$disparo.Delay = 'PT30S'   # espera 30 s tras iniciar sesión (a que haya red)
$ajustes = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew
$usuario = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparo -Settings $ajustes -Principal $usuario -Force | Out-Null
Start-ScheduledTask -TaskName $nombre

Write-Host ''
Write-Host "Listo: la tarea '$nombre' está creada y en marcha." -ForegroundColor Green
Write-Host 'En unos segundos la web mostrará el agente como «Conectado».'
Write-Host 'Para quitarla:  Unregister-ScheduledTask -TaskName "Automatizacion con IA - Agente" -Confirm:$false'
Read-Host 'Pulsa Intro para cerrar'
