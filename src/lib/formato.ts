const num = new Intl.NumberFormat("pt-BR");
const dec1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export const formatarNumero = (v: number | null | undefined) => (v === null || v === undefined ? "–" : num.format(v));

/** Duração em milissegundos com a unidade mais legível (ms, s, min, h). */
export function formatarDuracao(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "–";
  if (ms < 1) return `${dec2.format(ms)} ms`;
  if (ms < 1000) return `${dec1.format(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${dec2.format(s)} s`;
  const min = s / 60;
  if (min < 60) return `${dec1.format(min)} min`;
  return `${dec1.format(min / 60)} h`;
}

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" });
export const formatarDataHora = (d: Date | string | null | undefined) => (d ? dataHora.format(new Date(d)) : "–");

/** Tempo decorrido em texto curto ("há 5 s", "há 3 min"). */
export function formatarHaQuanto(d: Date | string | null | undefined, agora = Date.now()): string {
  if (!d) return "nunca";
  const s = Math.max(0, Math.round((agora - new Date(d).getTime()) / 1000));
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}

export function formatarBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${dec1.format(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${dec1.format(b / 1024 ** 2)} MB`;
  return `${dec2.format(b / 1024 ** 3)} GB`;
}
