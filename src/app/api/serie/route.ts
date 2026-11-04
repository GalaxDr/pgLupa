import type { NextRequest } from "next/server";
import { modoHospedado } from "@/lib/analises";
import { obterSerie } from "@/lib/consultas";
import { lerFiltros } from "@/lib/filtros";

/**
 * GET /api/serie?periodo=24h&consulta=12
 * Ocorrências e percentil 95 por intervalo de tempo, de todas as consultas ou de uma consulta.
 */
export async function GET(request: NextRequest) {
  // no modo hospedado os dados de cada análise só são acessíveis pelo link da própria análise
  if (modoHospedado()) return Response.json({ erro: "Não disponível." }, { status: 404 });
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const consulta = Number(sp.consulta);
  const serie = await obterSerie(lerFiltros(sp), Number.isInteger(consulta) && consulta > 0 ? consulta : undefined);
  return Response.json(serie);
}
