# Executa a avaliação da seção 3.3 do TC (Tabelas 10 a 14) e gera os relatórios em testes\resultados\.
#   Cenário 1: carga de exemplo (consultas lentas, limite de 100 ms)
#   Cenário 2: pgbench com registro de todas as instruções (volume)
#   Cenário 3: impacto no servidor monitorado (vazão do pgbench)
# Uso: dois cliques em testes\avaliar.bat (leva cerca de 30 minutos).
param([int]$SegundosCarga = 300, [int]$SegundosPgbench = 30, [int]$SegundosImpacto = 60,
  # refaz apenas o pgBadger e os relatórios a partir dos últimos arquivos dos cenários 1 e 2
  [switch]$ApenasRelatorios)

$ErrorActionPreference = 'Continue'
# os scripts são executados a partir da raiz do projeto
Set-Location (Split-Path $PSScriptRoot -Parent)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
New-Item -ItemType Directory -Force -Path logs, testes\resultados | Out-Null
Start-Transcript -Path 'logs\avaliacao.log' -Force | Out-Null
$inicio = Get-Date

function Etapa([string]$t) { Write-Host ''; Write-Host "==> $t ($(Get-Date -Format HH:mm:ss))" -ForegroundColor Cyan }
function Falhar([string]$m) {
  Write-Host "ERRO: $m" -ForegroundColor Red
  Stop-Transcript | Out-Null
  Read-Host 'Pressione Enter para fechar'
  exit 1
}

# executa o pgBadger no contêiner e devolve o tempo informado
function RodarPgbadger([string]$arquivo) {
  $nome = Split-Path $arquivo -Leaf
  $json = $nome -replace '\.(csv|json)$', '.pgbadger.json'
  $saida = docker compose -f testes/docker-compose.yml run --rm pgbadger -q -f csv -x json -o "/resultados/$json" "/resultados/$nome" 2>&1 | Out-String
  Write-Host $saida
  $m = [regex]::Match($saida, 'tempo do pgBadger: ([\d.]+) s')
  if (-not $m.Success) { Falhar "o pgBadger não processou $nome" }
  return @{ json = "testes/resultados/$json"; tempo = $m.Groups[1].Value }
}

function UltimoArquivo([string]$padrao) {
  (Get-ChildItem testes\resultados -Filter $padrao | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}

Etapa 'Verificando o ambiente'
docker info *> $null
if ($LASTEXITCODE -ne 0) { Falhar 'O Docker não está em execução. Abra o Docker Desktop e tente novamente.' }
docker compose up -d
docker compose -f testes/docker-compose.yml up -d monitorado
Write-Host 'Na primeira execução, o servidor de exemplo cria o banco "loja" (cerca de 1 a 3 minutos).'
$limite = (Get-Date).AddMinutes(10)
do { Start-Sleep -Seconds 3; docker exec sqm-monitorado pg_isready -h 127.0.0.1 -U postgres *> $null } while ($LASTEXITCODE -ne 0 -and (Get-Date) -lt $limite)
if ($LASTEXITCODE -ne 0) { Falhar 'O servidor de exemplo não ficou pronto. Veja: docker logs sqm-monitorado' }
npm run db:migrate
if ($LASTEXITCODE -ne 0) { Falhar 'Não foi possível acessar o banco da ferramenta.' }

# o coletor em execução concorreria com as medições
$coletores = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*collector/index.ts*' -or $_.CommandLine -like '*collector\index.ts*' -or $_.CommandLine -like '*coletor.ts*' }
foreach ($c in $coletores) { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue }
if ($coletores) { Write-Host "coletor encerrado durante a avaliação ($(@($coletores).Count) processo(s))" }

Etapa 'Preparando o pgBadger (primeira vez: alguns minutos)'
docker compose -f testes/docker-compose.yml build pgbadger
if ($LASTEXITCODE -ne 0) { Falhar 'Não foi possível preparar a imagem do pgBadger.' }

Etapa "Cenário 1: carga de exemplo ($SegundosCarga s)"
if (-not $ApenasRelatorios) { npm run cenario -- carga $SegundosCarga }
$c1 = UltimoArquivo 'cenario-carga-*.csv'
$pgb1 = RodarPgbadger $c1
npm run avaliacao -- $c1 --execucoes 5 --pgbadger $pgb1.json --tempo-pgbadger $pgb1.tempo --cenario "Carga de exemplo ($SegundosCarga s): consultas lentas pelos protocolos simples e estendido, log_min_duration_statement = 100 ms"

Etapa "Cenário 2: pgbench com registro de todas as instruções ($SegundosPgbench s)"
if (-not $ApenasRelatorios) { npm run cenario -- pgbench $SegundosPgbench }
$c2 = UltimoArquivo 'cenario-pgbench-*.csv'
$pgb2 = RodarPgbadger $c2
npm run avaliacao -- $c2 --execucoes 3 --pgbadger $pgb2.json --tempo-pgbadger $pgb2.tempo --cenario "pgbench (TPC-B), protocolo estendido, log_min_duration_statement = 0, $SegundosPgbench s, 4 clientes"

if (-not $ApenasRelatorios) {
  Etapa "Cenário 3: impacto no servidor monitorado (3 x 3 execuções de $SegundosImpacto s)"
  npm run cenario -- impacto $SegundosImpacto
}

$duracao = [int]((Get-Date) - $inicio).TotalMinutes
Write-Host ''
Write-Host "Avaliação concluída em $duracao min. Relatórios em testes\resultados\:" -ForegroundColor Green
Get-ChildItem testes\resultados -Filter '*.md' | Where-Object { $_.LastWriteTime -ge $inicio } | ForEach-Object { Write-Host "  $($_.Name)" }
Stop-Transcript | Out-Null
Read-Host 'Pressione Enter para fechar'
