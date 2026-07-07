// Exportação da tabela "Leads detalhados" em XLSX (formatado, bom pra
// visualização) e CSV (raw, pra reimportar em outras ferramentas).
//
// Roda 100% no client — os leads já estão no browser (props do LeadsTable),
// então não há round-trip nem novo endpoint. O exceljs é pesado (~1MB), por
// isso é carregado via dynamic import SÓ quando o usuário clica em exportar
// (fica num chunk separado, fora do bundle inicial).
//
// Fonte única de colunas (COLUMNS) alimenta os dois formatos — assim XLSX e
// CSV nunca divergem.

import type { LeadRow } from "@/lib/leads";
import { classify, GRUPO_LABEL, type Grupo } from "@/lib/classify";

export type ExportMeta = {
  workspaceName: string;
  /** Ex: "Últimos 7 dias", "Hoje", "01/06/2026 a 15/06/2026", "Todo o período". */
  periodLabel: string;
  /** Se filtros (campanha/canal/etapa/MQL) estão aplicados — vira nota no arquivo. */
  filtersActive: boolean;
  exportedAt: Date;
};

// ──────────────────────────────────────────────────────────────────────────
// Formatters (compartilhados XLSX + CSV)

function fmtDateBr(iso: string | null): string {
  if (!iso) return "";
  // `data` vem meia-noite UTC — pega só a porção de data e formata dd/mm/aaaa.
  const day = iso.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Date à meia-noite LOCAL a partir do YYYY-MM-DD (pra célula de data real
 *  no Excel — evita shift de timezone que jogaria pro dia anterior). */
function toLocalDate(iso: string | null): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fmtTelefone(ddd: string | null, tel: string | null): string {
  const t = (tel ?? "").trim();
  if (!t) return "";
  const d = (ddd ?? "").trim();
  if (d && !t.startsWith(d) && !t.startsWith(`+${d}`)) {
    return `(${d}) ${t}`;
  }
  return t;
}

function fmtMqlLabel(mql: string | null): "Sim" | "Não" | "" {
  const v = (mql ?? "").toLowerCase().trim();
  if (v === "sim") return "Sim";
  if (v === "não" || v === "nao") return "Não";
  return "";
}

function fmtDateTimeBr(d: Date): string {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Definição de colunas — fonte única de verdade.

type ColKind = "date" | "mql" | "etapa" | "text";

type LeadColumn = {
  header: string;
  width: number;
  kind: ColKind;
  /** Valor textual (usado no CSV e como fallback do XLSX). */
  value: (l: LeadRow) => string;
  /** Se true, aplica guard anti-injeção de fórmula no CSV. */
  guardCsv?: boolean;
  /** Alinhamento no XLSX. */
  align?: "left" | "center";
};

const COLUMNS: LeadColumn[] = [
  { header: "Data", width: 12, kind: "date", value: (l) => fmtDateBr(l.data), align: "center" },
  { header: "Nome", width: 24, kind: "text", value: (l) => l.nome_lead ?? "", guardCsv: true },
  { header: "Telefone", width: 18, kind: "text", value: (l) => fmtTelefone(l.ddd_lead, l.telefone) },
  { header: "Campanha", width: 30, kind: "text", value: (l) => l.nome_campanha ?? "", guardCsv: true },
  { header: "Etapa", width: 15, kind: "etapa", value: (l) => GRUPO_LABEL[classify(l.etapa_funil)], align: "center" },
  { header: "Etapa (detalhe)", width: 18, kind: "text", value: (l) => l.etapa_funil ?? "", guardCsv: true },
  { header: "MQL", width: 9, kind: "mql", value: (l) => fmtMqlLabel(l.mql), align: "center" },
  { header: "Canal", width: 14, kind: "text", value: (l) => l.canal_campanha ?? "" },
  { header: "Cidade", width: 16, kind: "text", value: (l) => l.cidade_campanha ?? "", guardCsv: true },
  { header: "Estado", width: 9, kind: "text", value: (l) => l.estado_campanha ?? "", align: "center" },
  { header: "ID Anúncio", width: 20, kind: "text", value: (l) => l.id_anuncio ?? "", guardCsv: true },
  { header: "Resumo da conversa", width: 60, kind: "text", value: (l) => l.resumo_conversa ?? "", guardCsv: true },
];

// Estilo XLSX por etapa (fill claro + texto forte). ARGB = alpha(FF) + RGB.
const ETAPA_XLSX: Record<Grupo, { fill: string; font: string }> = {
  Novo: { fill: "FFE7EFFF", font: "FF0047CC" },
  "Em conversa": { fill: "FFE0F7FF", font: "FF0086B3" },
  "Agendado+": { fill: "FFDCFCE7", font: "FF047857" }, // exibido "Convertido"
  Descartado: { fill: "FFFEE2E2", font: "FFB91C1C" },
  Outros: { fill: "FFF3F4F6", font: "FF4B5563" },
};

const MQL_XLSX = {
  Sim: { fill: "FFDCFCE7", font: "FF047857" },
  "Não": { fill: "FFFEE2E2", font: "FFB91C1C" },
} as const;

// ──────────────────────────────────────────────────────────────────────────
// Helpers de arquivo

function slugify(s: string): string {
  return (s || "workspace")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // remove diacríticos combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";
}

function fileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function buildFilename(meta: ExportMeta, ext: string): string {
  return `leads-${slugify(meta.workspaceName)}-${fileStamp(meta.exportedAt)}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga no próximo tick — dá tempo do download iniciar.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ──────────────────────────────────────────────────────────────────────────
// XLSX (exceljs, dynamic import)

const HEADER_ROW = 4; // linhas 1-2 título/subtítulo, 3 vazia, 4 cabeçalho

export async function exportLeadsToXlsx(leads: LeadRow[], meta: ExportMeta): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Aton Member Dashboard";
  wb.created = meta.exportedAt;

  const ws = wb.addWorksheet("Leads", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
  });

  ws.columns = COLUMNS.map((c) => ({ width: c.width }));
  const lastColLetter = ws.getColumn(COLUMNS.length).letter;

  // Título (linha 1)
  ws.mergeCells(`A1:${lastColLetter}1`);
  const title = ws.getCell("A1");
  title.value = `Leads — ${meta.workspaceName}`;
  title.font = { name: "Calibri", bold: true, size: 15, color: { argb: "FF0057FF" } };
  title.alignment = { vertical: "middle" };
  ws.getRow(1).height = 22;

  // Subtítulo (linha 2)
  ws.mergeCells(`A2:${lastColLetter}2`);
  const sub = ws.getCell("A2");
  const filtroNota = meta.filtersActive ? " · com filtros aplicados" : "";
  sub.value = `Período: ${meta.periodLabel}${filtroNota}  ·  ${leads.length.toLocaleString("pt-BR")} ${leads.length === 1 ? "lead" : "leads"}  ·  Exportado em ${fmtDateTimeBr(meta.exportedAt)}`;
  sub.font = { name: "Calibri", size: 10, color: { argb: "FF6B7280" } };
  ws.getRow(2).height = 16;

  // Cabeçalho (linha 4)
  const header = ws.getRow(HEADER_ROW);
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0057FF" } };
    cell.alignment = { vertical: "middle", horizontal: c.align === "center" ? "center" : "left" };
    cell.border = {
      top: { style: "thin", color: { argb: "FF0047CC" } },
      bottom: { style: "thin", color: { argb: "FF0047CC" } },
      left: { style: "thin", color: { argb: "FF0047CC" } },
      right: { style: "thin", color: { argb: "FF0047CC" } },
    };
  });
  header.height = 20;

  // Linhas de dados
  const cellBorder = {
    top: { style: "hair" as const, color: { argb: "FFE5E7EB" } },
    bottom: { style: "hair" as const, color: { argb: "FFE5E7EB" } },
    left: { style: "hair" as const, color: { argb: "FFE5E7EB" } },
    right: { style: "hair" as const, color: { argb: "FFE5E7EB" } },
  };

  leads.forEach((l, idx) => {
    const row = ws.getRow(HEADER_ROW + 1 + idx);
    const zebra = idx % 2 === 1;
    const grupo = classify(l.etapa_funil);

    COLUMNS.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);

      if (c.kind === "date") {
        const d = toLocalDate(l.data);
        if (d) {
          cell.value = d;
          cell.numFmt = "dd/mm/yyyy";
        } else {
          cell.value = "";
        }
      } else {
        cell.value = c.value(l) || "";
      }

      cell.font = { name: "Calibri", size: 10, color: { argb: "FF111827" } };
      cell.alignment = {
        vertical: "top",
        horizontal: c.align === "center" ? "center" : "left",
        wrapText: c.header === "Resumo da conversa",
      };
      cell.border = cellBorder;

      // Fills especiais sobrepõem o zebra.
      if (c.kind === "etapa") {
        const st = ETAPA_XLSX[grupo];
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: st.fill } };
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: st.font } };
      } else if (c.kind === "mql") {
        const label = fmtMqlLabel(l.mql);
        if (label === "Sim" || label === "Não") {
          const st = MQL_XLSX[label];
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: st.fill } };
          cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: st.font } };
        } else if (zebra) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
        }
      } else if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
      }
    });
  });

  // Auto-filtro no cabeçalho.
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: COLUMNS.length },
  };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, buildFilename(meta, "xlsx"));
}

// ──────────────────────────────────────────────────────────────────────────
// CSV (sem deps)

function csvField(raw: string, guard: boolean, sep: string): string {
  let s = raw ?? "";
  // Guard anti-injeção de fórmula (Excel/Sheets executam =,+,-,@ ao abrir CSV).
  if (guard && /^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (s.includes(sep) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function exportLeadsToCsv(leads: LeadRow[], meta: ExportMeta): void {
  const sep = ";"; // pt-BR Excel usa ; como separador de lista por padrão
  const lines: string[] = [];
  lines.push(COLUMNS.map((c) => csvField(c.header, false, sep)).join(sep));
  for (const l of leads) {
    lines.push(
      COLUMNS.map((c) => csvField(c.value(l), c.guardCsv ?? false, sep)).join(sep),
    );
  }
  // BOM pra Excel abrir UTF-8 (acentos) corretamente; CRLF por convenção CSV.
  const bom = String.fromCharCode(0xfeff);
  const content = bom + lines.join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, buildFilename(meta, "csv"));
}
