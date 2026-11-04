# Monitor de queries lentas para PostgreSQL

Ferramenta desenvolvida no Trabalho de Conclusão de Curso de Engenharia de Computação (UNISC):
*Desenvolvimento de uma ferramenta para monitoramento de queries lentas em PostgreSQL*.

A ferramenta lê o log de consultas lentas do PostgreSQL (`log_min_duration_statement`, nos formatos
`csvlog` ou `jsonlog`), converte cada ocorrência em um registro estruturado, agrupa as execuções
equivalentes pela consulta normalizada e as apresenta em um painel web com indicadores, gráficos e
filtros. As ocorrências são associadas às estatísticas do `pg_stat_statements` pelo `query_id`.

A ferramenta funciona de dois modos:

- **Modo hospedado (site):** a pessoa envia o arquivo de log pelo navegador e recebe um relatório
  interativo em um link exclusivo, que expira após alguns dias. Guia de publicação na VPS da Oracle:
  [docs/publicacao-oracle.md](docs/publicacao-oracle.md).
- **Modo local (contínuo):** o coletor acompanha os arquivos de log de um servidor e o painel mostra as
  ocorrências em tempo real, com o histórico e os dados do `pg_stat_statements`. O envio de arquivos
  também está disponível em `/enviar`.

## Arquitetura

```
 PostgreSQL monitorado ──(arquivos csvlog/jsonlog)──▶ Coletor (Node.js) ──▶ PostgreSQL da ferramenta ◀── Aplicação web (Next.js)
          │                                               ▲
          └────────(pg_stat_statements, somente leitura)──┘
```

- **Coletor** (`collector/`): processo contínuo e independente. Lê os arquivos de log de forma
  incremental, guardando a posição já processada de cada arquivo; trata a rotação com
  `log_truncate_on_rotation`; considera apenas a etapa de execução no protocolo estendido
  (ignorando `parse` e `bind`); reconstrói o texto executado com os valores dos parâmetros; registra
  snapshots periódicos do `pg_stat_statements`; e remove dados antigos conforme a retenção.
- **Envio de arquivos** (`src/lib/analises.ts`): recebe o arquivo por streaming (aceita `.gz`), processa
  em fila com o mesmo leitor do coletor, apaga o arquivo ao final e remove as análises expiradas.
- **Aplicação web** (`src/app/`): Next.js 16 com App Router. Os Server Components consultam o banco
  diretamente; os Route Handlers em `/api` expõem os mesmos dados em JSON.
- **Banco da ferramenta** (`db/migrations/`): tabelas `servidor`, `arquivo_log`, `consulta`,
  `ocorrencia` e `snapshot_estatistica`. O percentil 95 é calculado no banco com `percentile_cont`.
- **Código compartilhado** (`src/lib/`): acesso ao banco e normalização das consultas, usados pelo
  coletor e pela aplicação web.

## Requisitos

- Node.js 20.6 ou superior
- Docker Desktop (para o ambiente de exemplo com PostgreSQL 18)

## Como executar (Windows)

O jeito mais simples é dar dois cliques em **`iniciar.bat`**. O script confere se o Node.js e o Docker
Desktop estão instalados (e oferece a instalação pelo winget), instala as dependências, sobe os
bancos, cria as tabelas e abre o coletor, o painel e o navegador.

Para fazer manualmente, no PowerShell:

```powershell
npm install
Copy-Item .env.example .env

# sobe o PostgreSQL monitorado (porta 5434) e o da ferramenta (porta 5433);
# na primeira vez, o servidor monitorado cria um banco de exemplo com cerca de 1,6 milhão de linhas
docker compose up -d

# cria as tabelas no banco da ferramenta
npm run db:migrate
```

Depois, em três terminais:

```powershell
npm run collector     # 1. coletor: acompanha docker/logs e grava as ocorrências
npm run dev           # 2. painel: http://localhost:3000
npm run carga         # 3. opcional: gera consultas lentas no servidor de exemplo por 60 s (npm run carga -- 300 para 5 min)
```

> As portas 5434 e 5433 foram escolhidas para não conflitar com um PostgreSQL instalado no
> Windows, que normalmente usa a 5432.

## Monitorando outro servidor PostgreSQL

No `postgresql.conf` do servidor a ser monitorado:

```ini
logging_collector = on
log_destination = 'csvlog'              # ou 'jsonlog'
log_min_duration_statement = 200        # limite, em ms, para registrar a consulta
log_filename = 'postgresql-%a.log'      # um arquivo por dia da semana
log_rotation_age = 1d
log_rotation_size = 0
log_truncate_on_rotation = on
lc_messages = 'C'                       # mensagens em inglês, interpretadas pelo coletor
compute_query_id = on                   # query_id no log, para associar ao pg_stat_statements
shared_preload_libraries = 'pg_stat_statements'
```

No `.env`, aponte `LOG_DIR` para o diretório dos logs (o coletor precisa de permissão de leitura),
ajuste `LOG_FORMAT` e, para os snapshots, informe em `MONITORADO_URL` um usuário com o papel
`pg_read_all_stats`:

```sql
CREATE EXTENSION pg_stat_statements;
CREATE ROLE monitor LOGIN PASSWORD '...';
GRANT pg_read_all_stats TO monitor;
```

## Estrutura

```
collector/            coletor (leitura incremental, interpretação do log, snapshots, retenção)
db/migrations/        esquema do banco da ferramenta
docker/               configuração do ambiente de exemplo
scripts/              migração do banco, gerador de carga, cenários e avaliação
docs/                 roteiro de validação
resultados/           relatórios gerados pela avaliação
src/app/              páginas (visão geral, consultas, detalhe, coletor) e rotas de API
src/components/       componentes de interface e gráficos
src/lib/              acesso ao banco, consultas do painel, normalização e formatação
tests/                testes automatizados (npm test)
```

## API

| Rota | Descrição |
| --- | --- |
| `GET /api/consultas` | Resumo do período e consultas agrupadas. Parâmetros: `periodo` (`1h`, `6h`, `24h`, `7d`, `30d`, `tudo`), `servidor`, `banco`, `usuario`, `busca`, `ordem` (`total`, `ocorrencias`, `media`, `p95`, `max`, `recente`), `limite` |
| `GET /api/serie` | Ocorrências e percentil 95 por intervalo de tempo. Mesmos filtros, mais `consulta` (id) |

## Testes e avaliação

```powershell
npm test                                  # testes automatizados do coletor e da normalização
npm run cenario -- <carga|pgbench|impacto> # cenários de avaliação no servidor de exemplo
npm run avaliacao -- <arquivo de log>      # acurácia, completude, tempo, sobrecarga e comparação com o pgBadger
```

O passo a passo da validação está em [docs/roteiro-validacao.md](docs/roteiro-validacao.md).
