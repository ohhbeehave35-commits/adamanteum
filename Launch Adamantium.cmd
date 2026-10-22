@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0Start-Adamantium.ps1"
if errorlevel 1 (
  echo Adamantium could not start. The error above explains what needs attention.
  pause
  exit /b 1
)
