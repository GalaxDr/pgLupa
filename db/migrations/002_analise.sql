-- Análises de arquivos de log enviados pelo site (modo hospedado).
-- Cada análise tem um servidor próprio (inativo), ao qual pertencem as suas ocorrências;
-- ao excluir o servidor, a análise e as ocorrências são removidas em cascata.
CREATE TABLE analise (
  id            uuid PRIMARY KEY,
  servidor_id   int NOT NULL UNIQUE REFERENCES servidor(id) ON DELETE CASCADE,
  nome_arquivo  text NOT NULL,
  formato_log   text NOT NULL CHECK (formato_log IN ('csvlog', 'jsonlog')),
  tamanho       bigint NOT NULL DEFAULT 0,
  situacao      text NOT NULL DEFAULT 'recebendo'
                CHECK (situacao IN ('recebendo', 'na_fila', 'processando', 'concluida', 'erro')),
  mensagem_erro text,
  ocorrencias   int NOT NULL DEFAULT 0,
  criada_em     timestamptz NOT NULL DEFAULT now(),
  concluida_em  timestamptz,
  expira_em     timestamptz NOT NULL
);
CREATE INDEX analise_expira_idx ON analise (expira_em);

-- consultas normalizadas sem ocorrências (após exclusões) são removidas pela rotina de retenção
CREATE INDEX ocorrencia_consulta_idx ON ocorrencia (consulta_id);
