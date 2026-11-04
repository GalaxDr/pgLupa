# Impacto no servidor monitorado

- **Data:** 04/11/2026, 16:38:57
- **Carga:** pgbench (TPC-B), protocolo estendido, 4 clientes, 10 s por execução, 3 execuções por configuração, escala 5

| Configuração | TPS (mediana) | Faixa | Variação em relação a sem registro |
| --- | ---: | ---: | ---: |
| Sem registro de consultas (log_min_duration_statement = -1) | 2.707,1 | 2.662,3 a 2.957,6 | 0,0% |
| Registro de todas as consultas (log_min_duration_statement = 0) | 2.082,8 | 2.070,9 a 2.179,0 | -23,1% |
| Registro de todas as consultas e coletor em execução | 986,9 | 976,6 a 1.016,0 | -63,5% |

A diferença entre a segunda e a terceira linha corresponde ao efeito do coletor sobre o servidor monitorado;
a diferença entre a primeira e a segunda, ao custo do próprio registro em log pelo PostgreSQL.
