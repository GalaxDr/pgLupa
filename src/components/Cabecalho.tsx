export function Cabecalho({ titulo, descricao, children }: { titulo: string; descricao?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-zinc-500">{descricao}</p>}
      </div>
      {children}
    </div>
  );
}
