"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const LINKS_LOCAL = [
  { href: "/", rotulo: "Visão geral" },
  { href: "/consultas", rotulo: "Consultas" },
  { href: "/coletor", rotulo: "Coletor" },
  { href: "/enviar", rotulo: "Enviar log" },
];
const LINKS_HOSPEDADO = [{ href: "/", rotulo: "Enviar log" }];

/** Links do menu; o item ativo depende da URL, disponível apenas em tempo de execução. */
export function Navegacao({ hospedado }: { hospedado: boolean }) {
  const links = hospedado ? LINKS_HOSPEDADO : LINKS_LOCAL;
  return (
    <Suspense fallback={hospedado ? null : <Links links={links} pathname={null} />}>
      <LinksAtivos links={links} hospedado={hospedado} />
    </Suspense>
  );
}

type ListaLinks = { href: string; rotulo: string }[];

function LinksAtivos({ links, hospedado }: { links: ListaLinks; hospedado: boolean }) {
  const pathname = usePathname();
  // no site, o relatório de uma análise não mostra o menu: a marca no topo volta para a página de envio
  if (hospedado && pathname.startsWith("/analises")) return null;
  return <Links links={links} pathname={pathname} />;
}

function Links({ links, pathname }: { links: ListaLinks; pathname: string | null }) {
  return (
    <nav className="flex gap-1">
      {links.map((l) => {
        const ativo = pathname !== null && (l.href === "/" ? pathname === "/" : pathname.startsWith(l.href));
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              ativo ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            {l.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
