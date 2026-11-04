import { connection } from "next/server";
import { BarraFiltros } from "./BarraFiltros";
import { obterOpcoesFiltro } from "@/lib/consultas";

/** Carrega as opções dos filtros no servidor e renderiza a barra de filtros. */
export async function FiltrosServidor({
  servidorId,
  ...props
}: {
  servidorId?: number;
  mostrarOrdem?: boolean;
  mostrarBusca?: boolean;
  mostrarPeriodo?: boolean;
}) {
  await connection();
  const opcoes = await obterOpcoesFiltro(servidorId);
  return <BarraFiltros opcoes={opcoes} {...props} />;
}
