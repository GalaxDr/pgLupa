@echo off
rem Prepara e inicia a ferramenta (veja iniciar.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar.ps1" %*
