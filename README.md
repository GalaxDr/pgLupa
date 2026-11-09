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

**Site:** https://pglupa.yjwxjj.easypanel.host

**Avaliação do TC:** os scripts e os resultados do Capítulo 5 (acurácia, comparação com o pgBadger,
desempenho, impacto no servidor e casos de teste das recomendações) estão no ramo
[`testes`](https://github.com/GalaxDr/slowquery-monitor/tree/testes/testes), na pasta `testes/`, junto
com o servidor PostgreSQL de exemplo usado nos cenários.

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

- Node.js 20.12 ou superior
- Docker (Docker Desktop no Windows) para o banco da ferramenta, ou um PostgreSQL próprio informado
  em `DATABASE_URL`

## Como executar

Sem nenhuma configuração, a ferramenta sobe o seu banco de dados e já analisa arquivos de log enviados
pela página `http://localhost:3000/enviar`. Para acompanhar um servidor continuamente, veja
[Monitorando um servidor PostgreSQL](#monitorando-um-servidor-postgresql).

### Windows

Dê dois cliques em **`iniciar.bat`**. O script confere se o Node.js e o Docker Desktop estão
instalados (e oferece a instalação pelo winget), instala as dependências, sobe o banco da ferramenta,
cria as tabelas e abre o painel no navegador. Se o `.env` informar `LOG_DIR`, abre também o coletor.

### Linux (ou manualmente no Windows)

```sh
npm install
docker compose up -d     # banco da ferramenta (PostgreSQL 18, porta 5433)
npm run db:migrate       # cria as tabelas
npm run dev              # painel em http://localhost:3000
```

Para usar em produção, troque `npm run dev` por `npm run build && npm start`. Com o `.env`
configurado, o coletor roda em outro terminal com `npm run collector`.

> A porta 5433 evita conflito com um PostgreSQL já instalado na máquina, que normalmente usa a 5432.

## Monitorando um servidor PostgreSQL

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

Depois, crie um `.env` na raiz do projeto com o diretório dos logs e, opcionalmente, a conexão para
os snapshots do `pg_stat_statements`:

```ini
SERVIDOR_NOME=producao
# no Windows, por exemplo: C:/Program Files/PostgreSQL/18/data/log
LOG_DIR=/var/lib/postgresql/18/main/log
MONITORADO_URL=postgres://monitor:senha@127.0.0.1:5432/banco
```

O coletor precisa de permissão de leitura nesse diretório. No Linux, o mais simples é definir
`log_file_mode = 0640` no `postgresql.conf` e incluir o usuário que executa o coletor no grupo
`postgres` (`sudo usermod -aG postgres $USER`). Para os snapshots, crie um usuário com o papel
`pg_read_all_stats`:

```sql
CREATE EXTENSION pg_stat_statements;
CREATE ROLE monitor LOGIN PASSWORD '...';
GRANT pg_read_all_stats TO monitor;
```

Os logs podem conter dados pessoais nos valores das consultas (nomes, e-mails, documentos). Com
`ANONIMIZAR_VALORES=true`, o coletor grava apenas o texto normalizado, com os valores trocados por
`$1`, `$2`... No site, a mesma opção aparece na página de envio e vem marcada por padrão.

## Configuração

Todas as variáveis são opcionais e lidas em um único lugar, `src/lib/config.ts`. Os valores padrão
permitem usar a ferramenta sem `.env`; para o coletor, basta informar `LOG_DIR`.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | banco `ferramenta` do docker compose | Conexão com o banco da ferramenta |
| `SERVIDOR_NOME` | `local` | Nome do servidor monitorado no painel |
| `LOG_DIR` | | Diretório dos arquivos de log (necessário para o coletor) |
| `LOG_FORMAT` | pela extensão dos arquivos | `csvlog` ou `jsonlog` |
| `MONITORADO_URL` | | Conexão para os snapshots do `pg_stat_statements` (opcional) |
| `ANONIMIZAR_VALORES` | `false` | Grava apenas o texto normalizado, sem os valores |
| `RETENCAO_DIAS` | `30` | Dias até as ocorrências e os snapshots serem removidos (0 = nunca) |
| `INTERVALO_LEITURA_MS` / `INTERVALO_SNAPSHOT_MS` | `2000` / `60000` | Intervalos do coletor |
| `MODO` | | `hospedado` para o site público: apenas o envio de arquivos e os relatórios |
| `MAX_UPLOAD_MB` | `1024` | Tamanho máximo do arquivo enviado pelo site |
| `RETENCAO_ANALISE_HORAS` | `72` | Tempo até cada relatório enviado ser apagado |

## Publicação do site

O `Dockerfile` gera a imagem da aplicação web, que pode ser publicada em qualquer serviço com Docker
(Easypanel, Coolify, uma VPS etc.). É necessário um PostgreSQL para o banco da ferramenta, e as tabelas
são criadas na primeira inicialização. Basta definir `DATABASE_URL` e `MODO=hospedado` (veja a
seção Configuração).

Monte um volume em `/data/uploads`, onde os arquivos ficam enquanto são processados, e a aplicação
escuta na porta 3000. Se houver um proxy na frente, ajuste o limite de tamanho do corpo da requisição
para o mesmo valor de `MAX_UPLOAD_MB`.

## Estrutura

```
collector/            coletor (leitura incremental, interpretação do log, snapshots, retenção)
db/migrations/        esquema do banco da ferramenta
scripts/              migração do banco
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
npm test      # testes automatizados do coletor, da normalização, do diagnóstico e da anonimização
```

A avaliação do TC fica no ramo `testes` (link no início deste arquivo).
