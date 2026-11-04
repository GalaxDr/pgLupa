"use client";

import { useEffect } from "react";

export default function Erro({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto mt-10 max-w-lg rounded-lg border border-zinc-200 bg-white p-6 shadow-xs">
      <h1 className="text-base font-semibold text-zinc-900">Não foi possível carregar os dados</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Verifique se o banco de dados da ferramenta está em execução (<code className="font-mono">docker compose up -d</code>),
        se a variável <code className="font-mono">DATABASE_URL</code> do arquivo <code className="font-mono">.env</code> está correta
        e se as tabelas foram criadas com <code className="font-mono">npm run db:migrate</code>.
      </p>
      <button
        onClick={() => retry()}
        className="mt-4 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
      >
        Tentar novamente
      </button>
    </div>
  );
}
