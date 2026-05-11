import type { FunnelStep } from "@/lib/leads";

type Props = { steps: FunnelStep[] };

// Cores idênticas ao dashboard.html do CRM Master, mas usando os tokens
// CSS do design system Aton. Ordem: Leads Totais → Interagiram → MQL Sim → Agendado+.
const STEP_COLORS = [
  "var(--primary)",         // ciano
  "#4FC3F7",                // azul-claro (Interagiram = "Está no script" + além)
  "#69F0AE",                // verde (MQL Sim)
  "#FFD740",                // amber (Agendado+)
];

function pct(n: number): string {
  return (n * 100).toFixed(1).replace(".", ",") + "%";
}

function int(n: number): string {
  return n.toLocaleString("pt-BR");
}

export function Funnel({ steps }: Props) {
  const max = Math.max(1, ...steps.map((s) => s.count));

  return (
    <div className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-6 backdrop-blur">
      <div className="mb-5 flex items-center gap-2">
        <span
          aria-hidden
          className="block h-4 w-1 rounded-sm bg-[color:var(--primary)]"
        />
        <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
          Funil de Qualificação
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        {steps.map((s, i) => {
          const widthPct = Math.max((s.count / max) * 100, s.count > 0 ? 3 : 0);
          const color = STEP_COLORS[i] ?? "var(--muted-foreground)";
          return (
            <div key={s.label} className="flex items-center gap-3">
              <div className="w-28 flex-shrink-0 text-right text-xs font-semibold text-[color:var(--muted-foreground)]">
                {s.label}
              </div>
              <div className="relative h-8 flex-1 overflow-hidden rounded-md bg-white/[0.03]">
                <div
                  className="absolute inset-y-0 left-0 flex items-center rounded-md px-2.5 text-[11px] font-bold text-[color:var(--background)] transition-[width] duration-500"
                  style={{
                    width: `${widthPct}%`,
                    background: color,
                    minWidth: s.count > 0 ? "2.25rem" : "0",
                  }}
                >
                  {s.count > 0 ? int(s.count) : ""}
                </div>
              </div>
              <div className="w-14 flex-shrink-0 text-right text-xs text-[color:var(--muted-foreground)]/80">
                {pct(s.pctOfTotal)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
