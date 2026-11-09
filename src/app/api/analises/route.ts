import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { ErroUpload, receberUpload } from "@/lib/analises";

/**
 * POST /api/analises?nome=postgresql.csv&anonimizar=1
 * Corpo: o conteúdo do arquivo de log (csvlog, jsonlog ou o mesmo compactado em .gz).
 * Resposta: { id, url } da análise criada, processada em segundo plano.
 */
export async function POST(request: NextRequest) {
  const nome = request.nextUrl.searchParams.get("nome") ?? "log";
  // anonimizar=1: armazena apenas o texto normalizado das consultas, sem os valores
  const anonimizar = request.nextUrl.searchParams.get("anonimizar") === "1";
  if (!request.body) return Response.json({ erro: "Nenhum arquivo enviado." }, { status: 400 });
  const tamanho = Number(request.headers.get("content-length"));
  try {
    const corpo = Readable.fromWeb(request.body as import("node:stream/web").ReadableStream);
    const id = await receberUpload(nome, corpo, Number.isFinite(tamanho) && tamanho > 0 ? tamanho : null, anonimizar);
    return Response.json({ id, url: `/analises/${id}` }, { status: 201 });
  } catch (e) {
    if (e instanceof ErroUpload) return Response.json({ erro: e.message }, { status: e.status });
    console.error("erro ao receber o arquivo:", e);
    return Response.json({ erro: "Não foi possível receber o arquivo." }, { status: 500 });
  }
}
