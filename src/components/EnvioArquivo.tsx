"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Estado = { tipo: "parado" } | { tipo: "enviando"; progresso: number; nome: string } | { tipo: "erro"; mensagem: string };

const EXTENSOES = [".csv", ".json", ".log", ".gz"];

/** Área de envio do arquivo de log, com barra de progresso. */
export function EnvioArquivo({ limiteMb }: { limiteMb: number }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<Estado>({ tipo: "parado" });
  const [arrastando, setArrastando] = useState(false);
  const [anonimizar, setAnonimizar] = useState(true);

  // ao voltar para esta página pelo histórico do navegador, a área de envio recomeça do zero
  useEffect(() => {
    const aoMostrar = (e: PageTransitionEvent) => {
      if (e.persisted) setEstado({ tipo: "parado" });
    };
    window.addEventListener("pageshow", aoMostrar);
    return () => window.removeEventListener("pageshow", aoMostrar);
  }, []);

  function enviar(arquivo: File) {
    const nome = arquivo.name.toLowerCase();
    if (!EXTENSOES.some((e) => nome.endsWith(e))) {
      setEstado({ tipo: "erro", mensagem: "Envie um arquivo .csv (csvlog), .json (jsonlog) ou o mesmo compactado em .gz." });
      return;
    }
    if (arquivo.size > limiteMb * 1024 * 1024) {
      setEstado({ tipo: "erro", mensagem: `O arquivo tem ${(arquivo.size / 1024 / 1024).toFixed(0)} MB; o limite é ${limiteMb} MB. Compacte-o em .gz ou envie um trecho menor.` });
      return;
    }
    setEstado({ tipo: "enviando", progresso: 0, nome: arquivo.name });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/analises?nome=${encodeURIComponent(arquivo.name)}${anonimizar ? "&anonimizar=1" : ""}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setEstado({ tipo: "enviando", progresso: e.loaded / e.total, nome: arquivo.name });
    };
    xhr.onload = () => {
      try {
        const r = JSON.parse(xhr.responseText);
        if (xhr.status === 201) {
          // a página pode ser mantida em memória pelo roteador: limpa o estado antes de sair dela
          setEstado({ tipo: "parado" });
          router.push(r.url);
        }
        else setEstado({ tipo: "erro", mensagem: r.erro ?? "Não foi possível enviar o arquivo." });
      } catch {
        setEstado({ tipo: "erro", mensagem: `Falha no envio (código ${xhr.status}).` });
      }
    };
    xhr.onerror = () => setEstado({ tipo: "erro", mensagem: "A conexão foi interrompida durante o envio." });
    xhr.send(arquivo);
  }

  const enviando = estado.tipo === "enviando";

  return (
    <div>
      <button
        type="button"
        disabled={enviando}
        onClick={() => entrada.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          const f = e.dataTransfer.files[0];
          if (f && !enviando) enviar(f);
        }}
        className={`flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
          arrastando ? "border-destaque bg-destaque-claro/40" : "border-zinc-300 bg-white hover:border-destaque/60 hover:bg-zinc-50"
        } ${enviando ? "cursor-default" : "cursor-pointer"}`}
      >
        <span className="grid h-12 w-12 place-items-center rounded-full bg-destaque-claro text-destaque">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </span>
        {enviando ? (
          <div className="w-full max-w-sm">
            <p className="truncate text-sm font-medium text-zinc-900">
              {estado.progresso >= 1 ? "Preparando o relatório…" : `Enviando ${estado.nome}…`}
            </p>
            <div className="mt-3 h-2 w-full rounded-full bg-zinc-100">
              <div className="h-2 rounded-full bg-destaque transition-all" style={{ width: `${Math.round(estado.progresso * 100)}%` }} />
            </div>
            <p className="mt-1.5 text-xs tabular-nums text-zinc-500">{Math.round(estado.progresso * 100)}%</p>
          </div>
        ) : (
          <>
            <span className="text-sm font-semibold text-zinc-900">Arraste o arquivo de log aqui ou clique para escolher</span>
            <span className="text-xs text-zinc-500">csvlog (.csv) ou jsonlog (.json) do PostgreSQL, ou o mesmo compactado em .gz · até {limiteMb} MB</span>
          </>
        )}
      </button>
      <input
        ref={entrada}
        type="file"
        accept=".csv,.json,.log,.gz"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) enviar(f);
          e.target.value = "";
        }}
      />
      <label className="mt-3 flex items-start gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={anonimizar}
          disabled={enviando}
          onChange={(e) => setAnonimizar(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-destaque)]"
        />
        <span>
          Não armazenar os valores das consultas
          <span className="block text-xs text-zinc-500">
            Guarda apenas o texto normalizado (valores trocados por $1, $2...), protegendo dados pessoais que estejam nas consultas. Desmarque para manter os
            valores, que permitem reproduzir a consulta e analisar o plano de execução com os dados reais.
          </span>
        </span>
      </label>
      {estado.tipo === "erro" && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{estado.mensagem}</p>}
    </div>
  );
}
