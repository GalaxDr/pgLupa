@echo off
rem Gera consultas lentas de exemplo no servidor monitorado por 120 segundos
title Carga de exemplo
cd /d "%~dp0"
call npm run carga -- 120 > logs\carga.log 2>&1
type logs\carga.log
pause
