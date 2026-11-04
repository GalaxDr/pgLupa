import { connection } from "next/server";
import { Suspense } from "react";
import { PaginaEnvio } from "@/components/PaginaEnvio";
import { LIMITE_UPLOAD_MB, RETENCAO_ANALISE_HORAS } from "@/lib/analises";

export default function Enviar() {
  return (
    <Suspense fallback={<div className="h-96" />}>
      <Conteudo />
    </Suspense>
  );
}

async function Conteudo() {
  await connection();
  return <PaginaEnvio limiteMb={LIMITE_UPLOAD_MB()} retencaoHoras={RETENCAO_ANALISE_HORAS()} />;
}
