import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Carregando } from "@/components/Cartao";
import { DetalheConsulta } from "@/components/DetalheConsulta";
import { modoHospedado } from "@/lib/analises";
import { lerFiltros, urlComFiltros } from "@/lib/filtros";

export default function PaginaConsulta(props: PageProps<"/consultas/[id]">) {
  return (
    <Suspense fallback={<Carregando altura="h-[32rem]" />}>
      <Detalhe params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Detalhe({ params, searchParams }: Pick<PageProps<"/consultas/[id]">, "params" | "searchParams">) {
  await connection();
  if (modoHospedado()) notFound();
  const { id: idTexto } = await params;
  const id = Number(idTexto);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const filtros = lerFiltros(await searchParams);
  return <DetalheConsulta id={id} filtros={filtros} voltar={{ href: urlComFiltros("/consultas", filtros), rotulo: "Consultas" }} />;
}
