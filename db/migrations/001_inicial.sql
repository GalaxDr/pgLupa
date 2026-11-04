-- Modelo de armazenamento da ferramenta (Figura 3 do TC).

-- Instância PostgreSQL monitorada.
CREATE TABLE servidor (
  id             serial PRIMARY KEY,
  nome           text NOT NULL UNIQUE,
  diretorio_logs text NOT NULL,
  formato_log    text NOT NULL CHECK (formato_log IN ('csvlog', 'jsonlog')),
  ativo          boolean NOT NULL DEFAULT true
);

-- Estado da leitura incremental de cada arquivo de log.
CREATE TABLE arquivo_log (
  id            serial PRIMARY KEY,
  servidor_id   int NOT NULL REFERENCES servidor(id) ON DELETE CASCADE,
  nome_arquivo  text NOT NULL,
  posicao_lida  bigint NOT NULL DEFAULT 0,
  tamanho       bigint NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (servidor_id, nome_arquivo)
);

-- Consulta normalizada: agrupa as execuções equivalentes.
CREATE TABLE consulta (
  id                  bigserial PRIMARY KEY,
  query_id            bigint,
  fingerprint         text NOT NULL UNIQUE,
  texto_normalizado   text NOT NULL,
  primeira_ocorrencia timestamptz NOT NULL,
  ultima_ocorrencia   timestamptz NOT NULL
);
CREATE INDEX consulta_query_id_idx ON consulta (query_id);

-- Cada registro do log de consultas lentas.
CREATE TABLE ocorrencia (
  id              bigserial PRIMARY KEY,
  consulta_id     bigint NOT NULL REFERENCES consulta(id) ON DELETE CASCADE,
  servidor_id     int NOT NULL REFERENCES servidor(id) ON DELETE CASCADE,
  data_hora       timestamptz NOT NULL,
  duracao_ms      numeric(14,3) NOT NULL,
  banco           text,
  usuario         text,
  aplicacao       text,
  host_cliente    text,
  pid             int,
  texto_executado text NOT NULL
);
CREATE INDEX ocorrencia_data_hora_idx ON ocorrencia (data_hora);
CREATE INDEX ocorrencia_consulta_data_idx ON ocorrencia (consulta_id, data_hora);

-- Registros periódicos do pg_stat_statements (valores acumulados).
CREATE TABLE snapshot_estatistica (
  id               bigserial PRIMARY KEY,
  servidor_id      int NOT NULL REFERENCES servidor(id) ON DELETE CASCADE,
  coletado_em      timestamptz NOT NULL,
  query_id         bigint NOT NULL,
  calls            bigint NOT NULL,
  total_exec_time  double precision NOT NULL,
  mean_exec_time   double precision NOT NULL,
  rows             bigint NOT NULL,
  shared_blks_hit  bigint NOT NULL,
  shared_blks_read bigint NOT NULL
);
CREATE INDEX snapshot_query_coletado_idx ON snapshot_estatistica (query_id, coletado_em DESC);
CREATE INDEX snapshot_servidor_coletado_idx ON snapshot_estatistica (servidor_id, coletado_em DESC);
