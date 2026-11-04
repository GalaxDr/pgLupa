#!/usr/bin/env bash
# Instala (ou atualiza) o site no servidor. Executado pelo publicar.ps1, ou manualmente:
#   bash deploy/instalar-no-servidor.sh [dominio]
set -euo pipefail
DOMINIO="${1:-}"
cd "$(dirname "$0")/.."

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

echo "==> Firewall do sistema (portas 80 e 443)"
if command -v firewall-cmd >/dev/null 2>&1 && sudo firewall-cmd --state >/dev/null 2>&1; then
  # Oracle Linux
  sudo firewall-cmd --permanent --add-service=http --add-service=https
  sudo firewall-cmd --reload
elif command -v iptables >/dev/null 2>&1; then
  # Ubuntu das imagens da Oracle: libera antes da regra REJECT padrão
  for porta in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$porta" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p tcp --dport "$porta" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save; fi
fi

echo "==> Memória"
memoria_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$memoria_kb" -lt 2000000 ] && [ -z "$(swapon --show)" ]; then
  echo "pouca memória: criando 2 GB de swap para o build"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Configuração (.env.producao)"
if [ ! -f .env.producao ]; then
  if [ -z "$DOMINIO" ]; then
    ip=$(curl -fsS https://api.ipify.org)
    DOMINIO="$(echo "$ip" | tr . -).sslip.io"
  fi
  sed -e "s/^SENHA_BANCO=.*/SENHA_BANCO=$(openssl rand -hex 16)/" -e "s/^DOMINIO=.*/DOMINIO=$DOMINIO/" deploy/producao.env.exemplo > .env.producao
  chmod 600 .env.producao
elif [ -n "$DOMINIO" ]; then
  sed -i "s/^DOMINIO=.*/DOMINIO=$DOMINIO/" .env.producao
fi

echo "==> Subindo os contêineres"
$DOCKER compose -f docker-compose.producao.yml --env-file .env.producao up -d --build --remove-orphans
$DOCKER image prune -f >/dev/null || true

echo
echo "Site publicado: https://$(grep '^DOMINIO=' .env.producao | cut -d= -f2)"
echo "(na primeira vez, o certificado HTTPS pode levar até um minuto para ser emitido)"
