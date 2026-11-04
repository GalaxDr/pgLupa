# Roteiro de validação da ferramenta

Este roteiro executa a etapa de validação e testes prevista na proposta e na seção 3.3 do TC.
Ao final, os relatórios gerados em `resultados/` fornecem as tabelas do capítulo de resultados.

## Critérios avaliados

| Critério (seção 3.3) | Como é medido |
| --- | --- |
| (i) Acurácia na identificação das consultas lentas | O arquivo de log é carregado no próprio PostgreSQL com `COPY`, cujo leitor de CSV não depende do coletor. Cada ocorrência gravada pela ferramenta é pareada com um registro do log pela data e hora, pelo processo e pela duração. A acurácia é a proporção de consultas lentas do log detectadas corretamente. |
| (ii) Completude da extração dos campos | Para cada campo (data e hora, duração, texto, banco, usuário, aplicação, host, PID e query_id), compara-se quantas ocorrências têm o campo preenchido no log e na ferramenta. |
| (iii) Tempo de processamento por volume | O arquivo é processado várias vezes, sempre desde o início. O relatório traz a mediana e a faixa de variação do tempo total, dos MB/s e das ocorrências por segundo. |
| (iv) Sobrecarga | Mede o tempo de CPU e o pico de memória do coletor, o volume lido do disco, o espaço ocupado no banco e o tempo da consulta ao `pg_stat_statements`. O cenário 3 mede ainda o efeito sobre a vazão do servidor monitorado. |
| Comparação com o pgBadger | O pgBadger processa o mesmo arquivo. O relatório compara o total de consultas, as consultas normalizadas, o número de ocorrências de cada uma e o tempo de processamento. |

## Antes de começar

1. Anote o processador, a memória RAM e o sistema operacional do computador. São os dados do
   parágrafo da seção 4.3. O relatório de avaliação também registra o ambiente automaticamente.
2. Feche os programas pesados e deixe o computador ligado na tomada, para não variar o desempenho.
3. Suba o ambiente e prepare a imagem do pgBadger (apenas na primeira vez):

```powershell
docker compose up -d
npm run db:migrate
docker compose build pgbadger
```

4. **Pare o coletor** (`Ctrl+C` no terminal do `npm run collector`) durante os cenários 1 e 2, para
   que ele não concorra com as medições. No cenário 3, o próprio script inicia e encerra o coletor.

## Cenário 1: carga de exemplo (consultas lentas)

Representa o uso esperado: limite de 100 ms e consultas lentas executadas pelos protocolos simples
(valores no texto) e estendido (consultas parametrizadas).

```powershell
npm run cenario -- carga 300
```

O script mostra os próximos comandos ao terminar. Por exemplo:

```powershell
docker compose run --rm pgbadger -q -f csv -x json -o /resultados/cenario-carga-AAAAMMDD-HHMM.pgbadger.json /resultados/cenario-carga-AAAAMMDD-HHMM.csv
npm run avaliacao -- resultados/cenario-carga-AAAAMMDD-HHMM.csv --pgbadger resultados/cenario-carga-AAAAMMDD-HHMM.pgbadger.json --tempo-pgbadger 2.31 --cenario "Carga de exemplo, 300 s"
```

Use em `--tempo-pgbadger` o valor mostrado na última linha da saída do pgBadger ("tempo do pgBadger").

## Cenário 2: volume (pgbench com registro de todas as instruções)

O pgbench é a ferramenta de benchmark distribuída com o PostgreSQL. Ele implementa uma carga
inspirada no TPC-B, da mesma família de benchmarks TPC usada em trabalhos relacionados, como o de
Ouyang et al. (2025). Com `log_min_duration_statement = 0`, cada instrução é registrada. No protocolo
estendido, as etapas parse, bind e execute aparecem separadas, o que permite verificar se a
ferramenta contabiliza apenas a execução. Em 30 segundos, o log chega a algumas centenas de MB.

```powershell
npm run cenario -- pgbench 30
docker compose run --rm pgbadger -q -f csv -x json -o /resultados/cenario-pgbench-AAAAMMDD-HHMM.pgbadger.json /resultados/cenario-pgbench-AAAAMMDD-HHMM.csv
npm run avaliacao -- resultados/cenario-pgbench-AAAAMMDD-HHMM.csv --execucoes 3 --pgbadger resultados/cenario-pgbench-AAAAMMDD-HHMM.pgbadger.json --tempo-pgbadger 116.2 --cenario "pgbench, protocolo estendido, registro de todas as instruções, 30 s"
```

A avaliação deste cenário leva alguns minutos, porque o arquivo é processado várias vezes.

## Cenário 3: impacto no servidor monitorado

Mede a vazão (transações por segundo) do servidor monitorado com o pgbench em três configurações:
sem registro de consultas, com registro de todas as instruções e com registro de todas as instruções
e o coletor em execução. Cada configuração é executada 3 vezes.

```powershell
npm run cenario -- impacto 60
```

Leitura dos resultados:

- A diferença entre a primeira e a segunda linha é o custo do próprio log do PostgreSQL.
  Ela não depende da ferramenta e também existiria com o pgBadger.
- A diferença entre a segunda e a terceira linha é o efeito do coletor e do banco da ferramenta.
- Este é o pior caso: todas as instruções são registradas, e o servidor monitorado, o coletor e o
  banco da ferramenta disputam o mesmo computador. No teste de desenvolvimento, em uma máquina
  virtual de 2 núcleos, a vazão caiu entre 23% e 31% com o log completo e cerca de 63% com o coletor.
  Com o limite usual (por exemplo, 100 ms), apenas uma pequena fração das instruções é registrada e
  o efeito tende a ser desprezível. Em produção, a arquitetura permite executar o coletor e o banco
  da ferramenta em outra máquina (seção 4.1).

## Cenário opcional: log de outra origem

Para analisar um log real de outro ambiente, com autorização e sem dados sensíveis, ou um arquivo de
outra pesquisa, o arquivo precisa estar no formato csvlog ou jsonlog e com as mensagens em inglês
(`lc_messages = 'C'`):

```powershell
docker compose run --rm -v C:\caminho\da\pasta:/externo pgbadger -q -f csv -x json -o /resultados/externo.pgbadger.json /externo/postgresql.csv
npm run avaliacao -- C:\caminho\da\pasta\postgresql.csv --pgbadger resultados/externo.pgbadger.json --cenario "Log de ..."
```

## O que levar para o capítulo de resultados

Para cada cenário, o arquivo `resultados/avaliacao-*.md` traz as tabelas prontas:

1. **Caracterização do cenário:** arquivo, tamanho, número de registros e ambiente.
2. **Referência:** registros de duração por etapa (statement, execute, parse e bind).
3. **Acurácia e precisão:** a "Texto idêntico ao log" indica que o texto da consulta foi preservado.
4. **Completude:** por campo.
5. **Tempo de processamento:** mediana e faixa, em segundos, MB/s e ocorrências por segundo.
6. **Sobrecarga:** CPU, memória e armazenamento, e o relatório `resultados/impacto-*.md`.
7. **Comparação com o pgBadger:** contagens, consultas normalizadas e tempo.

O arquivo `.json` correspondente guarda os valores brutos de cada execução.
Os arquivos `resultados/exemplo-*.md` são exemplos gerados no ambiente de desenvolvimento e
mostram o formato esperado. Os números do TC devem vir das execuções no seu computador.
