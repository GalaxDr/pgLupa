const PALAVRAS = new Set(
  ("select from where and or not in is null join left right inner outer full cross on group by order having limit offset " +
    "insert into values update set delete returning with as distinct case when then else end union all exists between like " +
    "ilike asc desc create table index alter drop begin commit rollback analyze explain over partition interval true false")
    .split(" "),
);

/** Exibe uma instrução SQL com destaque simples de palavras-chave, parâmetros e textos. */
export function Sql({ texto, className = "" }: { texto: string; className?: string }) {
  const partes = texto.split(/('(?:[^']|'')*'|\$\d+|\b[A-Za-z_]+\b)/g);
  return (
    <pre className={`overflow-x-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-zinc-800 ${className}`}>
      {partes.map((p, i) => {
        if (!p) return null;
        if (p.startsWith("'")) return <span key={i} className="sql-str">{p}</span>;
        if (/^\$\d+$/.test(p)) return <span key={i} className="sql-param">{p}</span>;
        if (PALAVRAS.has(p.toLowerCase())) return <span key={i} className="sql-kw">{p}</span>;
        return p;
      })}
    </pre>
  );
}
