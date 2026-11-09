@echo off
rem Avaliacao da ferramenta (secao 3.3 do TC, Tabelas 10 a 14). Leva cerca de 30 minutos.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0avaliar.ps1" %*
