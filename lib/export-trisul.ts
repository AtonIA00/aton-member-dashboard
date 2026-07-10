// Export da tabela detalhada da Trisul (XLSX formatado + CSV). Mesmo padrão de
// lib/export-leads.ts: exceljs via dynamic import (chunk separado), CSV com BOM
// e guard anti-injeção. Roda 100% no client (dados já vêm como props).

import type { TrisulAtendimento } from "@/lib/trisul";

export type TrisulExportMeta = {
  periodLabel: string;
  filtersActive: boolean;
  exportedAt: Date;
};

function fmtDateTimeBr(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function resultadoLabel(r: string | null): string {
  switch ((r ?? "").trim()) {
    case "confirmado_atualizado": return "Confirmado/Ativo";
    case "nao_atua_mercado": return "Não atua no mercado";
    case "nao_atua_parcerias": return "Não atua com parcerias";
    case "negativa_explicita": return "Negativa explícita";
    case "sem_interacao": return "Sem interação";
    default: return r ? r : "Em andamento";
  }
}
function boolLabel(b: boolean | null): string {
  if (b === true) return "Sim";
  if (b === false) return "Não";
  return "";
}

type Col = { header: string; width: number; get: (a: TrisulAtendimento) => string; guard?: boolean };

const COLUMNS: Col[] = [
  { header: "Disparo", width: 18, get: (a) => fmtDateTimeBr(a.disparo_at) },
  { header: "Nome", width: 24, get: (a) => a.nome ?? "", guard: true },
  { header: "Telefone", width: 18, get: (a) => a.telefone ?? "" },
  { header: "Coordenador", width: 22, get: (a) => a.coordenador_nome ?? "", guard: true },
  { header: "Campanha", width: 18, get: (a) => a.campanha ?? "", guard: true },
  { header: "Status envio", width: 14, get: (a) => a.status_envio ?? "" },
  { header: "Respondeu", width: 12, get: (a) => boolLabel(a.respondeu) },
  { header: "Follow-ups", width: 12, get: (a) => (a.tentativas_fup ?? 0).toString() },
  { header: "Resultado", width: 22, get: (a) => resultadoLabel(a.resultado) },
  { header: "Convertido", width: 12, get: (a) => boolLabel(a.convertido) },
  { header: "Canal coordenador", width: 18, get: (a) => a.canal_contato_coordenador ?? "" },
  { header: "Resumo da conversa", width: 60, get: (a) => a.resumo_conversa ?? "", guard: true },
];

function fileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportTrisulXlsx(rows: TrisulAtendimento[], meta: TrisulExportMeta): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Aton Member Dashboard";
  wb.created = meta.exportedAt;
  const ws = wb.addWorksheet("Trisul", { views: [{ state: "frozen", ySplit: 4 }] });
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));
  const last = ws.getColumn(COLUMNS.length).letter;

  ws.mergeCells(`A1:${last}1`);
  const title = ws.getCell("A1");
  title.value = "Trisul Parcerias — Atendimentos";
  title.font = { name: "Calibri", bold: true, size: 15, color: { argb: "FF0057FF" } };
  ws.getRow(1).height = 22;

  ws.mergeCells(`A2:${last}2`);
  ws.getCell("A2").value = `Período: ${meta.periodLabel}${meta.filtersActive ? " · com filtros" : ""}  ·  ${rows.length.toLocaleString("pt-BR")} atendimentos  ·  Exportado em ${fmtDateTimeBr(meta.exportedAt.toISOString())}`;
  ws.getCell("A2").font = { name: "Calibri", size: 10, color: { argb: "FF6B7280" } };

  const header = ws.getRow(4);
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0057FF" } };
    cell.alignment = { vertical: "middle" };
  });
  header.height = 20;

  rows.forEach((a, idx) => {
    const row = ws.getRow(5 + idx);
    const zebra = idx % 2 === 1;
    COLUMNS.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = c.get(a) || "";
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF111827" } };
      cell.alignment = { vertical: "top", wrapText: c.header === "Resumo da conversa" };
      if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
    });
  });

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: COLUMNS.length } };
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `trisul-atendimentos-${fileStamp(meta.exportedAt)}.xlsx`);
}

function csvField(raw: string, guard: boolean, sep: string): string {
  let s = raw ?? "";
  if (guard && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(sep) || s.includes('"') || s.includes("\n") || s.includes("\r")) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function exportTrisulCsv(rows: TrisulAtendimento[], meta: TrisulExportMeta): void {
  const sep = ";";
  const lines: string[] = [];
  lines.push(COLUMNS.map((c) => csvField(c.header, false, sep)).join(sep));
  for (const a of rows) lines.push(COLUMNS.map((c) => csvField(c.get(a), c.guard ?? false, sep)).join(sep));
  const bom = String.fromCharCode(0xfeff);
  download(new Blob([bom + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `trisul-atendimentos-${fileStamp(meta.exportedAt)}.csv`);
}
