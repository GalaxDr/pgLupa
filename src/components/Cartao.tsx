export function Cartao({
  titulo,
  descricao,
  acao,
  children,
  className = "",
}: {
  titulo?: string;
  descricao?: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-zinc-200 bg-white shadow-xs ${className}`}>
      {titulo && (
        <header className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">{titulo}</h2>
            {descricao && <p className="mt-0.5 text-xs text-zinc-500">{descricao}</p>}
          </div>
          {acao}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Indicador({ rotulo, valor, detalhe, destaque = false }: { rotulo: string; valor: string; detalhe?: string; destaque?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3.5 shadow-xs">
      <div className="text-xs font-medium text-zinc-500">{rotulo}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${destaque ? "text-alerta" : "text-zinc-900"}`}>{valor}</div>
      {detalhe && <div className="mt-0.5 text-xs text-zinc-500">{detalhe}</div>}
    </div>
  );
}

export function Carregando({ altura = "h-64" }: { altura?: string }) {
  return <div className={`${altura} animate-pulse rounded-lg border border-zinc-200 bg-zinc-100/70`} />;
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">{children}</div>;
}
