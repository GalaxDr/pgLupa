-- Análises em que os valores das consultas não são armazenados: o texto executado de cada
-- ocorrência é substituído pelo texto normalizado (valores trocados por $1, $2...).
ALTER TABLE analise ADD COLUMN anonimizada boolean NOT NULL DEFAULT false;
