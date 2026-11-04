# Avaliação da ferramenta

- **Data:** 04/11/2026, 16:29:47
- **Cenário:** Carga de exemplo (npm run carga): consultas lentas pelos protocolos simples e estendido, log_min_duration_statement = 100 ms
- **Arquivo:** `teste1.csv` (csvlog, 0,33 MB, 857 registros)
- **Ambiente:** Intel(R) Xeon(R) Processor @ 2.10GHz, 2 núcleos lógicos, 7,8 GB de RAM, Linux 6.18.44-fc-v233, Node.js v22.23.4
- **Execuções:** 5

## Referência

Registros de duração no log, obtidos com COPY no PostgreSQL:

| Etapa | Registros | Tratamento esperado |
| --- | ---: | --- |
| statement (protocolo simples) | 398 | contabilizar |
| execute (protocolo estendido) | 404 | contabilizar |
| parse (protocolo estendido) | 3 | ignorar |
| bind (protocolo estendido) | 1 | ignorar |
| **Consultas lentas esperadas** | **802** | |

## (i) Acurácia na identificação das consultas lentas

| Indicador | Valor |
| --- | ---: |
| Consultas lentas no log (referência) | 802 |
| Ocorrências registradas pela ferramenta | 802 |
| Corretamente detectadas | 802 |
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
| Data e hora | 802 | 802 | 100,00% |
| Duração | 802 | 802 | 100,00% |
| Texto da consulta | 802 | 802 | 100,00% |
| Banco de dados | 802 | 802 | 100,00% |
| Usuário | 802 | 802 | 100,00% |
| Aplicação | 802 | 802 | 100,00% |
| Host do cliente | 802 | 802 | 100,00% |
| Identificador do processo (PID) | 802 | 802 | 100,00% |
| query_id | 802 | 802 | 100,00% |

## (iii) Tempo de processamento

| Medida | Mediana | Faixa (mín. a máx.) |
| --- | ---: | ---: |
| Tempo total (s) | 0,081 | 0,071 a 0,127 |
| Volume processado (MB/s) | 4,04 | 2,57 a 4,57 |
| Ocorrências por segundo | 9.944 | 6.336 a 11.261 |

## (iv) Sobrecarga

| Medida | Mediana | Faixa (mín. a máx.) |
| --- | ---: | ---: |
| Tempo de CPU do coletor (s) | 0,068 | 0,051 a 0,145 |
| Uso de CPU (% de um núcleo) | 84,4 | 71,6 a 114,8 |
| Memória do processo, pico (MB) | 129,3 | 106,8 a 136,6 |
| Memória adicional à base do processo (MB) | 51,3 | 28,7 a 58,5 |

- Memória base do processo (Node.js e bibliotecas, antes da leitura): 78,1 MB.
- O uso de CPU pode passar de 100% de um núcleo porque inclui as threads auxiliares do Node.js (leitura de arquivos e rede).
- Leitura em disco: 0,33 MB por execução (o arquivo é lido uma única vez, de forma sequencial).
- Armazenamento das ocorrências no banco da ferramenta: 213,45 KB (273 bytes por ocorrência, sem índices).
- Consulta ao pg_stat_statements no servidor monitorado (snapshot, até 500 consultas): mediana de 0,93 ms em 5 execuções.
- O coletor não executa consultas no servidor monitorado para ler o log: os arquivos são lidos diretamente do disco.

## Comparação com o pgBadger

| Indicador | Ferramenta | pgBadger |
| --- | ---: | ---: |
| Consultas lentas identificadas | 802 | 802 |
| Consultas distintas (normalizadas) | 12 | 12 |
| Tempo de processamento (s) | 0,081 (mediana) | 2,280 |

Consultas normalizadas com o mesmo número de ocorrências nas duas ferramentas: **12 de 12**.

| Consulta (ferramenta) | Ocorrências (ferramenta) | Ocorrências (pgBadger) | Tempo total (s, ferramenta) | Tempo total (s, pgBadger) | Contagem igual |
| --- | ---: | ---: | ---: | ---: | :---: |
| `SELECT c.cidade, count(DISTINCT p.id) AS pedidos, sum(i.quantidade * i…` | 138 | 138 | 211,34 | 211,34 | sim |
| `SELECT pg_sleep($1)` | 101 | 101 | 49,20 | 49,20 | sim |
| `SELECT p.id, sum(i.quantidade * i.preco) AS total FROM pedido p JOIN i…` | 262 | 262 | 38,58 | 38,58 | sim |
| `SELECT produto_id, sum(quantidade) FROM item_pedido WHERE produto_id I…` | 236 | 236 | 38,35 | 38,35 | sim |
| `INSERT INTO item_pedido (pedido_id, produto_id, quantidade, preco) SEL…` | 1 | 1 | 20,18 | 20,18 | sim |
| `SELECT count(*) FROM cliente c JOIN pedido p ON p.cliente_id = c.id WH…` | 40 | 40 | 5,21 | 5,21 | sim |
| `INSERT INTO pedido (cliente_id, status, criado_em) SELECT $1 + (random…` | 1 | 1 | 4,89 | 4,89 | sim |
| `UPDATE pedido SET status = $1 WHERE status = $2 AND cliente_id = $3` | 19 | 19 | 2,46 | 2,46 | sim |
| `SELECT id, status, criado_em FROM pedido WHERE cliente_id = $1 ORDER B…` | 1 | 1 | 1,82 | 1,82 | sim |
| `ANALYZE` | 1 | 1 | 0,66 | 0,66 | sim |
| `INSERT INTO cliente (nome, email, cidade) SELECT $1 \|\| g, $2 \|\| g \|\| $…` | 1 | 1 | 0,22 | 0,22 | sim |
| `SELECT * FROM cliente WHERE id = $1` | 1 | 1 | 0,13 | 0,13 | sim |
