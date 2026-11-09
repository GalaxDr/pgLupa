import Link from "next/link";
import { Cartao } from "@/components/Cartao";
import { Sql } from "@/components/Sql";
import type { LinhaConsulta } from "@/lib/consultas";
import { urlComFiltros, type Filtros } from "@/lib/filtros";
import { formatarDuracao } from "@/lib/formato";
import { diagnosticar, principal, type Recomendacao, type Severidade } from "@/lib/recomendacoes";

const ESTILO: Record<Severidade, { rotulo: string; selo: string; borda: string }> = {
  alta: { rotulo: "Alta", selo: "bg-orange-100 text-orange-800", borda: "border-l-orange-500" },
  media: { rotulo: "Média", selo: "bg-amber-50 text-amber-800", borda: "border-l-amber-400" },
  baixa: { rotulo: "Baixa", selo: "bg-zinc-100 text-zinc-600", borda: "border-l-zinc-300" },
  verificacao: { rotulo: "Verificação", selo: "bg-destaque-claro text-destaque", borda: "border-l-destaque" },
};

function Selo({ severidade }: { severidade: Severidade }) {
  const e = ESTILO[severidade];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${e.selo}`}>{e.rotulo}</span>;
}

const DESCRICAO =
  "Geradas a partir do texto da consulta e das estatísticas das ocorrências. O log não contém o plano de execução: confirme no EXPLAIN antes de aplicar.";

/** Diagnóstico completo de uma consulta. */
export function ListaRecomendacoes({ itens }: { itens: Recomendacao[] }) {
  return (
    <Cartao titulo="Diagnóstico e recomendações" descricao={DESCRICAO}>
      <ul className="flex flex-col gap-3">
        {itens.map((r) => (
          <li key={r.id} className={`rounded-md border border-l-4 border-zinc-200 ${ESTILO[r.severidade].borda} bg-white px-4 py-3`}>
            <div className="flex items-start gap-2">
              <Selo severidade={r.severidade} />
              <h3 className="text-sm font-semibold text-zinc-900">{r.titulo}</h3>
            </div>
            <p className="mt-1.5 text-sm text-zinc-600">{r.evidencia}</p>
            <p className="mt-1.5 text-sm text-zinc-800">
              <span className="font-medium">{r.severidade === "verificacao" ? "Como fazer: " : "Como resolver: "}</span>
              {r.acao}
            </p>
            {r.sql && (
              <div className="mt-2 rounded-md bg-zinc-50 px-3 py-2">
                <Sql texto={r.sql} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Cartao>
  );
}

/**
 * Recomendação principal das consultas de maior tempo total, para a visão geral e o relatório
 * de uma análise enviada.
 */
export function RecomendacoesPrioritarias({
  linhas,
  tempoTotalMs,
  exemplos,
  filtros,
  base = "/consultas",
}: {
  linhas: LinhaConsulta[];
  tempoTotalMs: number;
  exemplos: Map<number, string>;
  filtros: Filtros;
  base?: string;
}) {
  const itens = linhas
    .map((l) => {
      const duracao = (new Date(l.ultima).getTime() - new Date(l.primeira).getTime()) / 1000;
      const participacao = tempoTotalMs > 0 ? l.tempo_total_ms / tempoTotalMs : null;
      const recs = diagnosticar({
        texto: l.texto_normalizado,
        exemplo: exemplos.get(l.id) ?? null,
        ocorrencias: l.ocorrencias,
        tempo_total_ms: l.tempo_total_ms,
        media_ms: l.media_ms,
        mediana_ms: l.mediana_ms,
        p95_ms: l.p95_ms,
        max_ms: l.max_ms,
        participacao,
        duracao_periodo_s: duracao,
      });
      return { linha: l, participacao, rec: principal(recs) };
    })
    .filter((i) => i.rec);
  if (itens.length === 0) return null;

  return (
    <Cartao
      titulo="Recomendações prioritárias"
      descricao="Principal ponto de melhoria das consultas que mais consomem tempo. Abra a consulta para ver o diagnóstico completo e os comandos sugeridos."
    >
      <ul className="flex flex-col divide-y divide-zinc-100">
        {itens.map(({ linha, participacao, rec }) => (
          <li key={linha.id} className="py-3 first:pt-0 last:pb-0">
            <Link
              href={urlComFiltros(`${base}/${linha.id}`, {
                ...filtros,
                servidor: base === "/consultas" ? filtros.servidor : null,
                periodo: base === "/consultas" ? filtros.periodo : undefined,
                ordem: undefined,
                busca: undefined,
              })}
              className="group block"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Selo severidade={rec!.severidade} />
                <span className="text-sm font-semibold text-zinc-900 group-hover:text-destaque">{rec!.titulo}</span>
                <span className="text-xs text-zinc-500">
                  Consulta #{linha.id}
                  {participacao !== null && ` · ${(participacao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% do tempo total`}
                  {` · ${formatarDuracao(linha.tempo_total_ms)}`}
                </span>
              </div>
              <code className="mt-1 block truncate font-mono text-xs text-zinc-500">{linha.texto_normalizado}</code>
              <p className="mt-1 text-sm text-zinc-600">{rec!.evidencia}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}
