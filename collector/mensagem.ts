/**
 * Interpretação da mensagem gerada por log_min_duration_statement.
 *
 *   protocolo simples:   "duration: 1523.402 ms  statement: SELECT ..."
 *   protocolo estendido: "duration: 1523.402 ms  parse <unnamed>: SELECT ..."
 *                        "duration: 1523.402 ms  bind <unnamed>: SELECT ..."
 *                        "duration: 1523.402 ms  execute <unnamed>: SELECT ..."
 *
 * No protocolo estendido as etapas são registradas separadamente; apenas a execução
 * é considerada, para que a mesma consulta não seja contabilizada mais de uma vez.
 * As mensagens precisam estar em inglês (lc_messages = 'C').
 */
const RE_DURACAO = /^duration: ([\d.]+) ms\s+(statement|execute|parse|bind)([^:]*):\s([\s\S]*)$/;

interface ConsultaLenta {
  duracaoMs: number;
  etapa: "statement" | "execute";
  sql: string;
}

export function interpretarMensagem(mensagem: string): ConsultaLenta | null {
  const m = RE_DURACAO.exec(mensagem);
  if (!m) return null;
  const etapa = m[2];
  if (etapa !== "statement" && etapa !== "execute") return null;
  const sql = m[4].trim();
  if (!sql) return null;
  return { duracaoMs: Number(m[1]), etapa, sql };
}

/**
 * Substitui $1, $2, ... pelos valores informados no campo de detalhe
 * ("Parameters: $1 = '10', $2 = 'abc'"), reconstruindo o texto efetivamente executado.
 */
export function aplicarParametros(sql: string, detalhe: string | null): string {
  if (!detalhe) return sql;
  const m = detalhe.match(/parameters: ([\s\S]*)$/i);
  if (!m) return sql;
  const valores = new Map<string, string>();
  const re = /\$(\d+) = (NULL|'(?:[^']|'')*')/g;
  let p: RegExpExecArray | null;
  while ((p = re.exec(m[1])) !== null) valores.set(p[1], p[2]);
  if (valores.size === 0) return sql;
  return sql.replace(/\$(\d+)(?!\d)/g, (orig, num: string) => valores.get(num) ?? orig);
}
