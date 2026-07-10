"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TrisulAtendimento } from "@/lib/trisul";
import { exportTrisulCsv, exportTrisulXlsx, type TrisulExportMeta } from "@/lib/export-trisul";

type Props = {
  atendimentos: TrisulAtendimento[];
  periodLabel: string;
  filtersActive: boolean;
};

const PAGE_SIZE = 50;

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function resultadoChip(r: string | null, convertido: boolean | null): { label: string; cls: string } {
  const v = (r ?? "").trim();
  if (v === "confirmado_atualizado" || convertido === true)
    return { label: "Confirmado", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
  if (v === "nao_atua_mercado")
    return { label: "Não atua mercado", cls: "border-[color:var(--muted-foreground)]/30 bg-[color:var(--surface-2)]/60 text-[color:var(--muted-foreground)]" };
  if (v === "nao_atua_parcerias")
    return { label: "Não atua parcerias", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  if (v === "negativa_explicita")
    return { label: "Negativa", cls: "border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 text-[color:var(--destructive)]" };
  if (v === "sem_interacao")
    return { label: "Sem interação", cls: "border-[color:var(--muted-foreground)]/30 bg-[color:var(--surface-2)]/60 text-[color:var(--muted-foreground)]" };
  return { label: "Em andamento", cls: "border-[color:var(--primary)]/40 bg-[color:var(--primary)]/10 text-[color:var(--primary)]" };
}

export function TrisulTable({ atendimentos, periodLabel, filtersActive }: Props) {
  const [page, setPage] = useState(0);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(atendimentos.length / PAGE_SIZE)), [atendimentos.length]);
  const safePage = Math.min(page, totalPages - 1);
  const slice = useMemo(() => atendimentos.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE), [atendimentos, safePage]);

  if (atendimentos.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-6 text-center text-sm text-[color:var(--muted-foreground)] backdrop-blur">
        Nenhum atendimento no período selecionado.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-6 py-4">
        <span aria-hidden className="block h-4 w-1 rounded-sm bg-[color:var(--primary)]" />
        <h2 className="font-[family-name:var(--font-montserrat)] text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--muted-foreground)]">
          Atendimentos
        </h2>
        <span className="ml-auto text-[11px] text-[color:var(--muted-foreground)]/70">
          {atendimentos.length.toLocaleString("pt-BR")} no total
          <span className="ml-2 opacity-60">· página {safePage + 1} de {totalPages}</span>
        </span>
        <ExportMenu atendimentos={atendimentos} meta={{ periodLabel, filtersActive }} />
      </div>

      <div className="max-h-[640px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[color:var(--card)]">
            <tr>
              <Th>Disparo</Th>
              <Th>Nome</Th>
              <Th>Coordenador</Th>
              <Th>Campanha</Th>
              <Th align="center">Envio</Th>
              <Th align="center">FUP</Th>
              <Th>Resultado</Th>
              <Th>Telefone</Th>
            </tr>
          </thead>
          <tbody>
            {slice.map((a) => {
              const chip = resultadoChip(a.resultado, a.convertido);
              return (
                <tr key={a.id} className="border-t border-[color:var(--border)]/60 align-top transition-colors hover:bg-[color:var(--primary)]/5">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[color:var(--muted-foreground)] tabular-nums">{fmtDateTime(a.disparo_at)}</td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-sm font-medium text-[color:var(--foreground)]">
                    {a.nome ?? <span className="text-[color:var(--muted-foreground)]/60">—</span>}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-xs text-[color:var(--foreground)]/90">
                    {a.coordenador_nome ?? <span className="text-[color:var(--muted-foreground)]/60">—</span>}
                  </td>
                  <td className="max-w-[140px] truncate px-4 py-3 text-xs text-[color:var(--foreground)]/90">
                    {a.campanha ?? <span className="text-[color:var(--muted-foreground)]/60">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-[color:var(--muted-foreground)]">{a.status_envio ?? "—"}</td>
                  <td className="px-4 py-3 text-center text-xs tabular-nums text-[color:var(--muted-foreground)]">{a.tentativas_fup ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={"inline-block whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide " + chip.cls}>
                      {chip.label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[color:var(--muted-foreground)]">{a.telefone ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-[color:var(--border)] px-6 py-3 text-xs text-[color:var(--muted-foreground)]">
          <span className="tabular-nums">
            Mostrando {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, atendimentos.length)} de {atendimentos.length.toLocaleString("pt-BR")}
          </span>
          <div className="flex items-center gap-2">
            <PageBtn disabled={safePage === 0} onClick={() => setPage(0)}>«</PageBtn>
            <PageBtn disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Anterior</PageBtn>
            <span className="px-2 tabular-nums">{safePage + 1} / {totalPages}</span>
            <PageBtn disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Próxima</PageBtn>
            <PageBtn disabled={safePage >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</PageBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function ExportMenu({ atendimentos, meta }: { atendimentos: TrisulAtendimento[]; meta: Omit<TrisulExportMeta, "exportedAt"> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "xlsx" | "csv">(null);
  const ref = useRef<HTMLDivElement>(null);

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
      await exportTrisulXlsx(atendimentos, { ...meta, exportedAt: new Date() });
      setOpen(false);
    } catch (e) {
      console.error("[trisul-export] xlsx", e);
      alert("Não foi possível gerar o Excel agora.");
    } finally {
      setBusy(null);
    }
  }
  function runCsv() {
    setBusy("csv");
    try {
      exportTrisulCsv(atendimentos, { ...meta, exportedAt: new Date() });
      setOpen(false);
    } catch (e) {
      console.error("[trisul-export] csv", e);
      alert("Não foi possível gerar o CSV agora.");
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
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[color:var(--foreground)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--aton-blue)]/40 hover:text-[color:var(--aton-blue)] hover:shadow-md active:translate-y-0 disabled:opacity-60"
      >
        {busy ? "Gerando…" : "Exportar"}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1.5 w-56 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--popover)] shadow-xl">
          <ExportItem title="Excel (.xlsx)" subtitle="Formatado" onClick={runXlsx} disabled={busy !== null} accent />
          <div className="h-px bg-[color:var(--border)]" />
          <ExportItem title="CSV (.csv)" subtitle="Dados crus" onClick={runCsv} disabled={busy !== null} />
        </div>
      )}
    </div>
  );
}

function ExportItem({ title, subtitle, onClick, disabled, accent }: { title: string; subtitle: string; onClick: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[color:var(--surface-2)] disabled:opacity-50">
      <span className={"flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold " + (accent ? "bg-[color:var(--aton-blue)]/12 text-[color:var(--aton-blue)]" : "bg-[color:var(--muted)] text-[color:var(--muted-foreground)]")} aria-hidden>
        {accent ? "XLS" : "CSV"}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-[color:var(--foreground)]">{title}</span>
        <span className="block truncate text-[10px] text-[color:var(--muted-foreground)]">{subtitle}</span>
      </span>
    </button>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "center" | "right" }) {
  const cls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th scope="col" className={"px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)] " + cls}>
      {children}
    </th>
  );
}

function PageBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="rounded border border-[color:var(--border)] bg-[color:var(--card)] px-2.5 py-1 text-xs text-[color:var(--foreground)] transition-colors hover:border-[color:var(--primary)]/40 hover:text-[color:var(--primary)] disabled:cursor-not-allowed disabled:opacity-40">
      {children}
    </button>
  );
}
