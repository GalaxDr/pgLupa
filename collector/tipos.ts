/** Campos de um registro do log do PostgreSQL utilizados pelo coletor. */
export interface RegistroLog {
  /** Data e hora no formato do PostgreSQL (ex.: "2026-11-04 15:30:00.123 UTC"), convertida no próprio banco. */
  dataHora: string;
  usuario: string | null;
  banco: string | null;
  pid: number | null;
  hostCliente: string | null;
  severidade: string | null;
  mensagem: string;
  detalhe: string | null;
  aplicacao: string | null;
  tipoProcesso: string | null;
  queryId: string | null;
}

/** Resultado da interpretação de um trecho do arquivo de log. */
export interface TrechoInterpretado {
  registros: RegistroLog[];
  /** Quantidade de bytes correspondente aos registros completos lidos. */
  bytesConsumidos: number;
}

export type FormatoLog = "csvlog" | "jsonlog";
