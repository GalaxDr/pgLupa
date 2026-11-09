import { EnvioArquivo } from "./EnvioArquivo";
import { Cartao } from "./Cartao";

/** Página de envio de arquivo de log para análise. */
export function PaginaEnvio({ limiteMb, retencaoHoras }: { limiteMb: number; retencaoHoras: number }) {
  const retencao = retencaoHoras % 24 === 0 ? `${retencaoHoras / 24} dia${retencaoHoras / 24 > 1 ? "s" : ""}` : `${retencaoHoras} horas`;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="pt-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Análise de queries lentas do PostgreSQL</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-600">
          Envie o arquivo de log do seu servidor PostgreSQL e receba um relatório interativo com as consultas que
          ultrapassaram o limite de <code className="font-mono">log_min_duration_statement</code>, agrupadas e ordenadas
          pelo impacto no desempenho.
        </p>
      </div>

      <EnvioArquivo limiteMb={limiteMb} />

      <p className="text-center text-xs text-zinc-500">
        O relatório fica disponível por {retencao} em um link exclusivo, que só quem tiver o endereço pode abrir. O
        arquivo enviado é apagado assim que o processamento termina. Como o log contém o texto das consultas, inclusive
        valores informados nelas, mantenha marcada a opção acima se elas puderem conter dados pessoais.
      </p>

      <Cartao titulo="Como gerar o arquivo de log" descricao="Configuração no postgresql.conf do servidor (requer recarregar a configuração)">
        <pre className="overflow-x-auto rounded-md bg-zinc-50 p-3 font-mono text-[13px] leading-relaxed text-zinc-800">{`logging_collector = on
log_destination = 'csvlog'            # ou 'jsonlog'
log_min_duration_statement = 200      # registra consultas acima de 200 ms
lc_messages = 'C'                     # mensagens em inglês
compute_query_id = on                 # identificador da consulta (opcional)`}</pre>
        <p className="mt-3 text-sm text-zinc-600">
          Os arquivos ficam no diretório definido em <code className="font-mono">log_directory</code> (por padrão,{" "}
          <code className="font-mono">log</code> dentro do diretório de dados), com a extensão <code className="font-mono">.csv</code> ou{" "}
          <code className="font-mono">.json</code>.
        </p>
      </Cartao>
    </div>
  );
}
