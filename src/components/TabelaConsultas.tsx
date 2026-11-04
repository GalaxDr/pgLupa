import Link from "next/link";
import type { LinhaConsulta } from "@/lib/consultas";
import { formatarDataHora, formatarDuracao, formatarNumero } from "@/lib/formato";
import { urlComFiltros, type Filtros } from "@/lib/filtros";

export function TabelaConsultas({
  linhas,
  filtros,
  compacta = false,
  base = "/consultas",
}: {
  linhas: LinhaConsulta[];
  filtros: Filtros;
  compacta?: boolean;
  /** caminho base do detalhe da consulta (ex.: /analises/<id>/consultas) */
  base?: string;
}) {
  const totalGeral = linhas.reduce((s, l) => s + l.tempo_total_ms, 0) || 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs font-medium text-zinc-500">
            <th className="py-2 pr-4 font-medium">Consulta</th>
            <th className="px-3 py-2 text-right font-medium">Ocorrências</th>
            <th className="px-3 py-2 text-right font-medium">Tempo total</th>
            <th className="px-3 py-2 text-right font-medium">Médio</th>
            <th className="px-3 py-2 text-right font-medium">P95</th>
            {!compacta && <th className="px-3 py-2 text-right font-medium">Máximo</th>}
            {!compacta && <th className="py-2 pl-3 text-right font-medium">Última</th>}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} className="group border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
              <td className="max-w-0 py-2.5 pr-4" style={{ width: "50%" }}>
                <Link href={urlComFiltros(`${base}/${l.id}`, { ...filtros, servidor: base === "/consultas" ? filtros.servidor : null, periodo: base === "/consultas" ? filtros.periodo : undefined, ordem: undefined, busca: undefined })} className="block">
                  <code className="block truncate font-mono text-[13px] text-zinc-800 group-hover:text-destaque">{l.texto_normalizado}</code>
                  <div className="mt-1.5 h-1 w-full rounded-full bg-zinc-100">
                    <div className="h-1 rounded-full bg-destaque/70" style={{ width: `${Math.max(1, (l.tempo_total_ms / totalGeral) * 100)}%` }} />
                  </div>
                </Link>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarNumero(l.ocorrencias)}</td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatarDuracao(l.tempo_total_ms)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarDuracao(l.media_ms)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarDuracao(l.p95_ms)}</td>
              {!compacta && <td className="px-3 py-2.5 text-right tabular-nums">{formatarDuracao(l.max_ms)}</td>}
              {!compacta && <td className="whitespace-nowrap py-2.5 pl-3 text-right text-xs text-zinc-500">{formatarDataHora(l.ultima)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
