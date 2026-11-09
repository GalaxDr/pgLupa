-- Executado apenas na primeira inicialização do servidor monitorado.

-- Extensão de estatísticas agregadas por consulta.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Usuário somente leitura usado pelo coletor para ler o pg_stat_statements.
-- O papel pg_read_all_stats permite ver o texto e as estatísticas de todas as consultas.
CREATE ROLE monitor LOGIN PASSWORD 'monitor';
GRANT pg_read_all_stats TO monitor;
GRANT CONNECT ON DATABASE loja TO monitor;

-- Esquema de exemplo usado pelo gerador de carga (npm run carga).
CREATE TABLE cliente (
  id        serial PRIMARY KEY,
  nome      text NOT NULL,
  email     text NOT NULL,
  cidade    text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE produto (
  id        serial PRIMARY KEY,
  nome      text NOT NULL,
  categoria text NOT NULL,
  preco     numeric(10,2) NOT NULL
);

CREATE TABLE pedido (
  id         serial PRIMARY KEY,
  cliente_id int NOT NULL REFERENCES cliente(id),
  status     text NOT NULL,
  criado_em  timestamptz NOT NULL
);

CREATE TABLE item_pedido (
  pedido_id  int NOT NULL REFERENCES pedido(id),
  produto_id int NOT NULL REFERENCES produto(id),
  quantidade int NOT NULL,
  preco      numeric(10,2) NOT NULL
);

-- Propositalmente sem índices em pedido.cliente_id, pedido.criado_em e
-- item_pedido.pedido_id, para que parte das consultas da carga seja lenta.
INSERT INTO cliente (nome, email, cidade)
SELECT 'Cliente ' || g, 'cliente' || g || '@exemplo.com',
       (ARRAY['Santa Cruz do Sul','Porto Alegre','Venâncio Aires','Lajeado','Caxias do Sul'])[1 + g % 5]
FROM generate_series(1, 50000) g;

INSERT INTO produto (nome, categoria, preco)
SELECT 'Produto ' || g, (ARRAY['eletrônicos','livros','casa','esporte','moda'])[1 + g % 5],
       round((random() * 500 + 5)::numeric, 2)
FROM generate_series(1, 2000) g;

INSERT INTO pedido (cliente_id, status, criado_em)
SELECT 1 + (random() * 49999)::int,
       (ARRAY['aberto','pago','enviado','entregue','cancelado'])[1 + g % 5],
       now() - random() * interval '365 days'
FROM generate_series(1, 400000) g;

INSERT INTO item_pedido (pedido_id, produto_id, quantidade, preco)
SELECT 1 + (random() * 399999)::int, 1 + (random() * 1999)::int,
       1 + (random() * 4)::int, round((random() * 500 + 5)::numeric, 2)
FROM generate_series(1, 1200000) g;

ANALYZE;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO monitor;
