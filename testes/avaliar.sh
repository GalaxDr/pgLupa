#!/bin/sh
# Executa a avaliação da seção 3.3 do TC (Tabelas 10 a 14) no Linux e gera os relatórios em testes/resultados/.
# Uso, a partir da raiz do projeto: sh testes/avaliar.sh [segundos da carga] [segundos do pgbench] [segundos do impacto]
#   --limite-100 no final acrescenta ao cenário 3 as configurações com limite de 100 ms (Tabela 15)
set -e
cd "$(dirname "$0")/.."
CARGA=${1:-300}; PGBENCH_S=${2:-30}; IMPACTO=${3:-60}; EXTRA=${4:-}
R=testes/resultados
mkdir -p "$R"

echo "==> Subindo os bancos"
docker compose up -d
docker compose -f testes/docker-compose.yml up -d monitorado
until docker exec sqm-monitorado pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 3; done
npm run db:migrate
pkill -f "collector/index.ts|coletor.ts" 2>/dev/null || true   # o coletor concorreria com as medições
docker compose -f testes/docker-compose.yml build pgbadger

pgbadger() { # executa o pgBadger e devolve o tempo informado
  saida=$(docker compose -f testes/docker-compose.yml run --rm pgbadger -q -f csv -x json -o "/resultados/$(basename "${1%.csv}").pgbadger.json" "/resultados/$(basename "$1")" 2>&1)
  echo "$saida" >&2
  echo "$saida" | sed -n 's/.*tempo do pgBadger: \([0-9.]*\) s.*/\1/p'
}
ultimo() { ls -t "$R"/$1 | head -n 1; }

echo "==> Cenário 1: carga de exemplo ($CARGA s)"
npm run cenario -- carga "$CARGA"
c1=$(ultimo 'cenario-carga-*.csv'); t1=$(pgbadger "$c1")
npm run avaliacao -- "$c1" --execucoes 5 --pgbadger "${c1%.csv}.pgbadger.json" --tempo-pgbadger "$t1" \
  --cenario "Carga de exemplo ($CARGA s): consultas lentas pelos protocolos simples e estendido, log_min_duration_statement = 100 ms"

echo "==> Cenário 2: pgbench com registro de todas as instruções ($PGBENCH_S s)"
npm run cenario -- pgbench "$PGBENCH_S"
c2=$(ultimo 'cenario-pgbench-*.csv'); t2=$(pgbadger "$c2")
npm run avaliacao -- "$c2" --execucoes 3 --pgbadger "${c2%.csv}.pgbadger.json" --tempo-pgbadger "$t2" \
  --cenario "pgbench (TPC-B), protocolo estendido, log_min_duration_statement = 0, $PGBENCH_S s, 4 clientes"

echo "==> Cenário 3: impacto no servidor monitorado"
npm run cenario -- impacto "$IMPACTO" $EXTRA

echo "Avaliação concluída. Relatórios em $R/"
