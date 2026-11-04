#!/bin/sh
# Executa o pgBadger e informa o tempo de processamento, sem contar a inicialização do contêiner.
inicio=$(date +%s.%N)
pgbadger "$@"
codigo=$?
fim=$(date +%s.%N)
echo "tempo do pgBadger: $(echo "$inicio $fim" | awk '{printf "%.2f", $2 - $1}') s"
exit $codigo
