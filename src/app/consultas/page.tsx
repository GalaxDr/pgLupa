import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Cabecalho } from "@/components/Cabecalho";
import { Cartao, Carregando, Vazio } from "@/components/Cartao";
import { FiltrosServidor } from "@/components/FiltrosServidor";
import { TabelaConsultas } from "@/components/TabelaConsultas";
import { listarConsultas } from "@/lib/consultas";
import { lerFiltros, ORDENS } from "@/lib/filtros";
import { modoHospedado } from "@/lib/analises";

export default function PaginaConsultas(props: PageProps<"/consultas">) {
  return (
    <>
      <Cabecalho titulo="Consultas" descricao="Execuções equivalentes agrupadas pela consulta normalizada, com os valores literais substituídos por parâmetros.">
        <Suspense fallback={<div className="h-14" />}>
          <FiltrosServidor mostrarOrdem mostrarBusca />
        </Suspense>
      </Cabecalho>
      <Suspense fallback={<Carregando altura="h-96" />}>
        <Lista searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Lista({ searchParams }: { searchParams: PageProps<"/consultas">["searchParams"] }) {
  await connection();
  if (modoHospedado()) notFound();
  const filtros = lerFiltros(await searchParams);
  const linhas = await listarConsultas(filtros, 200);
  if (linhas.length === 0) return <Vazio>Nenhuma consulta encontrada com os filtros selecionados.</Vazio>;
  return (
    <Cartao titulo={`${linhas.length} consulta${linhas.length > 1 ? "s" : ""}`} descricao={`Ordenadas por ${ORDENS[filtros.ordem].rotulo.toLowerCase()}`}>
      <TabelaConsultas linhas={linhas} filtros={filtros} />
    </Cartao>
  );
}
