/**
 * Configuração da ferramenta, lida das variáveis de ambiente.
 *
 * Sem nenhum arquivo .env, a ferramenta usa o banco do docker compose e funciona pelo envio de
 * arquivos de log. Para o coletor acompanhar um servidor, basta informar LOG_DIR (veja .env.example).
 */
import path from "node:path";
import os from "node:os";

// a aplicação Next.js já carrega o .env; o coletor e os scripts carregam aqui
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: valores padrão
}

const texto = (nome: string, padrao: string) => process.env[nome] ?? padrao;
const numero = (nome: string, padrao: number) => {
  const v = Number(process.env[nome]);
  return process.env[nome] !== undefined && process.env[nome] !== "" && Number.isFinite(v) ? v : padrao;
};

export const config = {
  /** banco de dados da ferramenta */
  get bancoFerramenta() {
    return texto("DATABASE_URL", "postgres://ferramenta:ferramenta@127.0.0.1:5433/ferramenta");
  },

  // ---- coletor
  /** nome com que o servidor monitorado aparece no painel */
  get servidorNome() {
    return texto("SERVIDOR_NOME", "local");
  },
  /** diretório dos arquivos de log do servidor monitorado (necessário para o coletor) */
  get diretorioLogs() {
    return process.env.LOG_DIR || undefined;
  },
  /** csvlog ou jsonlog; vazio: identificado pela extensão dos arquivos do diretório */
  get formatoLog() {
    const f = process.env.LOG_FORMAT;
    return f === "csvlog" || f === "jsonlog" ? f : undefined;
  },
  /** conexão somente leitura para os snapshots do pg_stat_statements (opcional) */
  get monitoradoUrl() {
    return process.env.MONITORADO_URL || undefined;
  },
  /** grava apenas o texto normalizado, sem os valores das consultas */
  get anonimizar() {
    return process.env.ANONIMIZAR_VALORES === "true";
  },
  /** dias até as ocorrências e os snapshots serem removidos (0 = nunca) */
  get retencaoDias() {
    return numero("RETENCAO_DIAS", 30);
  },
  get intervaloLeituraMs() {
    return numero("INTERVALO_LEITURA_MS", 2000);
  },
  get intervaloSnapshotMs() {
    return numero("INTERVALO_SNAPSHOT_MS", 60000);
  },
  get blocoLeituraKb() {
    return Math.max(64, numero("BLOCO_LEITURA_KB", 1024));
  },
  get prioridadeColetor() {
    return numero("PRIORIDADE_COLETOR", 10);
  },

  // ---- site (envio de arquivos)
  /** hospedado: site público, apenas com o envio de arquivos e os relatórios */
  get hospedado() {
    return process.env.MODO === "hospedado";
  },
  get maxUploadMb() {
    return numero("MAX_UPLOAD_MB", 1024);
  },
  get retencaoAnaliseHoras() {
    return numero("RETENCAO_ANALISE_HORAS", 72);
  },
  get diretorioUploads() {
    return path.resolve(/*turbopackIgnore: true*/ texto("DIR_UPLOADS", path.join(os.tmpdir(), "sqm-uploads")));
  },

};
