# Prepara e inicia a ferramenta no Windows: confere o Node.js e o Docker Desktop, instala as
# dependências, sobe os bancos, cria as tabelas e abre o coletor, o painel e o navegador.
# Uso: dois cliques em iniciar.bat (ou: powershell -ExecutionPolicy Bypass -File iniciar.ps1)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force -Path logs | Out-Null
Start-Transcript -Path (Join-Path $PSScriptRoot 'logs\iniciar.log') -Force | Out-Null

function Etapa([string]$texto) { Write-Host ''; Write-Host "==> $texto" -ForegroundColor Cyan }
function Existe([string]$cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function AtualizarPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Falhar([string]$mensagem) {
  Write-Host ''
  Write-Host "ERRO: $mensagem" -ForegroundColor Red
  Stop-Transcript | Out-Null
  Read-Host 'Pressione Enter para fechar'
  exit 1
}
function Aguardar([string]$descricao, [scriptblock]$teste, [int]$segundos) {
  Write-Host "aguardando $descricao..." -NoNewline
  $limite = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $limite) {
    if (& $teste) { Write-Host ' ok'; return $true }
    Write-Host '.' -NoNewline
    Start-Sleep -Seconds 3
  }
  Write-Host ''
  return $false
}

try {
  Etapa 'Verificando o Node.js'
  if (-not (Existe 'node')) {
    if (Existe 'winget') {
      Write-Host 'Node.js não encontrado. Instalando a versão LTS pelo winget (confirme a permissão do Windows, se solicitada)...'
      winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
      AtualizarPath
    }
    if (-not (Existe 'node')) { Falhar 'Instale o Node.js 20 ou superior (https://nodejs.org) e execute este script novamente.' }
  }
  $versaoNode = (node -v).Trim()
  $principal = [int]($versaoNode.TrimStart('v').Split('.')[0])
  if ($principal -lt 20) { Falhar "Node.js $versaoNode encontrado; é necessária a versão 20 ou superior (https://nodejs.org)." }
  Write-Host "Node.js $versaoNode"

  Etapa 'Verificando o Docker Desktop'
  $binDocker = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin'
  $exeDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Existe 'docker') -and (Test-Path $binDocker)) { $env:Path += ";$binDocker" }
  if (-not (Existe 'docker')) {
    if (Existe 'winget') {
      Write-Host 'Docker Desktop não encontrado. Instalando pelo winget (confirme a permissão do Windows, se solicitada)...'
      winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements
      AtualizarPath
      if (-not (Existe 'docker') -and (Test-Path $binDocker)) { $env:Path += ";$binDocker" }
    }
    if (-not (Existe 'docker')) {
      Falhar 'Instale o Docker Desktop (https://www.docker.com/products/docker-desktop), reinicie o computador se for pedido, abra o Docker Desktop uma vez e execute este script novamente.'
    }
  }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path $exeDesktop) {
      Write-Host 'Iniciando o Docker Desktop...'
      Start-Process $exeDesktop
    }
    $ok = Aguardar 'o Docker ficar pronto' { docker info *> $null; $LASTEXITCODE -eq 0 } 240
    if (-not $ok) {
      Falhar 'O Docker não respondeu. Abra o Docker Desktop, aceite os termos na primeira execução, aguarde o ícone ficar verde e execute este script novamente.'
    }
  }
  Write-Host (docker --version)

  Etapa 'Instalando as dependências do projeto'
  if (-not (Test-Path 'node_modules') -or ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules').LastWriteTime)) {
    npm install
    if ($LASTEXITCODE -ne 0) { Falhar 'npm install falhou.' }
    (Get-Item 'node_modules').LastWriteTime = Get-Date
  } else {
    Write-Host 'dependências já instaladas'
  }

  Etapa 'Configurando o arquivo .env'
  if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Write-Host '.env criado a partir de .env.example'
  } else {
    # versões anteriores usavam localhost, que no Windows pode resolver para IPv6 (::1)
    $conteudo = Get-Content '.env' -Raw
    if ($conteudo -match '@localhost:') {
      ($conteudo -replace '@localhost:', '@127.0.0.1:') | Set-Content '.env' -NoNewline -Encoding ASCII
      Write-Host '.env atualizado para usar 127.0.0.1'
    } else {
      Write-Host '.env já existe (mantido)'
    }
  }

  Etapa 'Subindo os bancos de dados (docker compose)'
  docker compose up -d monitorado ferramenta
  if ($LASTEXITCODE -ne 0) { Falhar 'docker compose up falhou. Veja a mensagem acima (por exemplo, porta em uso).' }
  # o servidor temporário da inicialização não aceita conexões TCP; o teste por 127.0.0.1 só passa no servidor definitivo
  $ok = Aguardar 'o banco da ferramenta' { docker exec sqm-ferramenta pg_isready -h 127.0.0.1 -U ferramenta *> $null; $LASTEXITCODE -eq 0 } 120
  if (-not $ok) { Falhar 'O banco da ferramenta não ficou pronto. Veja: docker logs sqm-ferramenta' }
  Write-Host 'Na primeira execução, o servidor monitorado cria o banco de exemplo (cerca de 1 a 3 minutos).'
  $ok = Aguardar 'o servidor monitorado' { docker exec sqm-monitorado pg_isready -h 127.0.0.1 -U postgres *> $null; $LASTEXITCODE -eq 0 } 600
  if (-not $ok) { Falhar 'O servidor monitorado não ficou pronto. Veja: docker logs sqm-monitorado' }

  Etapa 'Criando as tabelas da ferramenta'
  npm run db:migrate
  if ($LASTEXITCODE -ne 0) { Falhar 'A migração do banco falhou.' }

  Etapa 'Abrindo o coletor e o painel'
  $raiz = $PSScriptRoot
  Start-Process powershell -ArgumentList '-NoExit', '-Command', "[Console]::OutputEncoding = [Text.Encoding]::UTF8; `$Host.UI.RawUI.WindowTitle = 'Coletor'; Set-Location '$raiz'; npm run collector 2>&1 | Tee-Object -FilePath logs\coletor.log"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', "[Console]::OutputEncoding = [Text.Encoding]::UTF8; `$Host.UI.RawUI.WindowTitle = 'Painel'; Set-Location '$raiz'; npm run dev 2>&1 | Tee-Object -FilePath logs\painel.log"
  $ok = Aguardar 'o painel em http://localhost:3000' {
    try { (Invoke-WebRequest -Uri 'http://localhost:3000/coletor' -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200 } catch { $false }
  } 180
  if (-not $ok) { Falhar 'O painel não respondeu. Veja a janela "Painel" ou o arquivo logs\painel.log.' }
  Start-Process 'http://localhost:3000'

  Write-Host ''
  Write-Host 'Tudo pronto!' -ForegroundColor Green
  Write-Host '  Painel:   http://localhost:3000 (janela "Painel")'
  Write-Host '  Coletor:  janela "Coletor"'
  Write-Host '  Para gerar consultas lentas de exemplo, execute npm run carga em outro terminal.'
  Write-Host '  Para encerrar, feche as janelas "Coletor" e "Painel". Os bancos continuam no Docker (docker compose stop para parar).'
  Stop-Transcript | Out-Null
  Read-Host 'Pressione Enter para fechar esta janela'
} catch {
  Falhar $_.Exception.Message
}
