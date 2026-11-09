# pgLupa: monitor de queries lentas para PostgreSQL

Ferramenta desenvolvida no Trabalho de Conclusão de Curso de Engenharia de Computação (UNISC):
*Desenvolvimento de uma ferramenta para monitoramento de queries lentas em PostgreSQL*.

A ferramenta lê o log de consultas lentas do PostgreSQL (`log_min_duration_statement`, nos formatos
`csvlog` ou `jsonlog`), converte cada ocorrência em um registro estruturado, agrupa as execuções
equivalentes pela consulta normalizada e as apresenta em um painel web com indicadores, gráficos e
filtros. As ocorrências são associadas às estatísticas do `pg_stat_statements` pelo `query_id`.

A ferramenta funciona de dois modos:

- **Modo hospedado (site):** a pessoa envia o arquivo de log pelo navegador e recebe um relatório
  interativo em um link exclusivo, que expira após alguns dias. Veja [Publicação do site](#publicação-do-site).
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
- **Diagnóstico** (`src/lib/recomendacoes.ts`): regras que combinam o texto da consulta (curingas no
  LIKE, funções sobre colunas do filtro, OFFSET alto, NOT IN, subconsultas por linha, filtros sem
  índice, entre outros), as estatísticas das ocorrências (participação no tempo total, frequência,
  variabilidade e tendência) e os contadores do `pg_stat_statements` (blocos lidos, acerto do cache,
  linhas por execução) para sugerir como resolver a lentidão, com os comandos SQL correspondentes.
- **Aplicação web** (`src/app/`): Next.js 16 com App Router. Os Server Components consultam o banco
  diretamente; os Route Handlers em `/api` expõem os mesmos dados em JSON.
- **Banco da ferramenta** (`db/migrations/`): tabelas `servidor`, `arquivo_log`, `consulta`,
  `ocorrencia`, `snapshot_estatistica` e `analise` (arquivos enviados pelo site). As migrações são
  aplicadas automaticamente quando a aplicação inicia. O percentil 95 é calculado no banco com `percentile_cont`.
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

Os logs podem conter dados pessoais nos valores das consultas (nomes, e-mails, documentos). Com
`ANONIMIZAR_VALORES=true`, o coletor grava apenas o texto normalizado, com os valores trocados por
`$1`, `$2`... No site, a mesma opção aparece na página de envio e vem marcada por padrão.

## Publicação do site

O `Dockerfile` gera a imagem da aplicação web, que pode ser publicada em qualquer serviço com Docker
(Easypanel, Coolify, uma VPS etc.). É necessário um PostgreSQL para o banco da ferramenta, e as tabelas
são criadas na primeira inicialização. Variáveis de ambiente da aplicação:

| Variável | Descrição |
| --- | --- |
| `DATABASE_URL` | Conexão com o banco da ferramenta |
| `MODO` | `hospedado` para o site público: mostra apenas o envio de arquivos e os relatórios de cada análise |
| `MAX_UPLOAD_MB` | Tamanho máximo do arquivo enviado (padrão 1024) |
| `RETENCAO_ANALISE_HORAS` | Tempo até cada relatório ser apagado (padrão 72) |

Monte um volume em `/data/uploads`, onde os arquivos ficam enquanto são processados, e a aplicação
escuta na porta 3000. Se houver um proxy na frente, ajuste o limite de tamanho do corpo da requisição
para o mesmo valor de `MAX_UPLOAD_MB`.

## Estrutura

```
collector/            coletor (leitura incremental, interpretação do log, snapshots, retenção)
db/migrations/        esquema do banco da ferramenta
docker/               configuração do ambiente de exemplo
scripts/              migração do banco e gerador de carga de exemplo
src/app/              páginas (visão geral, consultas, detalhe, coletor, envio e análises) e rotas de API
src/components/       componentes de interface e gráficos
src/lib/              acesso ao banco, consultas do painel, normalização, envio de arquivos e formatação
tests/                testes automatizados (npm test)
```

## API

| Rota | Descrição |
| --- | --- |
| `GET /api/consultas` | Resumo do período e consultas agrupadas. Parâmetros: `periodo` (`1h`, `6h`, `24h`, `7d`, `30d`, `tudo`), `servidor`, `banco`, `usuario`, `busca`, `ordem` (`total`, `ocorrencias`, `media`, `p95`, `max`, `recente`), `limite` |
| `GET /api/serie` | Ocorrências e percentil 95 por intervalo de tempo. Mesmos filtros, mais `consulta` (id) |
| `POST /api/analises` | Envio de um arquivo de log (corpo da requisição, `.gz` aceito; parâmetro `nome`). Retorna o id da análise |
| `GET /api/analises/{id}` | Situação do processamento de uma análise |

## Testes

```powershell
npm test      # testes automatizados do coletor e da normalização
```

Os scripts usados na avaliação do TC (acurácia, completude, tempo, sobrecarga e comparação com o
pgBadger) estão no branch [`avaliacao-tc`](../../tree/avaliacao-tc).
