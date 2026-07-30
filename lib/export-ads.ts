// Exportação da seção "Performance por Anúncio" em XLSX, CSV e PDF.
//
// Mesma arquitetura do export-leads.ts: roda 100% no client (os dados já estão
// no browser via props da AdsPerformanceTable), sem round-trip nem endpoint
// novo. As libs pesadas (exceljs ~1MB, jspdf ~400KB) entram por dynamic
// import SÓ no clique — ficam em chunk separado, fora do bundle inicial.
//
// COLUMNS é a fonte única: os três formatos leem dela, então nunca divergem.
// A ordem das colunas replica a leitura em funil da tela:
//   Invest. → CPM (custo de aparecer) → CTR link (quem clica) → CPL → R$/MQL
//   → R$/Conv.
//
// PDF usa a identidade do dash: wordmark Aton vetorial (mesmo path do
// AtonLogo, sem raster), aton-blue no cabeçalho, heat colors iguais aos das
// pills e o mesmo cartão de resumo custo × desfecho do topo da seção.

import type { AdsPerfRow, Kpis } from "@/lib/leads";
import type { MetaAdsForTable } from "@/lib/meta-ads";

export type AdsExportMeta = {
  workspaceName: string;
  /** Ex.: "Últimos 7 dias", "Todo o período". */
  periodLabel: string;
  /** Filtros ativos → nota no arquivo (e resumo de custo omitido no PDF, pelo
   *  mesmo motivo da tela: spend é da conta inteira). */
  filtersActive: boolean;
  exportedAt: Date;
};

// ── Paleta Aton (espelha app/globals.css e o heatClass da tabela) ──────────
const BRAND = {
  blue: "#0057ff",
  blueDark: "#0047cc",
  ink: "#111827",
  muted: "#6b7280",
  line: "#e5e7eb",
  zebra: "#f9fafb",
  green: "#10b981",
  amber: "#f59e0b",
  orange: "#f97316",
  red: "#dc2626",
} as const;

/** Mesmos cortes do heatClass (quartis do portfólio, 2026-07). */
const TH = {
  conv: [4, 9, 15] as const,
  mql: [10, 20, 30] as const,
  inter: [50, 65, 75] as const,
};

function heatHex(v01: number, t: readonly [number, number, number]): string {
  const v = v01 * 100;
  if (v >= t[2]) return BRAND.green;
  if (v >= t[1]) return BRAND.amber;
  if (v >= t[0]) return BRAND.orange;
  return BRAND.red;
}

// ── Formatters ─────────────────────────────────────────────────────────────
function money(v: number, currency: string): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function costPer(spend: number, count: number, currency: string): string {
  if (count <= 0) return "—";
  return money(spend / count, currency);
}

function pct1(v01: number): string {
  return (v01 * 100).toFixed(1).replace(".", ",") + "%";
}

function int(n: number): string {
  return n.toLocaleString("pt-BR");
}

function dateTimeBr(d: Date): string {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Colunas — fonte única dos 3 formatos ───────────────────────────────────
type AdTuple = MetaAdsForTable["ads"][string];

type Ctx = { meta: MetaAdsForTable | null; currency: string };

type AdsColumn = {
  header: string;
  /** Rótulo curto só pro PDF — a coluna é estreita e o autoTable elipsa
   *  ("Cliques link" virava "Cliques..."). Default = header. */
  pdfHeader?: string;
  width: number; // caracteres (XLSX)
  pdfWidth: number; // proporção (PDF)
  align?: "left" | "center" | "right";
  /** Só existe quando há dados de Meta Ads vinculados. */
  metaOnly?: boolean;
  value: (r: AdsPerfRow, ad: AdTuple | undefined, c: Ctx) => string;
  /** Valor numérico pro XLSX (célula de número real, permite somar/ordenar). */
  num?: (r: AdsPerfRow, ad: AdTuple | undefined) => number | null;
  numFmt?: string;
  guardCsv?: boolean;
  /** Cor do texto no PDF/XLSX (heat das taxas). */
  heat?: (r: AdsPerfRow) => string;
};

const COLUMNS: AdsColumn[] = [
  {
    header: "#",
    width: 5,
    pdfWidth: 18,
    align: "center",
    value: (r) => (r.isUnknownId ? "—" : String(r.rank)),
  },
  {
    header: "Anúncio",
    width: 34,
    pdfWidth: 92,
    value: (r, ad) => (r.isUnknownId ? "Sem ID" : (ad?.[4] ?? "")),
    guardCsv: true,
  },
  {
    header: "ID Anúncio",
    width: 21,
    pdfWidth: 60,
    value: (r) => (r.isUnknownId ? "" : r.idAnuncio),
    guardCsv: true,
  },
  {
    header: "Campanha",
    width: 30,
    pdfWidth: 0, // fora do PDF (não cabe; segue no XLSX/CSV)
    metaOnly: true,
    value: (_r, ad) => ad?.[6] ?? "",
    guardCsv: true,
  },
  {
    header: "Formato",
    width: 10,
    pdfWidth: 0,
    metaOnly: true,
    align: "center",
    value: (_r, ad) =>
      ad?.[7] === "video" ? "Vídeo" : ad?.[7] === "carousel" ? "Carrossel" : ad ? "Imagem" : "",
  },
  {
    header: "Leads",
    width: 8,
    pdfWidth: 26,
    align: "right",
    value: (r) => int(r.total),
    num: (r) => r.total,
  },
  {
    header: "Convertidos",
    pdfHeader: "Conv.",
    width: 12,
    pdfWidth: 26,
    align: "right",
    value: (r) => int(r.agendados),
    num: (r) => r.agendados,
  },
  {
    header: "% Conversão",
    pdfHeader: "% Conv.",
    width: 12,
    pdfWidth: 30,
    align: "right",
    value: (r) => pct1(r.pctAgendamento),
    num: (r) => r.pctAgendamento,
    numFmt: "0.0%",
    heat: (r) => heatHex(r.pctAgendamento, TH.conv),
  },
  {
    header: "MQL",
    width: 8,
    pdfWidth: 24,
    align: "right",
    value: (r) => int(r.mqlSim),
    num: (r) => r.mqlSim,
  },
  {
    header: "% MQL",
    width: 9,
    pdfWidth: 28,
    align: "right",
    value: (r) => pct1(r.pctMql),
    num: (r) => r.pctMql,
    numFmt: "0.0%",
    heat: (r) => heatHex(r.pctMql, TH.mql),
  },
  {
    header: "% Interação",
    pdfHeader: "% Inter.",
    width: 12,
    pdfWidth: 30,
    align: "right",
    value: (r) => pct1(r.pctInteracao),
    num: (r) => r.pctInteracao,
    numFmt: "0.0%",
    heat: (r) => heatHex(r.pctInteracao, TH.inter),
  },
  {
    header: "Investido",
    width: 13,
    pdfWidth: 38,
    align: "right",
    metaOnly: true,
    value: (_r, ad, c) => (ad ? money(ad[0], c.currency) : "—"),
    num: (_r, ad) => (ad ? ad[0] : null),
    numFmt: '"R$" #,##0.00',
  },
  {
    header: "CPM",
    width: 11,
    pdfWidth: 32,
    align: "right",
    metaOnly: true,
    value: (_r, ad, c) => (ad ? money(ad[3], c.currency) : "—"),
    num: (_r, ad) => (ad ? ad[3] : null),
    numFmt: '"R$" #,##0.00',
  },
  {
    header: "Impressões",
    pdfHeader: "Impr.",
    width: 12,
    pdfWidth: 32,
    align: "right",
    metaOnly: true,
    value: (_r, ad) => (ad ? int(ad[8]) : "—"),
    num: (_r, ad) => (ad ? ad[8] : null),
  },
  {
    header: "CTR link",
    width: 10,
    pdfWidth: 30,
    align: "right",
    metaOnly: true,
    value: (_r, ad) => (ad ? ad[1].toFixed(2).replace(".", ",") + "%" : "—"),
    num: (_r, ad) => (ad ? ad[1] / 100 : null),
    numFmt: "0.00%",
  },
  {
    header: "Cliques link",
    pdfHeader: "Cliques",
    width: 12,
    pdfWidth: 30,
    align: "right",
    metaOnly: true,
    value: (_r, ad) => (ad ? int(ad[9]) : "—"),
    num: (_r, ad) => (ad ? ad[9] : null),
  },
  {
    header: "CPC link",
    width: 11,
    pdfWidth: 0,
    align: "right",
    metaOnly: true,
    value: (_r, ad, c) => (ad ? money(ad[2], c.currency) : "—"),
    num: (_r, ad) => (ad ? ad[2] : null),
    numFmt: '"R$" #,##0.00',
  },
  {
    header: "CPL",
    width: 11,
    pdfWidth: 34,
    align: "right",
    metaOnly: true,
    value: (r, ad, c) => (ad ? costPer(ad[0], r.total, c.currency) : "—"),
    num: (r, ad) => (ad && r.total > 0 ? ad[0] / r.total : null),
    numFmt: '"R$" #,##0.00',
  },
  {
    header: "R$/MQL",
    width: 11,
    pdfWidth: 34,
    align: "right",
    metaOnly: true,
    value: (r, ad, c) => (ad ? costPer(ad[0], r.mqlSim, c.currency) : "—"),
    num: (r, ad) => (ad && r.mqlSim > 0 ? ad[0] / r.mqlSim : null),
    numFmt: '"R$" #,##0.00',
  },
  {
    header: "R$/Convertido",
    pdfHeader: "R$/Conv.",
    width: 14,
    pdfWidth: 34,
    align: "right",
    metaOnly: true,
    value: (r, ad, c) => (ad ? costPer(ad[0], r.agendados, c.currency) : "—"),
    num: (r, ad) => (ad && r.agendados > 0 ? ad[0] / r.agendados : null),
    numFmt: '"R$" #,##0.00',
  },
];

function activeColumns(hasMeta: boolean, forPdf: boolean): AdsColumn[] {
  return COLUMNS.filter(
    (c) => (hasMeta || !c.metaOnly) && (!forPdf || c.pdfWidth > 0),
  );
}

/** Resumo custo × desfecho — mesmos números do strip da tela. */
function summaryPairs(
  meta: MetaAdsForTable,
  kpis: Kpis,
): Array<{ label: string; value: string; sub: string }> {
  const c = meta.currency;
  return [
    { label: "Investimento", value: money(meta.totalSpend, c), sub: "Meta Ads no período" },
    { label: "CPL real", value: costPer(meta.totalSpend, kpis.total, c), sub: `${int(kpis.total)} leads na base` },
    { label: "Custo por MQL", value: costPer(meta.totalSpend, kpis.mqlSim, c), sub: `${int(kpis.mqlSim)} qualificados` },
    { label: "Custo por convertido", value: costPer(meta.totalSpend, kpis.agendadoPlus, c), sub: `${int(kpis.agendadoPlus)} convertidos` },
    {
      label: "CTR médio (link)",
      value: meta.avgCtr.toFixed(2).replace(".", ",") + "%",
      sub: `CPM ${money(meta.avgCpm, c)} · CPC ${money(meta.avgCpc, c)}`,
    },
  ];
}

// ── Helpers de arquivo (mesma convenção do export-leads) ───────────────────
function slugify(s: string): string {
  return (
    (s || "workspace")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

function fileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function buildFilename(meta: AdsExportMeta, ext: string): string {
  return `performance-anuncios-${slugify(meta.workspaceName)}-${fileStamp(meta.exportedAt)}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function subtitleLine(rows: AdsPerfRow[], meta: AdsExportMeta): string {
  const n = rows.length;
  const filtro = meta.filtersActive ? " · com filtros aplicados" : "";
  return `Período: ${meta.periodLabel}${filtro}  ·  ${int(n)} ${n === 1 ? "anúncio" : "anúncios"}  ·  Exportado em ${dateTimeBr(meta.exportedAt)}`;
}

export type AdsExportInput = {
  rows: AdsPerfRow[];
  metaAds: MetaAdsForTable | null;
  kpis: Kpis;
  meta: AdsExportMeta;
};

// ══════════════════════════════════════════════════════════════════════════
// XLSX
// ══════════════════════════════════════════════════════════════════════════
const HEADER_ROW = 4;

function argb(hex: string): string {
  return "FF" + hex.replace("#", "").toUpperCase();
}

export async function exportAdsToXlsx({ rows, metaAds, kpis, meta }: AdsExportInput): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const cols = activeColumns(!!metaAds, false);
  const ctx: Ctx = { meta: metaAds, currency: metaAds?.currency ?? "BRL" };

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aton Member Dashboard";
  wb.created = meta.exportedAt;

  const ws = wb.addWorksheet("Performance por Anúncio", {
    views: [{ state: "frozen", ySplit: HEADER_ROW, xSplit: 2 }],
  });
  ws.columns = cols.map((c) => ({ width: c.width }));
  const lastCol = ws.getColumn(cols.length).letter;

  ws.mergeCells(`A1:${lastCol}1`);
  const title = ws.getCell("A1");
  title.value = `Performance por Anúncio — ${meta.workspaceName}`;
  title.font = { name: "Calibri", bold: true, size: 15, color: { argb: argb(BRAND.blue) } };
  ws.getRow(1).height = 22;

  ws.mergeCells(`A2:${lastCol}2`);
  const sub = ws.getCell("A2");
  sub.value = subtitleLine(rows, meta);
  sub.font = { name: "Calibri", size: 10, color: { argb: argb(BRAND.muted) } };
  ws.getRow(2).height = 16;

  const header = ws.getRow(HEADER_ROW);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(BRAND.blue) } };
    cell.alignment = {
      vertical: "middle",
      horizontal: c.align === "right" ? "right" : c.align === "center" ? "center" : "left",
    };
    cell.border = {
      top: { style: "thin", color: { argb: argb(BRAND.blueDark) } },
      bottom: { style: "thin", color: { argb: argb(BRAND.blueDark) } },
      left: { style: "thin", color: { argb: argb(BRAND.blueDark) } },
      right: { style: "thin", color: { argb: argb(BRAND.blueDark) } },
    };
  });
  header.height = 20;

  const hair = {
    top: { style: "hair" as const, color: { argb: argb(BRAND.line) } },
    bottom: { style: "hair" as const, color: { argb: argb(BRAND.line) } },
    left: { style: "hair" as const, color: { argb: argb(BRAND.line) } },
    right: { style: "hair" as const, color: { argb: argb(BRAND.line) } },
  };

  rows.forEach((r, idx) => {
    const row = ws.getRow(HEADER_ROW + 1 + idx);
    const zebra = idx % 2 === 1;
    const ad = metaAds ? metaAds.ads[r.idAnuncio] : undefined;

    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const n = c.num?.(r, ad) ?? null;
      // Número real quando possível (permite somar/ordenar no Excel); texto
      // quando é "—" ou coluna textual.
      if (n !== null && Number.isFinite(n)) {
        cell.value = n;
        if (c.numFmt) cell.numFmt = c.numFmt;
      } else {
        cell.value = c.value(r, ad, ctx) || "";
      }
      const heatColor = c.heat?.(r);
      cell.font = {
        name: "Calibri",
        size: 10,
        bold: !!heatColor,
        color: { argb: argb(heatColor ?? BRAND.ink) },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: c.align === "right" ? "right" : c.align === "center" ? "center" : "left",
      };
      cell.border = hair;
      if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(BRAND.zebra) } };
      }
    });
  });

  // Aba de resumo — os mesmos números do strip da tela.
  if (metaAds) {
    const rs = wb.addWorksheet("Resumo");
    rs.columns = [{ width: 26 }, { width: 20 }, { width: 32 }];
    rs.mergeCells("A1:C1");
    const rt = rs.getCell("A1");
    rt.value = `Custo × desfecho — ${meta.workspaceName}`;
    rt.font = { name: "Calibri", bold: true, size: 14, color: { argb: argb(BRAND.blue) } };
    rs.getCell("A2").value = subtitleLine(rows, meta);
    rs.getCell("A2").font = { name: "Calibri", size: 10, color: { argb: argb(BRAND.muted) } };
    rs.mergeCells("A2:C2");
    summaryPairs(metaAds, kpis).forEach((p, i) => {
      const row = rs.getRow(4 + i);
      row.getCell(1).value = p.label;
      row.getCell(1).font = { name: "Calibri", bold: true, size: 10, color: { argb: argb(BRAND.ink) } };
      row.getCell(2).value = p.value;
      row.getCell(2).font = { name: "Calibri", bold: true, size: 12, color: { argb: argb(BRAND.blue) } };
      row.getCell(3).value = p.sub;
      row.getCell(3).font = { name: "Calibri", size: 9, color: { argb: argb(BRAND.muted) } };
    });
    if (meta.filtersActive) {
      const warn = rs.getRow(4 + 5 + 1);
      warn.getCell(1).value =
        "Atenção: filtros ativos. O investimento é da conta inteira no período — comparar com KPIs filtrados distorce os custos por lead.";
      warn.getCell(1).font = { name: "Calibri", size: 9, italic: true, color: { argb: argb(BRAND.orange) } };
      rs.mergeCells(`A${warn.number}:C${warn.number}`);
    }
  }

  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: cols.length } };

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    buildFilename(meta, "xlsx"),
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CSV
// ══════════════════════════════════════════════════════════════════════════
function csvField(raw: string, guard: boolean, sep: string): string {
  let s = raw ?? "";
  // Guard anti-injeção de fórmula (Excel/Sheets executam =,+,-,@ ao abrir).
  if (guard && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(sep) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function exportAdsToCsv({ rows, metaAds, meta }: AdsExportInput): void {
  const sep = ";"; // Excel pt-BR
  const cols = activeColumns(!!metaAds, false);
  const ctx: Ctx = { meta: metaAds, currency: metaAds?.currency ?? "BRL" };
  const lines: string[] = [cols.map((c) => csvField(c.header, false, sep)).join(sep)];
  for (const r of rows) {
    const ad = metaAds ? metaAds.ads[r.idAnuncio] : undefined;
    lines.push(cols.map((c) => csvField(c.value(r, ad, ctx), c.guardCsv ?? false, sep)).join(sep));
  }
  const bom = String.fromCharCode(0xfeff);
  triggerDownload(
    new Blob([bom + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    buildFilename(meta, "csv"),
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PDF — identidade visual do dash
// ══════════════════════════════════════════════════════════════════════════

// Wordmark "Aton" — MESMOS paths do components/brand/AtonLogo.tsx (Brand Book
// v2), desenhados como vetor no PDF. viewBox "50 420 980 270".
const LOGO_PATHS = [
  "M822.48,497.5v175.24h-37.01v-239.81c11,0,21.82-.07,32.62.11,1.04.02,2.25,1.46,3.06,2.49,25.73,32.5,51.41,65.04,77.13,97.55,24.12,30.48,48.29,60.92,72.44,91.37.72.9,1.54,1.72,3.24,3.61v-194.86h36.49v240c-11.78,0-23.53-.94-35.06.28-10.64,1.12-16.48-3.63-22.5-11.3-31.09-39.62-62.65-78.87-93.94-118.32-11.21-14.14-22.14-28.49-33.22-42.74-.68-.88-1.49-1.67-3.26-3.61Z",
  "M721.52,532.97c-6.83,7.13-13.59,14.35-20.54,21.37-3.76,3.8-7.75,7.4-11.82,10.87-7.25,6.17-17.91,5.84-23.65-.56-6.14-6.85-5.72-16.56,1.4-23.45,19.26-18.63,38.64-37.15,58.02-55.66,2.54-2.43,5.44-4.49,8.27-6.81,20.71,26.9,29.57,56.41,26.03,89.94-3.92,37.12-20.5,66.68-50.47,88.55-19.31,14.1-41.47,20.28-65.29,20.2-50.69-.17-88.49-22.71-109.92-68.44-22.48-47.96-14.09-108.74,27.8-147.84,25.25-23.58,55.77-34.07,90.39-32.41,19.48.94,38.01,5.13,54.79,15.54,1.18.73,2.32,1.52,3.41,2.38.43.33.65.93,1.52,2.27-7.14,6.95-14.26,14.09-21.71,20.86-1.05.95-4,.71-5.64,0-29.46-12.76-58.51-12.74-85.73,5.02-23.95,15.62-36.23,38.89-39.75,67.26-2.21,17.79-.16,34.7,6.64,51.16,14.74,35.66,50.14,56.22,88.43,51.36,31.61-4.02,60.51-31.21,68.66-64.62,3.71-15.22,3.48-30.5,1.06-45.81-.64-.39-1.28-.78-1.92-1.17Z",
  "M300.98,673.16c-13.08,0-25.12.07-37.16-.13-1.01-.02-2.42-1.72-2.93-2.94-7.72-18.65-15.45-37.30-22.84-56.09-1.32-3.35-2.76-4.63-6.34-4.62-32.56.08-65.12-.05-97.67.12-1.75,0-4.43,1.79-5.10,3.40-7.77,18.63-15.18,37.42-22.90,56.07-.72,1.74-2.95,4-4.54,4.05-11.68.34-23.38.19-35.96.19.79-2.22,1.29-3.80,1.91-5.33,31.32-76.60,62.68-153.18,93.94-229.80,1.54-3.78,3.43-5.54,7.86-5.37,9.91.39,19.85.30,29.77.04,3.41-.09,4.87,1.19,6.08,4.16,29.07,71.33,58.24,142.62,87.34,213.94,2.88,7.07,5.47,14.26,8.54,22.31ZM142.40,577.98h81.01c-13.59-33.48-26.94-66.34-40.63-100.08-13.64,33.81-26.92,66.74-40.37,100.08Z",
  "M375.50,464.94h-80.27v-31.66h198.45v31.50h-81.38v208.09h-36.80v-207.93Z",
];

const LOGO_VB = { x: 50, y: 420, w: 980, h: 270 };

/** As fontes padrão do jsPDF (WinAnsi) descartam travessão/en-dash — o "—"
 *  de célula vazia sumia e a célula ficava em branco. Normaliza pra ASCII. */
function pdfText(s: string): string {
  return (s ?? "").replace(/[—–]/g, "-").replace(/ /g, " ");
}

/** Desenha o wordmark vetorial: parser mínimo de path (M/L/H/V/C/Z, abs+rel)
 *  — cobre 100% do que o logo usa. Sem raster, escala limpa em qualquer DPI. */
function drawLogo(
  doc: import("jspdf").jsPDF,
  x: number,
  y: number,
  heightMm: number,
  hex: string,
): void {
  const scale = heightMm / LOGO_VB.h;
  doc.setFillColor(hex);
  const toX = (v: number) => x + (v - LOGO_VB.x) * scale;
  const toY = (v: number) => y + (v - LOGO_VB.y) * scale;

  for (const path of LOGO_PATHS) {
    const tokens = path.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
    let i = 0;
    let cx = 0;
    let cy = 0;
    let startX = 0;
    let startY = 0;
    let cmd = "";
    const lines: Array<[number, number]> = []; // deltas p/ doc.lines
    let originX = 0;
    let originY = 0;
    let open = false;

    const flush = () => {
      if (open && lines.length > 0) {
        doc.lines(lines as unknown as number[][], toX(originX), toY(originY), [scale, scale], "f", true);
      }
      lines.length = 0;
      open = false;
    };

    const num = () => Number(tokens[i++]);

    while (i < tokens.length) {
      const t = tokens[i];
      if (/[MLHVCSQTAZmlhvcsqtaz]/.test(t)) {
        cmd = t;
        i++;
      }
      switch (cmd) {
        case "M":
        case "m": {
          const nx = cmd === "M" ? num() : cx + num();
          const ny = cmd === "M" ? num() : cy + num();
          flush();
          cx = nx;
          cy = ny;
          startX = cx;
          startY = cy;
          originX = cx;
          originY = cy;
          open = true;
          cmd = cmd === "M" ? "L" : "l";
          break;
        }
        case "L":
        case "l": {
          const nx = cmd === "L" ? num() : cx + num();
          const ny = cmd === "L" ? num() : cy + num();
          lines.push([(nx - cx) * scale, (ny - cy) * scale]);
          cx = nx;
          cy = ny;
          break;
        }
        case "H":
        case "h": {
          const nx = cmd === "H" ? num() : cx + num();
          lines.push([(nx - cx) * scale, 0]);
          cx = nx;
          break;
        }
        case "V":
        case "v": {
          const ny = cmd === "V" ? num() : cy + num();
          lines.push([0, (ny - cy) * scale]);
          cy = ny;
          break;
        }
        case "C":
        case "c": {
          const rel = cmd === "c";
          const x1 = rel ? cx + num() : num();
          const y1 = rel ? cy + num() : num();
          const x2 = rel ? cx + num() : num();
          const y2 = rel ? cy + num() : num();
          const nx = rel ? cx + num() : num();
          const ny = rel ? cy + num() : num();
          lines.push([
            (x1 - cx) * scale,
            (y1 - cy) * scale,
            (x2 - cx) * scale,
            (y2 - cy) * scale,
            (nx - cx) * scale,
            (ny - cy) * scale,
          ] as unknown as [number, number]);
          cx = nx;
          cy = ny;
          break;
        }
        case "Z":
        case "z": {
          cx = startX;
          cy = startY;
          flush();
          i++;
          break;
        }
        default:
          i++;
      }
    }
    flush();
  }
}

export async function exportAdsToPdf({ rows, metaAds, kpis, meta }: AdsExportInput): Promise<void> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = (autoTableMod as unknown as { default: CallableFunction }).default;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 10; // margem

  // ── Cabeçalho: espelha o header do dash ──────────────────────────────────
  // Wordmark Aton em aton-blue + eyebrow "· MEMBER DASHBOARD" + título da
  // seção, exatamente na hierarquia da tela (Dashboard.tsx L159-163), fechado
  // por uma régua azul. Logo vetorial (mesmos paths do SVG oficial do Brand
  // Book / AtonLogo.tsx) — sem raster, nítida em qualquer zoom ou impressão.
  drawLogo(doc, M, 8, 5.6, BRAND.blue);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(BRAND.muted);
  doc.text("· MEMBER DASHBOARD", M + 27, 12.2, { charSpace: 0.5 });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(BRAND.ink);
  doc.text("Performance por Anúncio", M, 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.setTextColor(BRAND.muted);
  doc.text(`${meta.workspaceName}  ·  ${subtitleLine(rows, meta)}`, M, 27);

  doc.setDrawColor(BRAND.blue);
  doc.setLineWidth(0.6);
  doc.line(M, 30, pageW - M, 30);

  let cursorY = 34;

  // ── Cartões de resumo custo × desfecho (idem strip da tela) ──────────────
  // Omitido com filtros ativos, pelo mesmo motivo da tela: o investimento é
  // da conta INTEIRA no período, dividir por KPIs filtrados infla os custos.
  if (metaAds && !meta.filtersActive) {
    const pairs = summaryPairs(metaAds, kpis);
    const gap = 2.5;
    const cardW = (pageW - M * 2 - gap * (pairs.length - 1)) / pairs.length;
    const cardH = 17;
    pairs.forEach((p, i) => {
      const x = M + i * (cardW + gap);
      doc.setFillColor("#f6f8fc");
      doc.setDrawColor(BRAND.line);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, cursorY, cardW, cardH, 1.5, 1.5, "FD");
      // Barra de acento (aton-blue) na borda esquerda.
      doc.setFillColor(i === 0 ? BRAND.blue : "#c9d8ff");
      doc.rect(x, cursorY, 0.9, cardH, "f");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(i === 0 ? BRAND.blue : BRAND.ink);
      doc.text(pdfText(p.value), x + 3.2, cursorY + 6.4);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(BRAND.muted);
      doc.text(pdfText(p.label.toUpperCase()), x + 3.2, cursorY + 10.6);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.6);
      doc.setTextColor("#9aa3af");
      doc.text(doc.splitTextToSize(pdfText(p.sub), cardW - 5)[0] ?? "", x + 3.2, cursorY + 14);
    });
    cursorY += cardH + 4;
  } else if (metaAds && meta.filtersActive) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.2);
    doc.setTextColor(BRAND.orange);
    doc.text(
      "Filtros ativos: resumo de custo omitido — o investimento é da conta inteira no período.",
      M,
      cursorY + 2,
    );
    cursorY += 6;
  }

  // ── Tabela ───────────────────────────────────────────────────────────────
  const cols = activeColumns(!!metaAds, true);
  const ctx: Ctx = { meta: metaAds, currency: metaAds?.currency ?? "BRL" };
  const totalW = cols.reduce((s, c) => s + c.pdfWidth, 0);
  const avail = pageW - M * 2;

  const columnStyles: Record<number, Record<string, unknown>> = {};
  cols.forEach((c, i) => {
    columnStyles[i] = {
      cellWidth: (c.pdfWidth / totalW) * avail,
      halign: c.align === "right" ? "right" : c.align === "center" ? "center" : "left",
    };
  });

  autoTable(doc, {
    startY: cursorY,
    margin: { left: M, right: M, bottom: 14 },
    head: [cols.map((c) => pdfText(c.pdfHeader ?? c.header))],
    body: rows.map((r) => {
      const ad = metaAds ? metaAds.ads[r.idAnuncio] : undefined;
      return cols.map((c) => pdfText(c.value(r, ad, ctx)));
    }),
    styles: {
      font: "helvetica",
      fontSize: 6.6,
      cellPadding: { top: 1.5, right: 1.6, bottom: 1.5, left: 1.6 },
      textColor: BRAND.ink,
      lineColor: BRAND.line,
      lineWidth: 0.1,
      overflow: "ellipsize",
    },
    headStyles: {
      fillColor: BRAND.blue,
      textColor: "#ffffff",
      fontStyle: "bold",
      fontSize: 6.4,
      lineColor: BRAND.blueDark,
    },
    alternateRowStyles: { fillColor: "#f9fafb" },
    columnStyles,
    // Heat colors das taxas — mesma régua (quartis) das pills da tela.
    didParseCell: (data: {
      section: string;
      column: { index: number };
      row: { index: number };
      cell: { styles: Record<string, unknown> };
    }) => {
      if (data.section !== "body") return;
      const col = cols[data.column.index];
      const row = rows[data.row.index];
      if (!col || !row) return;
      if (col.heat) {
        data.cell.styles.textColor = col.heat(row);
        data.cell.styles.fontStyle = "bold";
      }
      if (col.header === "Anúncio" && row.isUnknownId) {
        data.cell.styles.textColor = BRAND.muted;
        data.cell.styles.fontStyle = "italic";
      }
    },
    didDrawPage: () => {
      // Rodapé: fonte do dado + paginação, em toda página.
      const page = doc.getNumberOfPages();
      const current = (doc as unknown as { internal: { getCurrentPageInfo: () => { pageNumber: number } } })
        .internal.getCurrentPageInfo().pageNumber;
      doc.setDrawColor(BRAND.line);
      doc.setLineWidth(0.2);
      doc.line(M, pageH - 10, pageW - M, pageH - 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(BRAND.muted);
      const nota = metaAds
        ? "Investimento, CPM, CTR de link e CPC via Meta Ads. Contagem de leads: base Aton (fonte da verdade) — CPL, R$/MQL e R$/Conv. = investimento ÷ leads reais."
        : "Dados de leads da base Aton.";
      doc.text(pdfText(nota), M, pageH - 6.6);
      doc.text(`Aton Member Dashboard  ·  ${current}/${page}`, pageW - M, pageH - 6.6, {
        align: "right",
      });
    },
  });

  doc.save(buildFilename(meta, "pdf"));
}
