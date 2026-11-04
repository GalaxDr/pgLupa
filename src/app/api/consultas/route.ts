import type { NextRequest } from "next/server";
import { modoHospedado } from "@/lib/analises";
import { listarConsultas, obterResumo } from "@/lib/consultas";
import { lerFiltros } from "@/lib/filtros";

/**
 * GET /api/consultas?periodo=24h&banco=loja&usuario=app&ordem=total&limite=50
 * Consultas agrupadas e resumo do período, com os mesmos filtros do painel.
 */
export async function GET(request: NextRequest) {
  // no modo hospedado os dados de cada análise só são acessíveis pelo link da própria análise
  if (modoHospedado()) return Response.json({ erro: "Não disponível." }, { status: 404 });
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const filtros = lerFiltros(sp);
  const limite = Number(sp.limite) || 100;
  const [resumo, consultas] = await Promise.all([obterResumo(filtros), listarConsultas(filtros, limite)]);
  return Response.json({ filtros, resumo, consultas });
}
