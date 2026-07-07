"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { classify, GRUPO_CHIP, GRUPO_LABEL, type Grupo } from "@/lib/classify";
import type { LeadRow } from "@/lib/leads";
import {
  exportLeadsToCsv,
  exportLeadsToXlsx,
  type ExportMeta,
} from "@/lib/export-leads";

type Props = {
  leads: LeadRow[];
  /** Nome da workspace — vai no título do arquivo exportado. */
  workspaceName: string;
  /** Rótulo conciso do período (ex: "Últimos 7 dias") — vai no subtítulo. */
  periodLabel: string;
  /** Se há filtros aplicados — nota no arquivo exportado. */
  filtersActive: boolean;
};

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

export function LeadsTable({ leads, workspaceName, periodLabel, filtersActive }: Props) {
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
        <ExportMenu
          leads={leads}
          meta={{ workspaceName, periodLabel, filtersActive }}
        />
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
                      {GRUPO_LABEL[g]}
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

function ExportMenu({
  leads,
  meta,
}: {
  leads: LeadRow[];
  meta: Omit<ExportMeta, "exportedAt">;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "xlsx" | "csv">(null);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function runXlsx() {
    setBusy("xlsx");
    try {
      await exportLeadsToXlsx(leads, { ...meta, exportedAt: new Date() });
      setOpen(false);
    } catch (e) {
      console.error("[export] xlsx falhou", e);
      alert("Não foi possível gerar o Excel agora. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  function runCsv() {
    setBusy("csv");
    try {
      exportLeadsToCsv(leads, { ...meta, exportedAt: new Date() });
      setOpen(false);
    } catch (e) {
      console.error("[export] csv falhou", e);
      alert("Não foi possível gerar o CSV agora. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={ref} className="relative ml-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[color:var(--foreground)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--aton-blue)]/40 hover:text-[color:var(--aton-blue)] hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[color:var(--muted-foreground)]/30 border-t-[color:var(--aton-blue)]" />
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        )}
        {busy ? "Gerando…" : "Exportar"}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1.5 w-60 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--popover)] shadow-xl"
        >
          <ExportItem
            title="Excel (.xlsx)"
            subtitle="Formatado, pronto pra visualizar"
            onClick={runXlsx}
            disabled={busy !== null}
            accent
          />
          <div className="h-px bg-[color:var(--border)]" />
          <ExportItem
            title="CSV (.csv)"
            subtitle="Dados crus, pra reimportar"
            onClick={runCsv}
            disabled={busy !== null}
          />
        </div>
      )}
    </div>
  );
}

function ExportItem({
  title,
  subtitle,
  onClick,
  disabled,
  accent,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[color:var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold " +
          (accent
            ? "bg-[color:var(--aton-blue)]/12 text-[color:var(--aton-blue)]"
            : "bg-[color:var(--muted)] text-[color:var(--muted-foreground)]")
        }
        aria-hidden
      >
        {accent ? "XLS" : "CSV"}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-[color:var(--foreground)]">
          {title}
        </span>
        <span className="block truncate text-[10px] text-[color:var(--muted-foreground)]">
          {subtitle}
        </span>
      </span>
    </button>
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
