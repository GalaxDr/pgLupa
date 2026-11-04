"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PontoDuracao, PontoSerie } from "@/lib/consultas";
import { formatarDuracao, formatarNumero } from "@/lib/formato";

const COR_BARRA = "#0f766e";
const COR_LINHA = "#c2410c";
const COR_GRADE = "#e4e4e7";
const COR_EIXO = "#71717a";

function formatadorInstante(inicio: number, fim: number) {
  const longo = fim - inicio > 36 * 3600 * 1000;
  const f = new Intl.DateTimeFormat("pt-BR", longo ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
  return (v: number | string) => f.format(new Date(v));
}

const dataCompleta = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" });

function CaixaDica({ titulo, linhas }: { titulo: string; linhas: { cor: string; rotulo: string; valor: string }[] }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-zinc-900">{titulo}</div>
      {linhas.map((l) => (
        <div key={l.rotulo} className="flex items-center gap-2 text-zinc-600">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.cor }} />
          <span>{l.rotulo}:</span>
          <span className="font-medium tabular-nums text-zinc-900">{l.valor}</span>
        </div>
      ))}
    </div>
  );
}

/** Ocorrências por intervalo (barras) e percentil 95 da duração (linha). */
export function GraficoSerie({ dados }: { dados: PontoSerie[] }) {
  if (dados.length === 0) return null;
  const pontos = dados.map((d) => ({ ...d, t: new Date(d.instante).getTime() }));
  const fmt = formatadorInstante(pontos[0].t, pontos[pontos.length - 1].t);
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-zinc-600">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_BARRA }} />Ocorrências</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: COR_LINHA }} />Percentil 95 da duração</span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={pontos} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COR_GRADE} vertical={false} />
          <XAxis dataKey="t" tickFormatter={fmt} tick={{ fontSize: 11, fill: COR_EIXO }} tickLine={false} axisLine={{ stroke: COR_GRADE }} minTickGap={40} />
          <YAxis yAxisId="n" allowDecimals={false} tick={{ fontSize: 11, fill: COR_EIXO }} tickLine={false} axisLine={false} width={36} />
          <YAxis yAxisId="ms" orientation="right" tickFormatter={(v) => formatarDuracao(v)} tick={{ fontSize: 11, fill: COR_EIXO }} tickLine={false} axisLine={false} width={64} />
          <Tooltip
            cursor={{ fill: "#f4f4f5" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof pontos)[number];
              return (
                <CaixaDica
                  titulo={dataCompleta.format(new Date(p.t))}
                  linhas={[
                    { cor: COR_BARRA, rotulo: "Ocorrências", valor: formatarNumero(p.ocorrencias) },
                    { cor: COR_LINHA, rotulo: "Percentil 95", valor: formatarDuracao(p.p95_ms) },
                  ]}
                />
              );
            }}
          />
          <Bar yAxisId="n" dataKey="ocorrencias" fill={COR_BARRA} radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          <Line yAxisId="ms" dataKey="p95_ms" stroke={COR_LINHA} strokeWidth={2} dot={{ r: 2.5, fill: COR_LINHA, strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Duração de cada ocorrência ao longo do tempo. */
export function GraficoDuracoes({ dados }: { dados: PontoDuracao[] }) {
  if (dados.length === 0) return null;
  const fmt = formatadorInstante(dados[0].instante, dados[dados.length - 1].instante);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={COR_GRADE} vertical={false} />
        <XAxis dataKey="instante" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={fmt} tick={{ fontSize: 11, fill: COR_EIXO }} tickLine={false} axisLine={{ stroke: COR_GRADE }} minTickGap={40} />
        <YAxis dataKey="duracao_ms" type="number" tickFormatter={(v) => formatarDuracao(v)} tick={{ fontSize: 11, fill: COR_EIXO }} tickLine={false} axisLine={false} width={64} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as PontoDuracao;
            return <CaixaDica titulo={dataCompleta.format(new Date(p.instante))} linhas={[{ cor: COR_BARRA, rotulo: "Duração", valor: formatarDuracao(p.duracao_ms) }]} />;
          }}
        />
        <Scatter data={dados} fill={COR_BARRA} fillOpacity={0.65} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
