@echo off
rem Publica o site na VPS (veja publicar.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publicar.ps1" %*
