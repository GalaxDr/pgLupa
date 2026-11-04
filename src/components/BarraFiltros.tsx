"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ORDENS, PERIODOS } from "@/lib/filtros";
import type { OpcoesFiltro } from "@/lib/consultas";

interface Props {
  opcoes: OpcoesFiltro;
  mostrarOrdem?: boolean;
  mostrarBusca?: boolean;
  mostrarPeriodo?: boolean;
}

const classeCampo =
  "h-9 rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 shadow-xs outline-none focus:border-destaque focus:ring-2 focus:ring-destaque/20";

export function BarraFiltros({ opcoes, mostrarOrdem = false, mostrarBusca = false, mostrarPeriodo = true }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pendente, iniciar] = useTransition();
  const [busca, setBusca] = useState(sp.get("busca") ?? "");

  const definir = (chave: string, valor: string) => {
    const p = new URLSearchParams(sp.toString());
    if (valor) p.set(chave, valor);
    else p.delete(chave);
    iniciar(() => router.replace(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false }));
  };

  // aplica a busca textual após uma pausa na digitação
  useEffect(() => {
    if (!mostrarBusca || busca === (sp.get("busca") ?? "")) return;
    const t = setTimeout(() => definir("busca", busca), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  return (
    <div className={`flex flex-wrap items-end gap-3 transition-opacity ${pendente ? "opacity-60" : ""}`}>
      {mostrarPeriodo && (
      <Campo rotulo="Período">
        <select className={classeCampo} value={sp.get("periodo") ?? "24h"} onChange={(e) => definir("periodo", e.target.value === "24h" ? "" : e.target.value)}>
          {Object.entries(PERIODOS).map(([k, p]) => (
            <option key={k} value={k}>{p.rotulo}</option>
          ))}
        </select>
      </Campo>
      )}
      {opcoes.servidores.length > 1 && (
        <Campo rotulo="Servidor">
          <select className={classeCampo} value={sp.get("servidor") ?? ""} onChange={(e) => definir("servidor", e.target.value)}>
            <option value="">Todos</option>
            {opcoes.servidores.map((s) => (
              <option key={s.id} value={s.id}>{s.nome}</option>
            ))}
          </select>
        </Campo>
      )}
      <Campo rotulo="Banco de dados">
        <select className={classeCampo} value={sp.get("banco") ?? ""} onChange={(e) => definir("banco", e.target.value)}>
          <option value="">Todos</option>
          {opcoes.bancos.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Usuário">
        <select className={classeCampo} value={sp.get("usuario") ?? ""} onChange={(e) => definir("usuario", e.target.value)}>
          <option value="">Todos</option>
          {opcoes.usuarios.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </Campo>
      {mostrarOrdem && (
        <Campo rotulo="Ordenar por">
          <select className={classeCampo} value={sp.get("ordem") ?? "total"} onChange={(e) => definir("ordem", e.target.value === "total" ? "" : e.target.value)}>
            {Object.entries(ORDENS).map(([k, o]) => (
              <option key={k} value={k}>{o.rotulo}</option>
            ))}
          </select>
        </Campo>
      )}
      {mostrarBusca && (
        <Campo rotulo="Buscar no texto da consulta" className="min-w-56 flex-1">
          <input
            className={`${classeCampo} w-full`}
            placeholder="ex.: pedido, JOIN, UPDATE"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </Campo>
      )}
    </div>
  );
}

function Campo({ rotulo, children, className = "" }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium text-zinc-500">{rotulo}</span>
      {children}
    </label>
  );
}
