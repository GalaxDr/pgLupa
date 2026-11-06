import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Navegacao } from "@/components/Navegacao";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "pgLupa · Monitor de queries lentas", template: "%s · pgLupa" },
  description: "Monitoramento de consultas lentas em PostgreSQL a partir do log e do pg_stat_statements",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <Marca />
              <span className="hidden leading-tight sm:block">
                <span className="block text-sm font-semibold tracking-tight text-zinc-900">pgLupa</span>
                <span className="block text-[11px] text-zinc-500">Monitor de queries lentas do PostgreSQL</span>
              </span>
            </Link>
            <Suspense fallback={<div />}>
              <NavegacaoConformeModo />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}

/** O modo (local ou hospedado) é lido em tempo de execução, e não no momento do build. */
async function NavegacaoConformeModo() {
  await connection();
  return <Navegacao hospedado={process.env.MODO === "hospedado"} />;
}

/** Marca da ferramenta: uma lupa sobre barras, o mesmo desenho do ícone (src/app/icon.svg). */
function Marca() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#0f766e" />
      <circle cx="14" cy="14" r="7.6" fill="none" stroke="#fff" strokeWidth="2.4" />
      <path d="M19.6 19.6l5.4 5.4" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M11 16.8v-1.6M17 16.8v-2.8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 16.8V10.6" stroke="#fdba74" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
