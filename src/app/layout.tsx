import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Navegacao } from "@/components/Navegacao";
import "./globals.css";

export const metadata: Metadata = {
  title: "Monitor de queries lentas",
  description: "Monitoramento de consultas lentas em PostgreSQL a partir do log e do pg_stat_statements",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-destaque text-white">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="13" r="8" />
                  <path d="M12 9v4l2.5 2.5M10 2h4" />
                </svg>
              </span>
              <span className="hidden text-sm font-semibold tracking-tight text-zinc-900 sm:inline">Monitor de queries lentas</span>
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
