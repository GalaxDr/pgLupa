export const PERIODOS = {
  "1h": { rotulo: "Última hora", intervalo: "1 hour", bucket: "1 minute" },
  "6h": { rotulo: "Últimas 6 horas", intervalo: "6 hours", bucket: "5 minutes" },
  "24h": { rotulo: "Últimas 24 horas", intervalo: "24 hours", bucket: "15 minutes" },
  "7d": { rotulo: "Últimos 7 dias", intervalo: "7 days", bucket: "2 hours" },
  "30d": { rotulo: "Últimos 30 dias", intervalo: "30 days", bucket: "6 hours" },
  tudo: { rotulo: "Todo o período", intervalo: null, bucket: null },
} as const;

export type Periodo = keyof typeof PERIODOS;

export const ORDENS = {
  total: { rotulo: "Tempo total", coluna: "tempo_total_ms" },
  ocorrencias: { rotulo: "Ocorrências", coluna: "ocorrencias" },
  media: { rotulo: "Tempo médio", coluna: "media_ms" },
  p95: { rotulo: "Percentil 95", coluna: "p95_ms" },
  max: { rotulo: "Tempo máximo", coluna: "max_ms" },
  recente: { rotulo: "Mais recente", coluna: "ultima" },
} as const;

export type Ordem = keyof typeof ORDENS;

export interface Filtros {
  periodo: Periodo;
  servidor: number | null;
  banco: string | null;
  usuario: string | null;
  busca: string | null;
  ordem: Ordem;
}

type Params = Record<string, string | string[] | undefined>;

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;

/** Converte os parâmetros da URL em filtros válidos. */
export function lerFiltros(sp: Params): Filtros {
  const periodo = primeiro(sp.periodo);
  const ordem = primeiro(sp.ordem);
  const servidor = Number(primeiro(sp.servidor));
  return {
    periodo: periodo && periodo in PERIODOS ? (periodo as Periodo) : "24h",
    servidor: Number.isInteger(servidor) && servidor > 0 ? servidor : null,
    banco: primeiro(sp.banco),
    usuario: primeiro(sp.usuario),
    busca: primeiro(sp.busca),
    ordem: ordem && ordem in ORDENS ? (ordem as Ordem) : "total",
  };
}

/** Monta a query string a partir dos filtros, omitindo os valores padrão. */
export function urlComFiltros(base: string, f: Partial<Filtros>, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.periodo && f.periodo !== "24h") p.set("periodo", f.periodo);
  if (f.servidor) p.set("servidor", String(f.servidor));
  if (f.banco) p.set("banco", f.banco);
  if (f.usuario) p.set("usuario", f.usuario);
  if (f.busca) p.set("busca", f.busca);
  if (f.ordem && f.ordem !== "total") p.set("ordem", f.ordem);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}
