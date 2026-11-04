# Avaliação da ferramenta

- **Data:** 04/11/2026, 16:34:35
- **Cenário:** pgbench (TPC-B), protocolo estendido, log_min_duration_statement = 0, 30 s, 4 clientes
- **Arquivo:** `pgbench.csv` (csvlog, 402,77 MB, 1352195 registros)
- **Ambiente:** Intel(R) Xeon(R) Processor @ 2.10GHz, 2 núcleos lógicos, 7,8 GB de RAM, Linux 6.18.44-fc-v233, Node.js v22.23.4
- **Execuções:** 3

## Referência

Registros de duração no log, obtidos com COPY no PostgreSQL:

| Etapa | Registros | Tratamento esperado |
| --- | ---: | --- |
| statement (protocolo simples) | 5 | contabilizar |
| execute (protocolo estendido) | 450730 | contabilizar |
| parse (protocolo estendido) | 450730 | ignorar |
| bind (protocolo estendido) | 450730 | ignorar |
| **Consultas lentas esperadas** | **450735** | |

## (i) Acurácia na identificação das consultas lentas

| Indicador | Valor |
| --- | ---: |
| Consultas lentas no log (referência) | 450735 |
| Ocorrências registradas pela ferramenta | 450735 |
| Corretamente detectadas | 450735 |
| Não detectadas | 0 |
| Registradas indevidamente | 0 |
| Registros indevidos que eram etapas parse/bind | 0 |
| **Acurácia (detectadas / esperadas)** | **100,00%** |
| Precisão (detectadas / registradas) | 100,00% |
| Texto idêntico ao do log (protocolo simples) | 100,00% |
| Consultas distintas após a normalização | 12 |

## (ii) Completude da extração dos campos

| Campo | Presente no log | Extraído pela ferramenta | Completude |
| --- | ---: | ---: | ---: |
| Data e hora | 450735 | 450735 | 100,00% |
| Duração | 450735 | 450735 | 100,00% |
| Texto da consulta | 450735 | 450735 | 100,00% |
| Banco de dados | 450735 | 450735 | 100,00% |
| Usuário | 450735 | 450735 | 100,00% |
| Aplicação | 450735 | 450735 | 100,00% |
| Host do cliente | 450735 | 450735 | 100,00% |
| Identificador do processo (PID) | 450735 | 450735 | 100,00% |
| query_id | 450735 | 450735 | 100,00% |

## (iii) Tempo de processamento

| Medida | Mediana | Faixa (mín. a máx.) |
| --- | ---: | ---: |
| Tempo total (s) | 46,058 | 44,573 a 48,156 |
| Volume processado (MB/s) | 8,74 | 8,36 a 9,04 |
| Ocorrências por segundo | 9.786 | 9.360 a 10.112 |

## (iv) Sobrecarga

| Medida | Mediana | Faixa (mín. a máx.) |
| --- | ---: | ---: |
| Tempo de CPU do coletor (s) | 43,466 | 42,801 a 46,350 |
| Uso de CPU (% de um núcleo) | 96,0 | 94,4 a 96,2 |
| Memória do processo, pico (MB) | 230,2 | 229,4 a 230,6 |
| Memória adicional à base do processo (MB) | 150,8 | 150,0 a 151,2 |

- Memória base do processo (Node.js e bibliotecas, antes da leitura): 79,4 MB.
- O uso de CPU pode passar de 100% de um núcleo porque inclui as threads auxiliares do Node.js (leitura de arquivos e rede).
- Leitura em disco: 402,77 MB por execução (o arquivo é lido uma única vez, de forma sequencial).
- Armazenamento das ocorrências no banco da ferramenta: 69.842,10 KB (159 bytes por ocorrência, sem índices).
- Consulta ao pg_stat_statements no servidor monitorado (snapshot, até 500 consultas): mediana de 0,91 ms em 5 execuções.
- O coletor não executa consultas no servidor monitorado para ler o log: os arquivos são lidos diretamente do disco.

## Comparação com o pgBadger

| Indicador | Ferramenta | pgBadger |
| --- | ---: | ---: |
| Consultas lentas identificadas | 450735 | 450735 |
| Consultas distintas (normalizadas) | 12 | 12 |
| Tempo de processamento (s) | 46,058 (mediana) | 116,200 |

Consultas normalizadas com o mesmo número de ocorrências nas duas ferramentas: **12 de 12**.

| Consulta (ferramenta) | Ocorrências (ferramenta) | Ocorrências (pgBadger) | Tempo total (s, ferramenta) | Tempo total (s, pgBadger) | Contagem igual |
| --- | ---: | ---: | ---: | ---: | :---: |
| `END` | 64390 | 64390 | 22,83 | 22,83 | sim |
| `UPDATE pgbench_branches SET bbalance = bbalance + $1 WHERE bid = $2` | 64390 | 64390 | 9,79 | 9,79 | sim |
| `UPDATE pgbench_tellers SET tbalance = tbalance + $1 WHERE tid = $2` | 64390 | 64390 | 4,07 | 4,07 | sim |
| `UPDATE pgbench_accounts SET abalance = abalance + $1 WHERE aid = $2` | 64390 | 64390 | 2,62 | 2,62 | sim |
| `INSERT INTO pgbench_history (tid, bid, aid, delta, mtime) VALUES ($1, …` | 64390 | 64390 | 1,00 | 1,00 | sim |
| `SELECT abalance FROM pgbench_accounts WHERE aid = $1` | 64390 | 64390 | 0,65 | 0,65 | sim |
| `BEGIN` | 64390 | 64390 | 0,16 | 0,16 | sim |
| `truncate pgbench_history` | 1 | 1 | 0,00 | 0,00 | sim |
| `select o.n, p.partstrat, pg_catalog.count(i.inhparent) from pg_catalog…` | 1 | 1 | 0,00 | 0,00 | sim |
| `select count(*) from pgbench_branches` | 1 | 1 | 0,00 | 0,00 | sim |
| `vacuum pgbench_branches` | 1 | 1 | 0,00 | 0,00 | sim |
| `vacuum pgbench_tellers` | 1 | 1 | 0,00 | 0,00 | sim |
