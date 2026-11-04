"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Situacao {
  situacao: string;
  tamanho: number;
  posicao_lida: number | null;
}

/** Acompanha o processamento da análise e atualiza a página quando ele termina. */
export function ProgressoAnalise({ id, inicial }: { id: string; inicial: Situacao }) {
  const router = useRouter();
  const [s, setS] = useState(inicial);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/analises/${id}`, { cache: "no-store" });
        if (!r.ok) return;
        const novo = (await r.json()) as Situacao;
        setS(novo);
        if (novo.situacao === "concluida" || novo.situacao === "erro") {
          clearInterval(t);
          router.refresh();
        }
      } catch {
        // tenta novamente no próximo intervalo
      }
    }, 1500);
    return () => clearInterval(t);
  }, [id, router]);

  const pct = s.tamanho > 0 && s.posicao_lida ? Math.min(100, (s.posicao_lida / s.tamanho) * 100) : 0;
  const texto = s.situacao === "na_fila" ? "Na fila para processamento…" : "Processando o arquivo de log…";

  return (
    <div className="mx-auto mt-10 max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-xs">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-destaque" />
      <p className="mt-4 text-sm font-medium text-zinc-900">{texto}</p>
      <div className="mt-3 h-2 w-full rounded-full bg-zinc-100">
        <div className="h-2 rounded-full bg-destaque transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs tabular-nums text-zinc-500">{pct.toFixed(0)}%</p>
      <p className="mt-4 text-xs text-zinc-500">Você pode guardar o endereço desta página e voltar depois.</p>
    </div>
  );
}
