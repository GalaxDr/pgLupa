import type { NextRequest } from "next/server";
import { obterAnalise } from "@/lib/analises";

/** GET /api/analises/:id. Situação do processamento da análise. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/analises/[id]">) {
  const { id } = await ctx.params;
  const a = await obterAnalise(id);
  if (!a) return Response.json({ erro: "Análise não encontrada." }, { status: 404 });
  return Response.json({
    situacao: a.situacao,
    tamanho: a.tamanho,
    posicao_lida: a.posicao_lida,
    ocorrencias: a.ocorrencias,
    mensagem_erro: a.mensagem_erro,
  });
}
