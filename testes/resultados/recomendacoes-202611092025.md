# Avaliação das recomendações

- **Servidor:** PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)
- **Ambiente:** AMD Ryzen 5 3600 6-Core Processor              , 12 núcleos, 16 GB, Windows_NT 10.0.26220
- **Índices existentes no início:** cliente_pkey, pedido_pkey, pgbench_accounts_pkey, pgbench_branches_pkey, pgbench_tellers_pkey, produto_pkey
- **Medição:** EXPLAIN (ANALYZE, BUFFERS), 2 execuções de aquecimento e 7 medidas; mediana do tempo de execução

| Caso | Problema | Recomendação | Etapa | Antes | Depois | Ganho | Blocos (antes / depois) | Plano | Resultado |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| C1 | Filtro e ordenação sem índice | indice | Índice sugerido | 12,9 ms | 0,02 ms | 586x | 2762 / 8 | Seq Scan em pedido → Bitmap Heap Scan em pedido | idêntico |
| C2 | Junção sem índice na chave estrangeira | juncao | Índice do filtro | 68,8 ms | 50,7 ms | 1,4x | 10382 / 7684 | Seq Scan em item_pedido; Seq Scan em pedido → Seq Scan em item_pedido; Bitmap Heap Scan em pedido | idêntico |
| C2 | Junção sem índice na chave estrangeira | juncao | Índice do filtro e da junção | 68,8 ms | 0,11 ms | 614x | 10382 / 40 | Seq Scan em item_pedido; Seq Scan em pedido → Bitmap Heap Scan em pedido; Bitmap Heap Scan em item_pedido | idêntico |
| C3 | Busca com curinga no início (ILIKE '%...%') | like-curinga | Índice trigram (pg_trgm) | 22,8 ms | 0,28 ms | 83,0x | 594 / 31 | Seq Scan em cliente → Bitmap Heap Scan em cliente | idêntico |
| C4 | Função lower() sobre a coluna do filtro | funcao-coluna | Índice sobre a expressão | 16,3 ms | 0,02 ms | 1021x | 594 / 4 | Seq Scan em cliente → Index Scan em cliente (cliente_lower_idx) | idêntico |
| C5 | Função date() sobre a coluna do filtro | funcao-coluna | Reescrita como faixa | 31,2 ms | 23,0 ms | 1,4x | 2724 / 2724 | Seq Scan em pedido → Seq Scan em pedido | idêntico |
| C5 | Função date() sobre a coluna do filtro | funcao-coluna | Reescrita e índice sugerido para a faixa | 31,2 ms | 0,25 ms | 124x | 2724 / 471 | Seq Scan em pedido → Index Only Scan em pedido (pedido_criado_em_idx) | idêntico |
| C6 | Paginação com OFFSET alto | offset | Paginação por chave (keyset) | 33,0 ms | 0,03 ms | 1177x | 2856 / 5 | Index Scan em pedido (pedido_pkey) → Index Scan em pedido (pedido_pkey) | idêntico |
| C7 | NOT IN com subconsulta | not-in | Reescrita com NOT EXISTS | 5589 ms | 44,6 ms | 125x | 2367 / 2729 | Index Only Scan em cliente (cliente_pkey); Seq Scan em pedido → Seq Scan em pedido; Index Only Scan em cliente (cliente_pkey) | idêntico |
| C8 | Subconsulta executada para cada linha | subconsulta-select | Reescrita com junção e agrupamento | 1316 ms | 42,2 ms | 31,2x | 272409 / 2733 | Index Scan em cliente (cliente_pkey); Seq Scan em pedido → Seq Scan em pedido; Index Scan em cliente (cliente_pkey) | idêntico |
| C9 | Contagem de todas as linhas | count-total | Estimativa do catálogo | 58,2 ms | 0,01 ms | 5295x | 7644 / 3 | Seq Scan em item_pedido → Index Scan em pg_class (pg_class_oid_index) | aproximado |
| C10 | Agregação sobre a tabela inteira | agregacao-total | Visão materializada | 53,4 ms | 0,03 ms | 1781x | 2732 / 1 | Seq Scan em pedido → Seq Scan em resumo_status | idêntico |
| C11 | Amostra aleatória com ORDER BY random() | order-random | TABLESAMPLE | 224 ms | 0,01 ms | 17218x | 7644 / 1 | Seq Scan em item_pedido → Sample Scan em item_pedido | não se aplica |
| C12 | Atualização sem índice no filtro | indice | Índice sugerido | 22,1 ms | 0,05 ms | 470x | 2730 / 28 | ModifyTable em pedido; Seq Scan em pedido → ModifyTable em pedido; Index Scan em pedido (pedido_status_cliente_id_idx) | não se aplica |
| C13 | Exclusão com chave estrangeira sem índice | delete-fk | Índice na chave estrangeira | 51,9 ms | 0,07 ms | 787x | 6 / 6 | ModifyTable em pedido; Index Scan em pedido (pedido_pkey) → ModifyTable em pedido; Index Scan em pedido (pedido_pkey) | não se aplica |
| C14 | DISTINCT para remover duplicatas da junção | distinct-join | Reescrita com EXISTS | 45,2 ms | 39,2 ms | 1,2x | 3318 / 3318 | Seq Scan em pedido; Seq Scan em cliente → Seq Scan em pedido; Seq Scan em cliente | idêntico |
| C15 | Filtros de baixa seletividade | indice | Índices sugeridos | 34,6 ms | 20,5 ms | 1,7x | 3912 / 3387 | Seq Scan em pedido; Seq Scan em cliente → Bitmap Heap Scan em pedido; Bitmap Heap Scan em cliente | idêntico |
