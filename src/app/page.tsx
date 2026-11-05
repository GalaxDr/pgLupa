import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Cabecalho } from "@/components/Cabecalho";
import { Cartao, Carregando, Indicador, Vazio } from "@/components/Cartao";
import { FiltrosServidor } from "@/components/FiltrosServidor";
import { GraficoSerie } from "@/components/Graficos";
import { TabelaConsultas } from "@/components/TabelaConsultas";
import { RecomendacoesPrioritarias } from "@/components/Recomendacoes";
import { listarConsultas, obterExemplos, obterResumo, obterSerie } from "@/lib/consultas";
import { lerFiltros, PERIODOS, urlComFiltros } from "@/lib/filtros";
import { formatarDuracao, formatarNumero } from "@/lib/formato";
import { LIMITE_UPLOAD_MB, modoHospedado, RETENCAO_ANALISE_HORAS } from "@/lib/analises";
import { PaginaEnvio } from "@/components/PaginaEnvio";

export default function Inicio(props: PageProps<"/">) {
  return (
    <Suspense fallback={<div className="h-96" />}>
      <ConformeModo searchParams={props.searchParams} />
    </Suspense>
  );
}

/** No modo hospedado, a página inicial é a de envio de arquivo; no modo local, a visão geral. */
async function ConformeModo({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  if (modoHospedado()) return <PaginaEnvio limiteMb={LIMITE_UPLOAD_MB()} retencaoHoras={RETENCAO_ANALISE_HORAS()} />;
  return <VisaoGeral searchParams={searchParams} />;
}

function VisaoGeral(props: { searchParams: PageProps<"/">["searchParams"] }) {
  return (
    <>
      <Cabecalho titulo="Visão geral" descricao="Consultas que ultrapassaram o limite de log_min_duration_statement no período selecionado.">
        <Suspense fallback={<div className="h-14" />}>
          <FiltrosServidor />
        </Suspense>
      </Cabecalho>
      <Suspense fallback={<CarregandoPainel />}>
        <Painel searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Painel({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const filtros = lerFiltros(await searchParams);
  const [resumo, serie, top] = await Promise.all([
    obterResumo(filtros),
    obterSerie(filtros),
    listarConsultas({ ...filtros, ordem: "total" }, 8),
  ]);
  const prioritarias = top.slice(0, 5);
  const exemplos = await obterExemplos(filtros, prioritarias.map((l) => l.id));

  if (resumo.ocorrencias === 0) {
    return (
      <Vazio>
        Nenhuma consulta lenta registrada em: {PERIODOS[filtros.periodo].rotulo.toLowerCase()}.
        <br />
        Verifique se o coletor está em execução na página <Link href="/coletor" className="font-medium text-destaque underline">Coletor</Link>.
      </Vazio>
    );
  }

  return (
    <div className="flex flex-col gap-5">
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
      <RecomendacoesPrioritarias linhas={prioritarias} tempoTotalMs={resumo.tempo_total_ms} exemplos={exemplos} filtros={filtros} />
      <Cartao
        titulo="Consultas com maior tempo total"
        descricao="Soma das durações das ocorrências no período: indica onde a otimização traz maior ganho"
        acao={<Link href={urlComFiltros("/consultas", filtros)} className="text-xs font-medium text-destaque hover:underline">Ver todas</Link>}
      >
        <TabelaConsultas linhas={top} filtros={filtros} compacta />
      </Cartao>
    </div>
  );
}

function CarregandoPainel() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <Carregando key={i} altura="h-20" />)}
      </div>
      <Carregando altura="h-80" />
      <Carregando altura="h-72" />
    </div>
  );
}
