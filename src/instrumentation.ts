/** Executado uma vez quando o servidor Next.js inicia. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { executarMigracoes } = await import("./lib/migracoes");
  try {
    await executarMigracoes();
  } catch (e) {
    console.error("não foi possível atualizar o banco da ferramenta:", (e as Error).message);
    return;
  }
  const { modoHospedado, retomarAnalises, limparExpiradas } = await import("./lib/analises");
  await retomarAnalises();
  if (modoHospedado()) {
    limparExpiradas();
    setInterval(limparExpiradas, 30 * 60 * 1000).unref();
  }
}
