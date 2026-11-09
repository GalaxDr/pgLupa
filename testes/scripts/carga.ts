/**
 * Gerador de carga para o servidor de exemplo (testes/docker-compose.yml).
 * Executa uma mistura de consultas rápidas e lentas, pelo protocolo simples (valores
 * literais no texto) e pelo protocolo estendido (consultas parametrizadas).
 *
 *   npm run carga            (60 segundos)
 *   npm run carga -- 300     (300 segundos)
 */
import { cargaUrl } from "./ambiente";
import { Pool } from "pg";

const segundos = Number(process.argv[2] ?? 60);
const pool = new Pool({
  connectionString: cargaUrl,
  max: 4,
  application_name: "carga-exemplo",
});

const aleatorio = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const cidades = ["Santa Cruz do Sul", "Porto Alegre", "Venâncio Aires", "Lajeado", "Caxias do Sul"];

type Operacao = { peso: number; executar: () => Promise<unknown> };

const operacoes: Operacao[] = [
  // rápida: busca pela chave primária
  { peso: 30, executar: () => pool.query("SELECT * FROM cliente WHERE id = $1", [aleatorio(1, 50000)]) },
  // lenta: pedidos de um cliente sem índice em pedido.cliente_id (literal no texto)
  {
    peso: 15,
    executar: () =>
      pool.query(`SELECT id, status, criado_em FROM pedido WHERE cliente_id = ${aleatorio(1, 50000)} ORDER BY criado_em DESC LIMIT 20`),
  },
  // lenta: total de um cliente, varrendo item_pedido (parametrizada)
  {
    peso: 10,
    executar: () =>
      pool.query(
        `SELECT p.id, sum(i.quantidade * i.preco) AS total
         FROM pedido p JOIN item_pedido i ON i.pedido_id = p.id
         WHERE p.cliente_id = $1 GROUP BY p.id`,
        [aleatorio(1, 50000)],
      ),
  },
  // muito lenta: relatório de faturamento por cidade
  {
    peso: 3,
    executar: () =>
      pool.query(
        `SELECT c.cidade, count(DISTINCT p.id) AS pedidos, sum(i.quantidade * i.preco) AS faturamento
         FROM pedido p
         JOIN item_pedido i ON i.pedido_id = p.id
         JOIN cliente c ON c.id = p.cliente_id
         WHERE p.criado_em >= now() - interval '${aleatorio(30, 180)} days'
         GROUP BY c.cidade ORDER BY faturamento DESC`,
      ),
  },
  // lenta: lista de produtos de tamanho variável (testa o agrupamento de listas IN)
  {
    peso: 8,
    executar: () => {
      const ids = Array.from({ length: aleatorio(2, 12) }, () => aleatorio(1, 2000));
      return pool.query(`SELECT produto_id, sum(quantidade) FROM item_pedido WHERE produto_id IN (${ids.join(", ")}) GROUP BY produto_id`);
    },
  },
  // lenta: filtro por cidade com LIKE
  {
    peso: 6,
    executar: () =>
      pool.query("SELECT count(*) FROM cliente c JOIN pedido p ON p.cliente_id = c.id WHERE c.cidade = $1 AND p.status = $2", [
        cidades[aleatorio(0, 4)],
        "cancelado",
      ]),
  },
  // escrita lenta: atualização sem índice
  {
    peso: 4,
    executar: () =>
      pool.query(`UPDATE pedido SET status = 'enviado' WHERE status = 'pago' AND cliente_id = ${aleatorio(1, 50000)}`),
  },
  // intermitente: simula espera por bloqueio ou recurso externo
  { peso: 2, executar: () => pool.query("SELECT pg_sleep($1)", [Math.random() * 0.8 + 0.1]) },
];

const pesoTotal = operacoes.reduce((s, o) => s + o.peso, 0);
function sortear(): Operacao {
  let r = Math.random() * pesoTotal;
  for (const o of operacoes) {
    r -= o.peso;
    if (r <= 0) return o;
  }
  return operacoes[0];
}

async function trabalhador(fim: number, contador: { n: number }) {
  while (Date.now() < fim) {
    try {
      await sortear().executar();
      contador.n++;
    } catch (e) {
      console.error((e as Error).message);
    }
    await new Promise((r) => setTimeout(r, aleatorio(20, 200)));
  }
}

async function main() {
  console.log(`gerando carga por ${segundos} s...`);
  const fim = Date.now() + segundos * 1000;
  const contador = { n: 0 };
  const t = setInterval(() => console.log(`${contador.n} consultas executadas`), 10000);
  await Promise.all(Array.from({ length: 4 }, () => trabalhador(fim, contador)));
  clearInterval(t);
  console.log(`concluído: ${contador.n} consultas executadas`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
