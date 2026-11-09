@echo off
chcp 65001 >nul
rem Casos de teste das recomendacoes do diagnostico (secao 5.6 do TC, Tabela 16). Leva cerca de 15 minutos.
cd /d "%~dp0.."
docker info >nul 2>&1
if errorlevel 1 (
  echo O Docker nao esta em execucao. Abra o Docker Desktop e tente de novo.
  pause
  exit /b 1
)
docker compose up -d
docker compose -f testes/docker-compose.yml up -d monitorado
echo Aguardando o servidor de exemplo (na primeira vez, cria o banco "loja" em 1 a 3 minutos)...
:aguardar
timeout /t 3 /nobreak >nul
docker exec sqm-monitorado pg_isready -h 127.0.0.1 -U postgres >nul 2>&1
if errorlevel 1 goto aguardar
call npm run db:migrate
echo Encerrando o coletor, para que ele nao concorra com as medicoes...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*collector*index.ts*' -or $_.CommandLine -like '*coletor.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
call npm run recomendacoes
if errorlevel 1 (echo Ocorreu um erro. Veja a mensagem acima.) else (echo Pronto. Relatorio em testes\resultados.)
pause
