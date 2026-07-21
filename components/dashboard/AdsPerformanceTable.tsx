"use client";

import { useMemo, useState } from "react";
import type { AdsPerfRow } from "@/lib/leads";
import type { Delta } from "@/lib/deltas";

type Props = { rows: AdsPerfRow[] };

type SortCol =
  | "rank"
  | "id"
  | "agendados"
  | "pctAgend"
  | "pctMql"
  | "pctInteracao"
  | "total";
type SortDir = "asc" | "desc";

function pct(n: number): string {
  return (n * 100).toFixed(1).replace(".", ",") + "%";
}

// Heat pills com contraste em ambos os temas. Light usa tons -700 sobre bg
// -100 (claro); dark usa tons -300/-400 sobre bg /15 (suave). Token Aton
// pra "verde" = emerald (#10b981), "amarelo" = amber, "laranja" = orange,
// "vermelho" = destructive (red).
//
// hC(v, [t0, t1, t2]) → t2+: verde, t1+: amarelo, t0+: laranja, abaixo: vermelho.
function heatClass(v: number, thresholds: [number, number, number]): string {
  const v100 = v * 100;
  if (v100 >= thresholds[2])
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  if (v100 >= thresholds[1])
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  if (v100 >= thresholds[0])
    return "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300";
  return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
}

const PCT_AGEND_THRESHOLDS: [number, number, number] = [5, 15, 30];
const PCT_MQL_THRESHOLDS: [number, number, number] = [10, 30, 50];
const PCT_INTERACAO_THRESHOLDS: [number, number, number] = [30, 60, 80];

export function AdsPerformanceTable({ rows }: Props) {
  const [sortCol, setSortCol] = useState<SortCol>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    // Sempre manter "Sem ID" (isUnknownId) no topo, conforme spec.
    const unknown = rows.filter((r) => r.isUnknownId);
    const known = [...rows.filter((r) => !r.isUnknownId)];
    known.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortCol) {
        case "rank":
          return (a.rank - b.rank) * dir;
        case "id":
          return a.idAnuncio.localeCompare(b.idAnuncio) * dir;
        case "agendados":
          return (a.agendados - b.agendados) * dir;
        case "pctAgend":
          return (a.pctAgendamento - b.pctAgendamento) * dir;
        case "pctMql":
          return (a.pctMql - b.pctMql) * dir;
        case "pctInteracao":
          return (a.pctInteracao - b.pctInteracao) * dir;
        case "total":
        default:
          return (a.total - b.total) * dir;
      }
    });
    return [...unknown, ...known];
  }, [rows, sortCol, sortDir]);

  function toggle(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "id" ? "asc" : "desc");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)]/70 p-6 text-center text-sm text-[color:var(--muted-foreground)] backdrop-blur">
        Nenhum anúncio com leads no período selecionado.
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
          Performance por Anúncio
        </h2>
        <span className="ml-auto text-[11px] text-[color:var(--muted-foreground)]/70">
          {rows.length} {rows.length === 1 ? "anúncio" : "anúncios"}
        </span>
      </div>

      <div className="max-h-[460px] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[color:var(--card)]">
            <tr>
              <Th col="rank" sortCol={sortCol} sortDir={sortDir} onClick={toggle}>
                #
              </Th>
              <Th col="id" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="left">
                ID Anúncio
              </Th>
              <Th col="agendados" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="right">
                Agendados
              </Th>
              <Th col="pctAgend" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="right">
                % Agendamento
              </Th>
              <Th col="pctMql" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="right">
                % MQL
              </Th>
              <Th col="pctInteracao" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="right">
                % Interação
              </Th>
              <Th col="total" sortCol={sortCol} sortDir={sortDir} onClick={toggle} align="right">
                Total
              </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={`${r.idAnuncio}-${i}`}
                className="border-t border-[color:var(--border)]/60 transition-colors hover:bg-[color:var(--primary)]/5"
              >
                <td className="px-4 py-3 text-xs text-[color:var(--muted-foreground)]">
                  {r.isUnknownId ? "—" : r.rank}
                </td>
                <td className="max-w-[260px] truncate px-4 py-3 font-mono text-xs text-[color:var(--foreground)]">
                  {r.isUnknownId ? (
                    <span className="italic text-[color:var(--muted-foreground)]/80">
                      Sem ID
                    </span>
                  ) : (
                    r.idAnuncio
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums text-[color:var(--foreground)]">
                  {r.agendados.toLocaleString("pt-BR")}
                </td>
                <td className="px-4 py-3 text-right">
                  <HeatPill v={r.pctAgendamento} thresholds={PCT_AGEND_THRESHOLDS} />
                  {r.pctAgendamentoDelta && <DeltaLine delta={r.pctAgendamentoDelta} />}
                </td>
                <td className="px-4 py-3 text-right">
                  <HeatPill v={r.pctMql} thresholds={PCT_MQL_THRESHOLDS} />
                  {r.pctMqlDelta && <DeltaLine delta={r.pctMqlDelta} />}
                </td>
                <td className="px-4 py-3 text-right">
                  <HeatPill v={r.pctInteracao} thresholds={PCT_INTERACAO_THRESHOLDS} />
                  {r.pctInteracaoDelta && <DeltaLine delta={r.pctInteracaoDelta} />}
                </td>
                <td className="px-4 py-3 text-right font-bold tabular-nums text-[color:var(--foreground)]">
                  <div>{r.total.toLocaleString("pt-BR")}</div>
                  {r.totalDelta && <DeltaLine delta={r.totalDelta} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  col,
  sortCol,
  sortDir,
  onClick,
  align,
  children,
}: {
  col: SortCol;
  sortCol: SortCol;
  sortDir: SortDir;
  onClick: (c: SortCol) => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = col === sortCol;
  const dir = active ? (sortDir === "asc" ? "↑" : "↓") : "";
  return (
    <th
      scope="col"
      className={
        "px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)] " +
        (align === "right" ? "text-right" : "text-left")
      }
    >
      <button
        type="button"
        onClick={() => onClick(col)}
        className={
          "inline-flex items-center gap-1 hover:text-[color:var(--primary)] " +
          (active ? "text-[color:var(--primary)]" : "")
        }
      >
        {children} <span aria-hidden>{dir}</span>
      </button>
    </th>
  );
}

// Delta compacto vs. período anterior — mesma régua/cores dos KPIs. Usado
// no Total (count) e nas colunas de % (pontos percentuais). Só aparece
// quando há período anterior (filtro de data).
function DeltaLine({ delta }: { delta: Delta }) {
  const cls =
    delta.classification === "positive"
      ? "text-[#10b981]"
      : delta.classification === "negative"
        ? "text-[color:var(--destructive)]"
        : "text-[color:var(--muted-foreground)]";
  const label = delta.direction === "new" ? "novo" : delta.formatted;
  return (
    <span
      className={"mt-0.5 block text-[10px] font-medium " + cls}
      title={`Atual: ${delta.value} · Anterior: ${delta.valuePrevious}`}
    >
      {label}
    </span>
  );
}

function HeatPill({
  v,
  thresholds,
}: {
  v: number;
  thresholds: [number, number, number];
}) {
  return (
    <span
      className={
        "inline-block min-w-[3.25rem] rounded px-2 py-1 text-center text-[11px] font-bold tabular-nums " +
        heatClass(v, thresholds)
      }
    >
      {(v * 100).toFixed(1).replace(".", ",")}
    </span>
  );
}
