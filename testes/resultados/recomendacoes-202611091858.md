# Avaliação das recomendações

- **Servidor:** PostgreSQL 18.4
- **Ambiente:** Intel(R) Xeon(R) Processor @ 2.10GHz, 2 núcleos, 8 GB, Linux 6.18.44-fc-v310
- **Medição:** EXPLAIN (ANALYZE, BUFFERS), 2 execuções de aquecimento e 7 medidas; mediana do tempo de execução

| Caso | Problema | Recomendação | Etapa | Antes | Depois | Ganho | Blocos (antes / depois) | Plano | Resultado |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| C1 | Filtro e ordenação sem índice | indice | Índice sugerido | 9,9 ms | 0,02 ms | 411x | 2750 / 13 | Seq Scan em pedido → Bitmap Heap Scan em pedido | idêntico |
| C2 | Junção sem índice na chave estrangeira | juncao | Índice do filtro | 90,5 ms | 82,4 ms | 1,1x | 10370 / 7699 | Seq Scan em item_pedido; Seq Scan em pedido → Seq Scan em item_pedido; Bitmap Heap Scan em pedido | idêntico |
| C2 | Junção sem índice na chave estrangeira | juncao | Índice do filtro e da junção | 90,5 ms | 0,13 ms | 675x | 10370 / 76 | Seq Scan em item_pedido; Seq Scan em pedido → Bitmap Heap Scan em pedido; Bitmap Heap Scan em item_pedido | idêntico |
| C3 | Busca com curinga no início (ILIKE '%...%') | like-curinga | Índice trigram (pg_trgm) | 23,0 ms | 0,46 ms | 49,7x | 594 / 31 | Seq Scan em cliente → Bitmap Heap Scan em cliente | idêntico |
| C4 | Função lower() sobre a coluna do filtro | funcao-coluna | Índice sobre a expressão | 6,9 ms | 0,01 ms | 630x | 594 / 4 | Seq Scan em cliente → Index Scan em cliente (cliente_lower_idx) | idêntico |
| C5 | Função date() sobre a coluna do filtro | funcao-coluna | Reescrita como faixa | 36,9 ms | 19,7 ms | 1,9x | 2712 / 2712 | Seq Scan em pedido → Seq Scan em pedido | idêntico |
| C5 | Função date() sobre a coluna do filtro | funcao-coluna | Reescrita e índice sugerido para a faixa | 36,9 ms | 0,18 ms | 208x | 2712 / 7 | Seq Scan em pedido → Index Only Scan em pedido (pedido_criado_em_idx) | idêntico |
| C6 | Paginação com OFFSET alto | offset | Paginação por chave (keyset) | 32,4 ms | 0,04 ms | 752x | 1906 / 5 | Index Scan em pedido (pedido_pkey) → Index Scan em pedido (pedido_pkey) | idêntico |
| C7 | NOT IN com subconsulta | not-in | Reescrita com NOT EXISTS | 6988 ms | 53,4 ms | 131x | 2293 / 2717 | Index Only Scan em cliente (cliente_pkey); Seq Scan em pedido → Seq Scan em pedido; Index Only Scan em cliente (cliente_pkey) | idêntico |
| C8 | Subconsulta executada para cada linha | subconsulta-select | Reescrita com junção e agrupamento | 1608 ms | 45,0 ms | 35,8x | 271209 / 2721 | Index Scan em cliente (cliente_pkey); Seq Scan em pedido → Seq Scan em pedido; Index Scan em cliente (cliente_pkey) | idêntico |
| C9 | Contagem de todas as linhas | count-total | Estimativa do catálogo | 71,3 ms | 0,01 ms | 6485x | 7644 / 3 | Seq Scan em item_pedido → Index Scan em pg_class (pg_class_oid_index) | aproximado |
| C10 | Agregação sobre a tabela inteira | agregacao-total | Visão materializada | 47,7 ms | 0,01 ms | 3671x | 2720 / 1 | Seq Scan em pedido → Seq Scan em resumo_status | idêntico |
| C11 | Amostra aleatória com ORDER BY random() | order-random | TABLESAMPLE | 226 ms | 0,01 ms | 15095x | 7644 / 1 | Seq Scan em item_pedido → Sample Scan em item_pedido | não se aplica |
| C12 | Atualização sem índice no filtro | indice | Índice sugerido | 22,5 ms | 0,06 ms | 352x | 2731 / 29 | ModifyTable em pedido; Seq Scan em pedido → ModifyTable em pedido; Index Scan em pedido (pedido_status_cliente_id_idx) | não se aplica |
| C13 | Exclusão com chave estrangeira sem índice | delete-fk | Índice na chave estrangeira | 51,4 ms | 0,07 ms | 791x | 6 / 6 | ModifyTable em pedido; Index Scan em pedido (pedido_pkey) → ModifyTable em pedido; Index Scan em pedido (pedido_pkey) | não se aplica |
| C14 | DISTINCT para remover duplicatas da junção | distinct-join | Reescrita com EXISTS | 51,0 ms | 44,5 ms | 1,1x | 3307 / 3307 | Seq Scan em pedido; Seq Scan em cliente → Seq Scan em pedido; Seq Scan em cliente | idêntico |
| C15 | Filtros de baixa seletividade | indice | Índices sugeridos | 37,4 ms | 27,1 ms | 1,4x | 3901 / 3387 | Seq Scan em pedido; Seq Scan em cliente → Bitmap Heap Scan em pedido; Bitmap Heap Scan em cliente | idêntico |
