import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Carregando } from "@/components/Cartao";
import { DetalheConsulta } from "@/components/DetalheConsulta";
import { obterAnalise } from "@/lib/analises";
import { lerFiltros, urlComFiltros } from "@/lib/filtros";

export default function PaginaConsultaDaAnalise(props: PageProps<"/analises/[id]/consultas/[cid]">) {
  return (
    <Suspense fallback={<Carregando altura="h-[32rem]" />}>
      <Detalhe params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Detalhe({ params, searchParams }: Pick<PageProps<"/analises/[id]/consultas/[cid]">, "params" | "searchParams">) {
  await connection();
  const { id, cid } = await params;
  const analise = await obterAnalise(id);
  const consultaId = Number(cid);
  if (!analise || analise.situacao !== "concluida" || !Number.isInteger(consultaId) || consultaId <= 0) notFound();
  const filtros = lerFiltros(await searchParams);
  return (
    <DetalheConsulta
      id={consultaId}
      filtros={filtros}
      servidorId={analise.servidor_id}
      voltar={{ href: urlComFiltros(`/analises/${id}`, { banco: filtros.banco, usuario: filtros.usuario }), rotulo: analise.nome_arquivo }}
    />
  );
}
