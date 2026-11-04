import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Cabecalho } from "@/components/Cabecalho";
import { Cartao, Carregando, Vazio } from "@/components/Cartao";
import { obterEstadoColetor } from "@/lib/consultas";
import { modoHospedado } from "@/lib/analises";
import { formatarBytes, formatarDataHora, formatarHaQuanto, formatarNumero } from "@/lib/formato";

export default function PaginaColetor() {
  return (
    <>
      <Cabecalho titulo="Coletor" descricao="Servidores monitorados e estado da leitura incremental dos arquivos de log." />
      <Suspense fallback={<Carregando />}>
        <Estado />
      </Suspense>
    </>
  );
}

async function carregar() {
  await connection();
  if (modoHospedado()) notFound();
  const servidores = await obterEstadoColetor();
  return { servidores, agora: Date.now() };
}

async function Estado() {
  const { servidores, agora } = await carregar();
  if (servidores.length === 0) {
    return <Vazio>Nenhum servidor cadastrado. Inicie o coletor com <code className="font-mono">npm run collector</code>.</Vazio>;
  }
  return (
    <div className="flex flex-col gap-5">
      {servidores.map((s) => {
        const recente = s.ultima_leitura && agora - new Date(s.ultima_leitura).getTime() < 5 * 60 * 1000;
        return (
          <Cartao
            key={s.id}
            titulo={s.nome}
            descricao={`${s.diretorio_logs} · ${s.formato_log}`}
            acao={
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.ativo ? "bg-destaque-claro text-destaque" : "bg-zinc-100 text-zinc-500"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${s.ativo ? "bg-destaque" : "bg-zinc-400"}`} />
                {s.ativo ? "ativo" : "inativo"}
              </span>
            }
          >
            <dl className="mb-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-zinc-500">Última leitura com conteúdo novo</dt>
                <dd className="mt-0.5 font-semibold">{formatarHaQuanto(s.ultima_leitura, agora)}</dd>
                {!recente && <dd className="text-xs text-alerta">sem atividade recente: verifique se o coletor está em execução</dd>}
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Último snapshot do pg_stat_statements</dt>
                <dd className="mt-0.5 font-semibold">{formatarHaQuanto(s.ultimo_snapshot, agora)}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Ocorrências nas últimas 24 horas</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">{formatarNumero(s.ocorrencias_24h)}</dd>
              </div>
            </dl>
            {s.arquivos.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                      <th className="py-2 pr-3 font-medium">Arquivo</th>
                      <th className="px-3 py-2 font-medium">Leitura</th>
                      <th className="px-3 py-2 text-right font-medium">Tamanho</th>
                      <th className="py-2 pl-3 text-right font-medium">Atualizado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.arquivos.map((a) => {
                      const pct = a.tamanho > 0 ? Math.min(100, (a.posicao_lida / a.tamanho) * 100) : 100;
                      return (
                        <tr key={a.nome_arquivo} className="border-b border-zinc-100 last:border-0">
                          <td className="py-2 pr-3 font-mono text-[13px]">{a.nome_arquivo}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-28 rounded-full bg-zinc-100">
                                <div className="h-1.5 rounded-full bg-destaque" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs tabular-nums text-zinc-500">{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatarBytes(a.tamanho)}</td>
                          <td className="py-2 pl-3 text-right text-xs text-zinc-500">{formatarDataHora(a.atualizado_em)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Cartao>
        );
      })}
    </div>
  );
}
