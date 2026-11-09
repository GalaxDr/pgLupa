/**
 * Ambiente dos testes: servidor PostgreSQL de exemplo de testes/docker-compose.yml.
 * Importado antes de qualquer outro módulo, define os valores usados pelos scripts e pelo coletor
 * quando não houver outros no .env.
 */
import "../../src/lib/config"; // carrega o .env, se existir

process.env.SERVIDOR_NOME ??= "exemplo";
process.env.LOG_DIR ??= "./testes/logs";
process.env.MONITORADO_URL ??= "postgres://monitor:monitor@127.0.0.1:5434/loja";

/** superusuário do servidor de exemplo (gerador de carga, pgbench e casos de teste) */
export const cargaUrl = process.env.CARGA_URL ?? "postgres://postgres:postgres@127.0.0.1:5434/loja";
