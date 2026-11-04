import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Cartao, Indicador, Vazio } from "@/components/Cartao";
import { FiltrosServidor } from "@/components/FiltrosServidor";
import { GraficoDuracoes, GraficoSerie } from "@/components/Graficos";
import { Sql } from "@/components/Sql";
import {
  listarDuracoes,
  listarOcorrencias,
  obterConsulta,
  obterDistribuicao,
  obterEstatisticasPgss,
  obterResumo,
  obterSerie,
  type ItemDistribuicao,
} from "@/lib/consultas";
import type { Filtros } from "@/lib/filtros";
import { formatarDataHora, formatarDuracao, formatarHaQuanto, formatarNumero } from "@/lib/formato";

/**
 * Detalhe de uma consulta normalizada. Com servidorId (análise enviada), todos os dados ficam
 * restritos às ocorrências desse servidor e a consulta só é exibida se tiver ocorrências nele.
 */
export async function DetalheConsulta({
  id,
  filtros: filtrosUrl,
  voltar,
  servidorId,
}: {
  id: number;
  filtros: Filtros;
  voltar: { href: string; rotulo: string };
  servidorId?: number;
}) {
  const filtros: Filtros = servidorId ? { ...filtrosUrl, servidor: servidorId, periodo: "tudo" } : filtrosUrl;
  const consulta = await obterConsulta(id);
  if (!consulta) notFound();

  const [resumo, serie, duracoes, ocorrencias, porBanco, porUsuario, porAplicacao, porHost, pgss] = await Promise.all([
    obterResumo(filtros, id),
    obterSerie(filtros, id),
    listarDuracoes(filtros, id),
    listarOcorrencias(filtros, id, 20),
    obterDistribuicao(filtros, id, "banco"),
    obterDistribuicao(filtros, id, "usuario"),
    obterDistribuicao(filtros, id, "aplicacao"),
    obterDistribuicao(filtros, id, "host"),
    servidorId ? Promise.resolve(null) : obterEstatisticasPgss(consulta.query_id),
  ]);
  if (servidorId && resumo.ocorrencias === 0 && !filtrosUrl.banco && !filtrosUrl.usuario) notFound();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={voltar.href} className="text-xs font-medium text-zinc-500 hover:text-destaque">
          ← {voltar.rotulo}
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">Consulta #{consulta.id}</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Primeira ocorrência em {formatarDataHora(resumo.primeira ?? consulta.primeira_ocorrencia)} · última em{" "}
          {formatarDataHora(resumo.ultima ?? consulta.ultima_ocorrencia)}
          {consulta.query_id && <> · query_id <code className="font-mono">{consulta.query_id}</code></>}
        </p>
      </div>

      <Cartao titulo="Consulta normalizada">
        <Sql texto={consulta.texto_normalizado} />
      </Cartao>

      <Suspense fallback={<div className="h-14" />}>
        <FiltrosServidor servidorId={servidorId} mostrarPeriodo={!servidorId} />
      </Suspense>

      {resumo.ocorrencias === 0 ? (
        <Vazio>Nenhuma ocorrência desta consulta com os filtros selecionados.</Vazio>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Indicador rotulo="Ocorrências" valor={formatarNumero(resumo.ocorrencias)} />
            <Indicador rotulo="Tempo total" valor={formatarDuracao(resumo.tempo_total_ms)} />
            <Indicador rotulo="Tempo médio" valor={formatarDuracao(resumo.media_ms)} />
            <Indicador rotulo="Percentil 95" valor={formatarDuracao(resumo.p95_ms)} destaque />
            <Indicador rotulo="Máximo" valor={formatarDuracao(resumo.max_ms)} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Cartao titulo="Ocorrências ao longo do tempo">
              <GraficoSerie dados={serie} />
            </Cartao>
            <Cartao titulo="Duração de cada ocorrência" descricao={duracoes.length >= 2000 ? "Últimas 2.000 ocorrências" : undefined}>
              <GraficoDuracoes dados={duracoes} />
            </Cartao>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Distribuicao titulo="Bancos de dados" itens={porBanco} total={resumo.ocorrencias} />
            <Distribuicao titulo="Usuários" itens={porUsuario} total={resumo.ocorrencias} />
            <Distribuicao titulo="Aplicações" itens={porAplicacao} total={resumo.ocorrencias} />
            <Distribuicao titulo="Hosts de origem" itens={porHost} total={resumo.ocorrencias} />
          </div>
        </>
      )}

      {!servidorId && <PainelPgss pgss={pgss} queryId={consulta.query_id} />}

      {ocorrencias.length > 0 && <TabelaOcorrencias ocorrencias={ocorrencias} />}
    </div>
  );
}

function Distribuicao({ titulo, itens, total }: { titulo: string; itens: ItemDistribuicao[]; total: number }) {
  return (
    <Cartao titulo={titulo}>
      <ul className="flex flex-col gap-2.5">
        {itens.map((i) => (
          <li key={i.valor ?? "nulo"}>
            <div className="flex justify-between gap-2 text-xs">
              <span className="truncate font-medium text-zinc-800">{i.valor ?? <em className="font-normal text-zinc-400">não informado</em>}</span>
              <span className="tabular-nums text-zinc-500">{formatarNumero(i.ocorrencias)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-zinc-100">
              <div className="h-1.5 rounded-full bg-destaque/70" style={{ width: `${(i.ocorrencias / total) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}

function PainelPgss({ pgss, queryId }: { pgss: Awaited<ReturnType<typeof obterEstatisticasPgss>>; queryId: string | null }) {
  const descricao = "Totais acumulados desde a última reinicialização das estatísticas, incluindo as execuções abaixo do limite do log";
  if (!pgss) {
    return (
      <Cartao titulo="pg_stat_statements" descricao={descricao}>
        <p className="text-sm text-zinc-500">
          {queryId
            ? "Ainda não há snapshot do pg_stat_statements para esta consulta."
            : "O log não informou o query_id desta consulta. Ative compute_query_id no servidor monitorado para associar as duas fontes."}
        </p>
      </Cartao>
    );
  }
  const blocos = pgss.shared_blks_hit + pgss.shared_blks_read;
  const acerto = blocos > 0 ? (pgss.shared_blks_hit / blocos) * 100 : null;
  return (
    <Cartao titulo="pg_stat_statements" descricao={descricao} acao={<span className="text-xs text-zinc-500">snapshot {formatarHaQuanto(pgss.coletado_em)}</span>}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-3 lg:grid-cols-6">
        <Dado rotulo="Execuções" valor={formatarNumero(pgss.calls)} detalhe={pgss.delta_calls !== null ? `+${formatarNumero(pgss.delta_calls)} desde o snapshot anterior` : undefined} />
        <Dado rotulo="Tempo total" valor={formatarDuracao(pgss.total_exec_time)} detalhe={pgss.delta_total_exec_time !== null ? `+${formatarDuracao(pgss.delta_total_exec_time)} desde o anterior` : undefined} />
        <Dado rotulo="Tempo médio" valor={formatarDuracao(pgss.mean_exec_time)} />
        <Dado rotulo="Linhas por execução" valor={pgss.calls > 0 ? formatarNumero(Math.round(pgss.rows / pgss.calls)) : "–"} />
        <Dado rotulo="Blocos lidos do disco" valor={formatarNumero(pgss.shared_blks_read)} />
        <Dado rotulo="Acerto do cache" valor={acerto === null ? "–" : `${acerto.toFixed(1).replace(".", ",")}%`} detalhe={`${formatarNumero(pgss.shared_blks_hit)} blocos em cache`} />
      </dl>
    </Cartao>
  );
}

function Dado({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{rotulo}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums text-zinc-900">{valor}</dd>
      {detalhe && <dd className="text-xs text-zinc-500">{detalhe}</dd>}
    </div>
  );
}

function TabelaOcorrencias({ ocorrencias }: { ocorrencias: Awaited<ReturnType<typeof listarOcorrencias>> }) {
  return (
    <Cartao titulo="Últimas 20 ocorrências" descricao="Clique em uma linha para ver o texto efetivamente executado, com os valores dos parâmetros">
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[10rem_6rem_1fr_1fr_1fr_6rem] gap-3 border-b border-zinc-200 pb-2 text-xs font-medium text-zinc-500">
            <span>Data e hora</span>
            <span className="text-right">Duração</span>
            <span>Banco</span>
            <span>Usuário</span>
            <span>Aplicação</span>
            <span>Host / PID</span>
          </div>
          {ocorrencias.map((o) => (
            <details key={o.id} className="group border-b border-zinc-100 last:border-0">
              <summary className="grid cursor-pointer list-none grid-cols-[10rem_6rem_1fr_1fr_1fr_6rem] gap-3 py-2 text-sm hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
                <span className="whitespace-nowrap text-xs text-zinc-600">{formatarDataHora(o.data_hora)}</span>
                <span className="text-right font-medium tabular-nums">{formatarDuracao(o.duracao_ms)}</span>
                <span className="truncate">{o.banco ?? "–"}</span>
                <span className="truncate">{o.usuario ?? "–"}</span>
                <span className="truncate">{o.aplicacao ?? "–"}</span>
                <span className="truncate text-xs text-zinc-600">{o.host_cliente ?? "–"} · {o.pid ?? "–"}</span>
              </summary>
              <div className="mb-3 rounded-md bg-zinc-50 p-3">
                <Sql texto={o.texto_executado} />
                <p className="mt-2 text-xs text-zinc-500">Servidor: {o.servidor}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </Cartao>
  );
}
