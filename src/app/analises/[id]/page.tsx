import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Cartao, Carregando, Indicador, Vazio } from "@/components/Cartao";
import { FiltrosServidor } from "@/components/FiltrosServidor";
import { GraficoSerie } from "@/components/Graficos";
import { ProgressoAnalise } from "@/components/ProgressoAnalise";
import { TabelaConsultas } from "@/components/TabelaConsultas";
import { obterAnalise } from "@/lib/analises";
import { listarConsultas, obterResumo, obterSerie } from "@/lib/consultas";
import { lerFiltros, ORDENS, type Filtros } from "@/lib/filtros";
import { formatarBytes, formatarDataHora, formatarDuracao, formatarNumero } from "@/lib/formato";

export default function PaginaAnalise(props: PageProps<"/analises/[id]">) {
  return (
    <Suspense fallback={<Carregando altura="h-[32rem]" />}>
      <Relatorio params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Relatorio({ params, searchParams }: Pick<PageProps<"/analises/[id]">, "params" | "searchParams">) {
  await connection();
  const { id } = await params;
  const analise = await obterAnalise(id);
  if (!analise) notFound();

  if (analise.situacao !== "concluida" && analise.situacao !== "erro") {
    return <ProgressoAnalise id={id} inicial={{ situacao: analise.situacao, tamanho: analise.tamanho, posicao_lida: analise.posicao_lida }} />;
  }

  const cabecalho = (
    <div className="mb-5">
      <p className="text-xs font-medium text-zinc-500">Relatório da análise</p>
      <h1 className="mt-0.5 break-all text-xl font-semibold tracking-tight text-zinc-900">{analise.nome_arquivo}</h1>
      <p className="mt-1 text-xs text-zinc-500">
        {analise.formato_log} · {formatarBytes(analise.tamanho)} · enviado em {formatarDataHora(analise.criada_em)} · disponível até{" "}
        {formatarDataHora(analise.expira_em)}
      </p>
    </div>
  );

  if (analise.situacao === "erro") {
    return (
      <>
        {cabecalho}
        <Vazio>{analise.mensagem_erro}</Vazio>
      </>
    );
  }
  if (analise.ocorrencias === 0) {
    return (
      <>
        {cabecalho}
        <Vazio>
          Nenhuma consulta lenta foi encontrada neste arquivo. Verifique se o servidor está com{" "}
          <code className="font-mono">log_min_duration_statement</code> ativado e com <code className="font-mono">lc_messages = &apos;C&apos;</code>{" "}
          (mensagens em inglês).
        </Vazio>
      </>
    );
  }

  const filtros: Filtros = { ...lerFiltros(await searchParams), servidor: analise.servidor_id, periodo: "tudo" };
  const [resumo, serie, consultas] = await Promise.all([obterResumo(filtros), obterSerie(filtros), listarConsultas(filtros, 300)]);

  return (
    <div className="flex flex-col gap-5">
      {cabecalho}
      <Suspense fallback={<div className="h-14" />}>
        <FiltrosServidor servidorId={analise.servidor_id} mostrarPeriodo={false} mostrarOrdem mostrarBusca />
      </Suspense>
      {resumo.ocorrencias === 0 ? (
        <Vazio>Nenhuma consulta encontrada com os filtros selecionados.</Vazio>
      ) : (
        <>
          <p className="-mt-1 text-xs text-zinc-500">
            Período do log: {formatarDataHora(resumo.primeira)} a {formatarDataHora(resumo.ultima)}
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Indicador rotulo="Ocorrências" valor={formatarNumero(resumo.ocorrencias)} />
            <Indicador rotulo="Consultas distintas" valor={formatarNumero(resumo.consultas)} />
            <Indicador rotulo="Tempo total" valor={formatarDuracao(resumo.tempo_total_ms)} />
            <Indicador rotulo="Tempo médio" valor={formatarDuracao(resumo.media_ms)} />
            <Indicador rotulo="Percentil 95" valor={formatarDuracao(resumo.p95_ms)} destaque />
            <Indicador rotulo="Máximo" valor={formatarDuracao(resumo.max_ms)} />
          </div>
          <Cartao titulo="Ocorrências ao longo do tempo" descricao="Quantidade de consultas lentas por intervalo e percentil 95 da duração">
            <GraficoSerie dados={serie} />
          </Cartao>
          <Cartao
            titulo={`${consultas.length} consulta${consultas.length > 1 ? "s" : ""}`}
            descricao={`Ordenadas por ${ORDENS[filtros.ordem].rotulo.toLowerCase()}. Clique em uma consulta para ver os detalhes.`}
          >
            <TabelaConsultas linhas={consultas} filtros={filtros} base={`/analises/${analise.id}/consultas`} />
          </Cartao>
        </>
      )}
    </div>
  );
}
