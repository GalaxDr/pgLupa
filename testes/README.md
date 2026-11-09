# Testes do pgLupa (avaliação do TC)

Esta pasta reúne o ambiente, os scripts e os resultados da avaliação apresentada no Capítulo 5 do
Trabalho de Conclusão de Curso *Desenvolvimento de uma ferramenta para monitoramento de queries lentas
em PostgreSQL* (Engenharia de Computação, UNISC). O código da ferramenta é o mesmo do ramo `main`;
este ramo acrescenta apenas a pasta `testes/` e as dependências usadas por ela.

## Onde está cada resultado do TC

| Seção / tabela do TC | Script | Arquivo em `resultados/` |
| --- | --- | --- |
| 5.1 Cenários de avaliação (Tabela 10) | `cenario.ts carga` e `cenario.ts pgbench` | `cenario-carga-20261105-0042.csv`, `cenario-pgbench-20261105-0042.csv` (trechos de log analisados) |
| 5.2 Acurácia e completude (Tabela 11) | `avaliacao.ts` | `avaliacao-20261105-005638.md` (cenário 1), `avaliacao-20261105-005659.md` (cenário 2) |
| 5.3 Comparação com o pgBadger (Tabela 12) | `avaliacao.ts` + `pgbadger/` | mesmos relatórios; saída do pgBadger em `*.pgbadger.json` |
| 5.4 Tempo de processamento e sobrecarga (Tabela 13) | `avaliacao.ts` | mesmos relatórios |
| 5.5 Impacto no servidor monitorado, Windows (Tabela 14) | `cenario.ts impacto` | `impacto-20261105-0052.md` |
| 5.5 Impacto no servidor monitorado, Linux (Tabela 15) | `cenario.ts impacto --limite-100` | `impacto-linux-20261109-1543.md`, `impacto-linux-100ms-20261109-1552.md` |
| 5.6 Avaliação das recomendações (Tabela 16 e Apêndice A) | `avaliar-recomendacoes.ts` | `recomendacoes-202611092025.md` e `.json` |

`recomendacoes-202611091858.*` é a execução preliminar dos casos de teste, antes do ajuste das regras
de índice na chave primária e da prioridade das junções descrito na seção 5.6.

## Ambiente de exemplo

`docker-compose.yml` sobe o servidor PostgreSQL 18 observado nos testes (`sqm-monitorado`, porta
5434), já configurado para registrar as consultas lentas (100 ms) em `testes/logs`. Na primeira
inicialização, `monitorado/init.sql` cria o banco `loja` (clientes, produtos, pedidos e itens, cerca de
1,6 milhão de linhas) e o usuário `monitor` para os snapshots do `pg_stat_statements`. O mesmo arquivo
define a imagem do pgBadger 13.3 usada na comparação.

Os scripts usam esse servidor sem nenhum `.env` (veja `scripts/ambiente.ts`). Para ver as consultas
do exemplo no painel:

```sh
docker compose up -d                                        # banco da ferramenta
docker compose -f testes/docker-compose.yml up -d monitorado
npm run coletor:exemplo                                     # coletor apontado para testes/logs
npm run dev                                                 # painel: http://localhost:3000
npm run carga -- 300                                        # consultas lentas por 5 min
```

## Como executar os testes

A partir da raiz do projeto. Os scripts sobem os bancos, aguardam o servidor de exemplo e encerram o
coletor, que concorreria com as medições.

| O que | Windows | Linux |
| --- | --- | --- |
| Cenários 1 a 3 (Tabelas 10 a 14), cerca de 30 min | `testes\avaliar.bat` | `sh testes/avaliar.sh` |
| Vazão com as linhas de 100 ms (Tabela 15) | `npm run cenario -- impacto 60 --limite-100` | `sh testes/avaliar.sh 300 30 60 --limite-100` |
| Refazer só o pgBadger e os relatórios dos cenários 1 e 2 | `testes\refazer-relatorios.bat` | |
| Casos de teste das recomendações (Tabela 16), cerca de 15 min | `testes\casos-de-teste.bat` | `sh testes/casos-de-teste.sh` |

Cada etapa também pode ser executada separadamente:

```sh
npm run cenario -- carga 300       # cenário 1: grava o trecho do log em testes/resultados/
npm run cenario -- pgbench 30      # cenário 2: registro de todas as instruções
docker compose -f testes/docker-compose.yml run --rm pgbadger -q -f csv -x json \
  -o /resultados/<log>.pgbadger.json /resultados/<log>.csv
npm run avaliacao -- testes/resultados/<log>.csv --execucoes 5 \
  --pgbadger testes/resultados/<log>.pgbadger.json --tempo-pgbadger <segundos>
npm run cenario -- impacto 60      # cenário 3: vazão (acrescente --limite-100 para as linhas de 100 ms)
npm run recomendacoes              # casos de teste antes e depois da otimização
```

Por padrão, o pgbench é executado dentro do contêiner. Para usar um pgbench instalado na máquina,
defina `PGBENCH` com o caminho do executável.

## Ambientes usados no TC

- **Windows (seções 5.1 a 5.6):** AMD Ryzen 5 3600 (12 núcleos lógicos), 16 GB de RAM, Windows 11,
  Docker Desktop com PostgreSQL 18 e Node.js 24. Os relatórios registram o ambiente de cada execução.
- **Linux (Tabela 15):** máquina virtual em nuvem com PostgreSQL 18.4 instalado diretamente no sistema,
  sem Docker, e o pgbench local indicado por `PGBENCH`.

## Conteúdo

```
testes/
  docker-compose.yml            servidor PostgreSQL de exemplo e pgBadger
  monitorado/init.sql           banco de exemplo "loja" e usuário de monitoramento
  logs/                         log do servidor de exemplo (não versionado)
  pgbadger/                     imagem do pgBadger, com a medição do tempo de processamento
  avaliar.bat / avaliar.ps1     cenários 1 a 3 no Windows
  avaliar.sh                    cenários 1 a 3 no Linux
  refazer-relatorios.bat        refaz o pgBadger e os relatórios a partir dos logs já gravados
  casos-de-teste.bat / .sh      casos de teste das recomendações
  scripts/
    ambiente.ts                 conexões e diretório de log do servidor de exemplo
    carga.ts                    gerador de consultas lentas (npm run carga)
    coletor.ts                  coletor apontado para o exemplo (npm run coletor:exemplo)
    cenario.ts                  cenários no servidor de exemplo e medição da vazão (pgbench)
    avaliacao.ts                acurácia, completude, tempo, sobrecarga e comparação com o pgBadger
    avaliar-recomendacoes.ts    15 casos de teste: diagnóstico, aplicação da recomendação e medição
  resultados/                   relatórios usados no TC
```
