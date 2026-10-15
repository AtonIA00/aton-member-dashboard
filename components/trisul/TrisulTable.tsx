"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TrisulAtendimento } from "@/lib/trisul";
import { exportTrisulCsv, exportTrisulXlsx, type TrisulExportMeta } from "@/lib/export-trisul";
import { useTableDrilldown, type DrilldownField } from "@/lib/use-table-drilldown";
import {
  aguardaCoordenador,
  ehParceiro,
  pendenteDirecionamento,
} from "@/lib/trisul-direcionamento";
import { TrisulDetailPanel, fmtDataHora } from "./TrisulDetailPanel";

type HmacParams = {
  workspace_id: string;
  user_id: string;
  timestamp: string;
  signature: string;
  user_name?: string;
};

type Props = {
  atendimentos: TrisulAtendimento[];
  periodLabel: string;
  filtersActive: boolean;
  hmac: HmacParams;
};

const PAGE_SIZE = 50;

const RESULTADO_OPTIONS = [
  { value: "confirmado_atualizado", label: "Confirmado/Ativo" },
  { value: "nao_atua_mercado", label: "Não atua no mercado" },
  { value: "nao_atua_parcerias", label: "Não atua com parcerias" },
  { value: "negativa_explicita", label: "Negativa explícita" },
  { value: "sem_interacao", label: "Sem interação" },
  { value: "em_andamento", label: "Em andamento" },
];
function resultadoKey(a: TrisulAtendimento): string {
  return a.resultado && a.resultado.trim() ? a.resultado.trim() : "em_andamento";
}
function resultadoLabel(a: TrisulAtendimento): string {
  const k = resultadoKey(a);
  return RESULTADO_OPTIONS.find((o) => o.value === k)?.label ?? k;
}

// Filtro local da tabela (drill-down) — dataset inteiro, antes da paginação.
const TRISUL_TABLE_FIELDS: DrilldownField<TrisulAtendimento>[] = [
  {
    key: "resultado",
    label: "Resultado",
    allLabel: "Todos",
    get: resultadoKey,
    options: RESULTADO_OPTIONS,
  },
  {
    key: "parceiro",
    label: "É parceiro",
    allLabel: "Todos",
    get: (a) => ehParceiro(a),
    options: [
      { value: "sim", label: "É parceiro: Sim" },
      { value: "nao", label: "É parceiro: Não" },
    ],
  },
  {
    key: "aguarda",
    label: "Aguarda coordenador",
    allLabel: "Todos",
    get: (a) => (aguardaCoordenador(a) ? "sim" : ""),
    options: [{ value: "sim", label: "Aguarda coordenador: Sim" }],
  },
  {
    key: "direcionamento",
    label: "Direcionamento",
    allLabel: "Todos",
    get: (a) => (a.direcionado_em ? "direcionado" : pendenteDirecionamento(a) ? "pendente" : ""),
    options: [
      { value: "pendente", label: "Pendentes" },
      { value: "direcionado", label: "Direcionados" },
    ],
  },
  { key: "campanha", label: "Campanha", allLabel: "Todas", get: (a) => a.campanha ?? "" },
  { key: "coordenador", label: "Coordenador", allLabel: "Todos", get: (a) => a.coordenador_nome ?? "" },
  {
    key: "fup",
    label: "FUP",
    allLabel: "Todos",
    get: (a) => String(a.tentativas_fup ?? 0),
    options: [
      { value: "0", label: "0 follow-ups" },
      { value: "1", label: "1 follow-up" },
      { value: "2", label: "2 follow-ups" },
      { value: "3", label: "3 follow-ups" },
    ],
  },
];

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

type DirecionamentoPatch = Pick<TrisulAtendimento, "direcionado_em" | "direcionado_para" | "direcionado_por">;

const EMPTY = <span className="text-[color:var(--muted-foreground)]/60">—</span>;

export function TrisulTable({ atendimentos, periodLabel, filtersActive, hmac }: Props) {
  const router = useRouter();
  // Atualização otimista do direcionamento: sobrepõe as linhas que vieram do
  // servidor até o router.refresh() trazer o valor gravado.
  const [overrides, setOverrides] = useState<Record<string, DirecionamentoPatch>>({});
  const rows = useMemo(
    () =>
      Object.keys(overrides).length === 0
        ? atendimentos
        : atendimentos.map((a) => (overrides[a.id] ? { ...a, ...overrides[a.id] } : a)),
    [atendimentos, overrides],
  );

  // Filtro local (drill-down) sobre o dataset inteiro, ANTES da paginação.
  const { filtered, bar, selected, select } = useTableDrilldown(rows, TRISUL_TABLE_FIELDS);
  const [page, setPage] = useState(0);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), [filtered.length]);
  const safePage = Math.min(page, totalPages - 1);
  const slice = useMemo(() => filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE), [filtered, safePage]);

  const pendentes = useMemo(() => rows.filter(pendenteDirecionamento).length, [rows]);
  const filtrandoPendentes = selected.direcionamento === "pendente";

  const [openId, setOpenId] = useState<string | null>(null);
  const openRow = useMemo(() => (openId ? rows.find((a) => a.id === openId) ?? null : null), [rows, openId]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const direcionar = useCallback(
    async (a: TrisulAtendimento, direcionado: boolean, paraIn: string) => {
      const para = paraIn.trim();
      const anterior: DirecionamentoPatch = {
        direcionado_em: a.direcionado_em,
        direcionado_para: a.direcionado_para,
        direcionado_por: a.direcionado_por,
      };
      const otimista: DirecionamentoPatch = direcionado
        ? {
            direcionado_em: new Date().toISOString(),
            direcionado_para: para || null,
            direcionado_por: hmac.user_name?.trim() || "você",
          }
        : { direcionado_em: null, direcionado_para: null, direcionado_por: null };
      setErro(null);
      setBusyId(a.id);
      setOverrides((o) => ({ ...o, [a.id]: otimista }));
      try {
        const res = await fetch("/api/trisul/direcionar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: a.id,
            direcionado,
            para,
            workspace_id: hmac.workspace_id,
            user_id: hmac.user_id,
            timestamp: hmac.timestamp,
            signature: hmac.signature,
            user_name: hmac.user_name,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { row?: DirecionamentoPatch };
        if (json.row) {
          const salvo: DirecionamentoPatch = {
            direcionado_em: json.row.direcionado_em,
            direcionado_para: json.row.direcionado_para,
            direcionado_por: json.row.direcionado_por,
          };
          setOverrides((o) => ({ ...o, [a.id]: salvo }));
        }
        router.refresh();
      } catch (e) {
        console.error("[trisul] direcionar", e);
        setOverrides((o) => ({ ...o, [a.id]: anterior }));
        const msg = "Não foi possível salvar agora. Recarregue o painel e tente de novo.";
        setErro(msg);
        if (!openId) alert(msg);
      } finally {
        setBusyId(null);
      }
    },
    [hmac, router, openId],
  );

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
          {filtered.length.toLocaleString("pt-BR")}
          {filtered.length !== atendimentos.length
            ? ` de ${atendimentos.length.toLocaleString("pt-BR")}`
            : " no total"}
          <span className="ml-2 opacity-60">· página {safePage + 1} de {totalPages}</span>
        </span>
        <ExportMenu atendimentos={filtered} meta={{ periodLabel, filtersActive: filtersActive || filtered.length !== atendimentos.length }} />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--border)] px-6 py-3">
        <button
          type="button"
          onClick={() => {
            select("direcionamento", filtrandoPendentes ? "" : "pendente");
            setPage(0);
          }}
          aria-pressed={filtrandoPendentes}
          className={
            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors " +
            (pendentes > 0
              ? "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")
          }
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {pendentes === 0
            ? "Nenhum parceiro pendente de direcionamento"
            : `${pendentes.toLocaleString("pt-BR")} ${pendentes === 1 ? "parceiro pendente" : "parceiros pendentes"} de direcionamento`}
          {pendentes > 0 && (
            <span className="font-normal underline decoration-dotted underline-offset-2">
              {filtrandoPendentes ? "mostrar todos" : "ver pendentes"}
            </span>
          )}
        </button>
        <span className="text-[11px] text-[color:var(--muted-foreground)]">
          Clique em uma linha para ver o resumo da conversa e direcionar o parceiro.
        </span>
      </div>

      {bar}

      {filtered.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-[color:var(--muted-foreground)]">
          Nenhum atendimento bate com os filtros da lista.
        </div>
      ) : (
        <>
          <div className="max-h-[640px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[color:var(--card)]">
            <tr>
              <Th>Disparo</Th>
              <Th>FAC ID</Th>
              <Th>Nome</Th>
              <Th>E-mail</Th>
              <Th>Telefone</Th>
              <Th align="center">É parceiro</Th>
              <Th>Resultado</Th>
              <Th>Coordenador base anterior</Th>
              <Th>Gerente base anterior</Th>
              <Th align="center">Aguarda coordenador</Th>
              <Th align="center">Direcionado</Th>
            </tr>
          </thead>
          <tbody>
            {slice.map((a) => {
              const chip = resultadoChip(a.resultado, a.convertido);
              const parceiro = ehParceiro(a);
              const aguarda = aguardaCoordenador(a);
              const direcionado = Boolean(a.direcionado_em);
              return (
                <tr
                  key={a.id}
                  onClick={() => {
                    setErro(null);
                    setOpenId(a.id);
                  }}
                  className="cursor-pointer border-t border-[color:var(--border)]/60 align-top transition-colors hover:bg-[color:var(--primary)]/5"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[color:var(--muted-foreground)] tabular-nums">{fmtDateTime(a.disparo_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[color:var(--muted-foreground)]">{a.partner_id ?? "—"}</td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-sm font-medium text-[color:var(--foreground)]">
                    {a.nome ?? EMPTY}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-xs text-[color:var(--foreground)]/90">
                    {a.email ?? EMPTY}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[color:var(--muted-foreground)]">{a.telefone ?? "—"}</td>
                  <td className="px-4 py-3 text-center text-xs font-semibold">
                    {parceiro === "sim" ? (
                      <span className="text-emerald-700 dark:text-emerald-300">Sim</span>
                    ) : parceiro === "nao" ? (
                      <span className="text-[color:var(--muted-foreground)]">Não</span>
                    ) : (
                      EMPTY
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={"inline-block whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide " + chip.cls}>
                      {chip.label}
                    </span>
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-xs text-[color:var(--foreground)]/90">
                    {a.coordenador_nome ?? EMPTY}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-xs text-[color:var(--foreground)]/90">
                    {a.gerente_nome ?? EMPTY}
                  </td>
                  <td className="px-4 py-3 text-center text-xs font-semibold">
                    {aguarda ? <span className="text-amber-700 dark:text-amber-300">Sim</span> : EMPTY}
                  </td>
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <label
                      className="inline-flex cursor-pointer items-center gap-1.5"
                      title={
                        direcionado
                          ? `Direcionado para ${a.direcionado_para || "coordenador"} em ${fmtDataHora(a.direcionado_em)}${a.direcionado_por ? ` por ${a.direcionado_por}` : ""}`
                          : "Marcar como direcionado para o coordenador da base anterior"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={direcionado}
                        disabled={busyId === a.id}
                        onChange={(e) => void direcionar(a, e.target.checked, a.coordenador_nome ?? "")}
                        aria-label={`Direcionado: ${a.nome ?? "parceiro"}`}
                        className="h-4 w-4 cursor-pointer accent-[color:var(--primary)] disabled:opacity-50"
                      />
                      {direcionado && (
                        <span className="whitespace-nowrap text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
                          {fmtDataHora(a.direcionado_em)}
                        </span>
                      )}
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-[color:var(--border)] px-6 py-3 text-xs text-[color:var(--muted-foreground)]">
              <span className="tabular-nums">
                Mostrando {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} de {filtered.length.toLocaleString("pt-BR")}
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
        </>
      )}

      {openRow && (
        <TrisulDetailPanel
          key={openRow.id}
          atendimento={openRow}
          resultadoLabel={resultadoLabel(openRow)}
          busy={busyId === openRow.id}
          erro={erro}
          onClose={() => setOpenId(null)}
          onDirecionar={(dir, para) => void direcionar(openRow, dir, para)}
        />
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
