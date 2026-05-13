"use client";

import { useMemo, useState } from "react";
import { classify, GRUPO_CHIP, type Grupo } from "@/lib/classify";
import type { LeadRow } from "@/lib/leads";

type Props = { leads: LeadRow[] };

const PAGE_SIZE = 50;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fmtTelefone(ddd: string | null, tel: string | null): string {
  const t = (tel ?? "").trim();
  if (!t) return "—";
  const d = (ddd ?? "").trim();
  if (d && !t.startsWith(d) && !t.startsWith(`+${d}`)) {
    return `(${d}) ${t}`;
  }
  return t;
}

function fmtMql(mql: string | null): { label: string; cls: string } {
  const v = (mql ?? "").toLowerCase().trim();
  if (v === "sim") {
    return {
      label: "Sim",
      // emerald-700 em light pra contraste; -300 em dark mantém o look antigo.
      cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (v === "não" || v === "nao") {
    return {
      label: "Não",
      cls: "border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 text-[color:var(--destructive)]",
    };
  }
  return {
    label: "—",
    cls: "border-[color:var(--muted-foreground)]/30 bg-[color:var(--surface-2)]/60 text-[color:var(--muted-foreground)]",
  };
}

export function LeadsTable({ leads }: Props) {
  const [page, setPage] = useState(0);

  // Reset de página se a lista encolher (ex: trocou de período).
  // useMemo só pra fixar a referência estável.
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(leads.length / PAGE_SIZE)),
    [leads.length],
  );

  // Clamp na página atual quando o set de leads muda.
  const safePage = Math.min(page, totalPages - 1);

  const slice = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return leads.slice(start, start + PAGE_SIZE);
  }, [leads, safePage]);

  if (leads.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-6 text-center text-sm text-[color:var(--muted-foreground)] backdrop-blur">
        Nenhum lead no período selecionado.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-6 py-4">
        <span
          aria-hidden
          className="block h-4 w-1 rounded-sm bg-[color:var(--primary)]"
        />
        <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
          Leads detalhados
        </h2>
        <span className="ml-auto text-[11px] text-[color:var(--muted-foreground)]/70">
          {leads.length.toLocaleString("pt-BR")} no total
          <span className="ml-2 opacity-60">
            · página {safePage + 1} de {totalPages}
          </span>
        </span>
      </div>

      <div className="max-h-[640px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[color:var(--card)]">
            <tr>
              <Th>Data</Th>
              <Th>Campanha</Th>
              <Th>Nome</Th>
              <Th>Etapa</Th>
              <Th>Resumo</Th>
              <Th align="center">MQL</Th>
              <Th>Telefone</Th>
            </tr>
          </thead>
          <tbody>
            {slice.map((l) => {
              const g: Grupo = classify(l.etapa_funil);
              const chip = GRUPO_CHIP[g];
              const mql = fmtMql(l.mql);
              return (
                <tr
                  key={l.id}
                  className="border-t border-[color:var(--border)]/60 align-top transition-colors hover:bg-[color:var(--primary)]/5"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[color:var(--muted-foreground)] tabular-nums">
                    {fmtDate(l.data)}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-xs text-[color:var(--foreground)]/90">
                    {l.nome_campanha ?? <span className="text-[color:var(--muted-foreground)]/60">—</span>}
                  </td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-sm font-medium text-[color:var(--foreground)]">
                    {l.nome_lead ?? <span className="text-[color:var(--muted-foreground)]/60">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-block whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide"
                      style={{
                        backgroundColor: chip.bg,
                        color: chip.text,
                        borderColor: chip.border,
                      }}
                      title={l.etapa_funil ?? ""}
                    >
                      {g}
                    </span>
                  </td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-xs text-[color:var(--muted-foreground)]">
                    <span title={l.resumo_conversa ?? ""}>
                      {l.resumo_conversa ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={
                        "inline-block min-w-[2.5rem] rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase " +
                        mql.cls
                      }
                    >
                      {mql.label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[color:var(--muted-foreground)]">
                    {fmtTelefone(l.ddd_lead, l.telefone)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-[color:var(--border)] px-6 py-3 text-xs text-[color:var(--muted-foreground)]">
          <span className="tabular-nums">
            Mostrando {safePage * PAGE_SIZE + 1}–
            {Math.min((safePage + 1) * PAGE_SIZE, leads.length)} de{" "}
            {leads.length.toLocaleString("pt-BR")}
          </span>
          <div className="flex items-center gap-2">
            <PageBtn disabled={safePage === 0} onClick={() => setPage(0)}>«</PageBtn>
            <PageBtn disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              Anterior
            </PageBtn>
            <span className="px-2 tabular-nums">
              {safePage + 1} / {totalPages}
            </span>
            <PageBtn
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Próxima
            </PageBtn>
            <PageBtn
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
            >
              »
            </PageBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  const cls =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      scope="col"
      className={
        "px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)] " +
        cls
      }
    >
      {children}
    </th>
  );
}

function PageBtn({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-[color:var(--border)] bg-[color:var(--card)] px-2.5 py-1 text-xs text-[color:var(--foreground)] transition-colors hover:border-[color:var(--primary)]/40 hover:text-[color:var(--primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[color:var(--border)] disabled:hover:text-[color:var(--foreground)]"
    >
      {children}
    </button>
  );
}
