import type { PerdaEtapa } from "@/lib/marcos";

// Perdas do funil até a venda (Launch e Portovelas, 11/11/2026): onde o lead
// saiu e por quê, pelos marcos que o CRM grava. Complementa a coluna de perda
// do funil, que só sabe a diferença entre uma etapa e a seguinte.

function int(n: number): string {
  return n.toLocaleString("pt-BR");
}

export function PerdasFunil({ perdas }: { perdas: PerdaEtapa[] }) {
  const total = perdas.reduce((s, p) => s + p.total, 0);

  return (
    <div className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-6 backdrop-blur">
      <div className="mb-5 flex items-center gap-2">
        <span aria-hidden className="block h-4 w-1 rounded-sm bg-[color:var(--primary)]" />
        <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
          Perdas do funil
        </h2>
        {total > 0 && (
          <span className="ml-auto text-[11px] text-[color:var(--muted-foreground)]/80">
            {int(total)} {total === 1 ? "lead saiu" : "leads saíram"} no período
          </span>
        )}
      </div>

      {total === 0 ? (
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Nenhuma perda registrada no período.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[color:var(--border)]">
          {perdas.map((p) => (
            <li key={p.etapa} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start">
              <div className="flex items-baseline gap-3 sm:w-80 sm:flex-shrink-0">
                <span className="w-8 text-right text-lg tabular-nums text-[color:var(--foreground)]">
                  {int(p.total)}
                </span>
                <span className="text-sm text-[color:var(--foreground)]">{p.rotulo}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-11 sm:pl-0">
                {p.motivos.map((m) => (
                  <span
                    key={m.rotulo}
                    className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)]/60 px-2.5 py-0.5 text-[11px] text-[color:var(--muted-foreground)]"
                  >
                    {m.rotulo} · {int(m.total)}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
