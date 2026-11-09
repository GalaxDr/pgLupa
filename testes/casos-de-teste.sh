#!/bin/sh
# Casos de teste das recomendações (seção 5.6 do TC, Tabela 16) no Linux. Leva cerca de 15 minutos.
# Uso, a partir da raiz do projeto: sh testes/casos-de-teste.sh
set -e
cd "$(dirname "$0")/.."
docker compose up -d
docker compose -f testes/docker-compose.yml up -d monitorado
until docker exec sqm-monitorado pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 3; done
npm run db:migrate
pkill -f "collector/index.ts|coletor.ts" 2>/dev/null || true
npm run recomendacoes
