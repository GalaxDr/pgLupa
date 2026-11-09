@echo off
rem Refaz o pgBadger e os relatorios dos cenarios 1 e 2 a partir dos ultimos logs gerados
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0avaliar.ps1" -ApenasRelatorios
