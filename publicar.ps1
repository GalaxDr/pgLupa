# Publica (ou atualiza) o site na VPS: envia o projeto por SSH e executa deploy/instalar-no-servidor.sh.
# Uso: dois cliques em publicar.bat, ou: powershell -ExecutionPolicy Bypass -File publicar.ps1 [-Servidor ubuntu@IP] [-Chave caminho] [-Dominio dominio]
param(
  [string]$Servidor,
  [string]$Chave,
  [string]$Dominio
)
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$config = Join-Path $PSScriptRoot 'deploy\servidor.local.txt'

function Falhar([string]$mensagem) {
  Write-Host ''
  Write-Host "ERRO: $mensagem" -ForegroundColor Red
  Read-Host 'Pressione Enter para fechar'
  exit 1
}

# configurações salvas da última publicação
$salvo = @{}
if (Test-Path $config) {
  Get-Content $config | ForEach-Object { if ($_ -match '^(\w+)=(.*)$') { $salvo[$matches[1]] = $matches[2] } }
}
if (-not $Servidor) {
  $padrao = $salvo['Servidor']
  $Servidor = Read-Host "Usuário e IP da VPS (ex.: ubuntu@150.230.10.20)$(if ($padrao) { " [$padrao]" })"
  if (-not $Servidor) { $Servidor = $padrao }
}
if (-not $Chave) {
  $padrao = $salvo['Chave']
  $Chave = Read-Host "Caminho da chave SSH privada (.key ou .pem)$(if ($padrao) { " [$padrao]" })"
  if (-not $Chave) { $Chave = $padrao }
}
if (-not $Dominio -and $salvo['Dominio']) { $Dominio = $salvo['Dominio'] }
if (-not $Servidor) { Falhar 'Informe o usuário e o IP da VPS.' }
$Chave = $Chave.Trim('"')
if (-not (Test-Path $Chave)) { Falhar "Chave SSH não encontrada: $Chave" }
"Servidor=$Servidor`nChave=$Chave`nDominio=$Dominio" | Set-Content $config -Encoding UTF8

foreach ($cmd in 'ssh', 'scp', 'tar') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Falhar "Comando $cmd não encontrado (o cliente OpenSSH do Windows é necessário)." }
}

Write-Host '==> Empacotando o projeto'
$pacote = Join-Path $env:TEMP 'slowquery-monitor.tar.gz'
if (Test-Path $pacote) { Remove-Item $pacote }
tar -czf $pacote --exclude=node_modules --exclude=.next --exclude=.git --exclude=logs --exclude=.env --exclude=.env.producao `
  --exclude=docker/logs --exclude=resultados --exclude=deploy/servidor.local.txt -C $PSScriptRoot .
if ($LASTEXITCODE -ne 0) { Falhar 'Não foi possível empacotar o projeto.' }

Write-Host '==> Enviando para a VPS'
scp -i $Chave -o StrictHostKeyChecking=accept-new $pacote "${Servidor}:slowquery-monitor.tar.gz"
if ($LASTEXITCODE -ne 0) { Falhar 'Falha ao enviar o arquivo. Confira o usuário, o IP e a chave SSH.' }

Write-Host '==> Instalando no servidor (a primeira vez pode levar alguns minutos)'
$remoto = "mkdir -p ~/slowquery-monitor && tar -xzf ~/slowquery-monitor.tar.gz -C ~/slowquery-monitor && rm ~/slowquery-monitor.tar.gz && bash ~/slowquery-monitor/deploy/instalar-no-servidor.sh $Dominio"
ssh -i $Chave -o StrictHostKeyChecking=accept-new $Servidor $remoto
if ($LASTEXITCODE -ne 0) { Falhar 'A instalação no servidor falhou. Veja as mensagens acima.' }

Write-Host ''
Write-Host 'Publicação concluída.' -ForegroundColor Green
Read-Host 'Pressione Enter para fechar'
