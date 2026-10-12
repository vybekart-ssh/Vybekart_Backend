import * as ExcelJS from 'exceljs';
import { formatIstDay, istYmd, toIstWallClock } from './insights-range.util';

/** Shared styling for the seller payout and admin Excel reports (Vybekart brand palette). */
export const C = {
  navy: 'FF0B1E5B',
  royal: 'FF003BFF',
  primary: 'FF1E88E5',
  primarySoft: 'FFE3F2FD',
  surfaceAlt: 'FFF7FAFD',
  section: 'FFF0F4F8',
  border: 'FFE2E8F0',
  text: 'FF1A1D24',
  muted: 'FF64748B',
  white: 'FFFFFFFF',
  green: 'FF047857',
  greenSoft: 'FFE8F8F1',
  red: 'FFC62828',
  redSoft: 'FFFDECEC',
  amber: 'FFB45309',
  amberSoft: 'FFFFF4E0',
  cyanSoft: 'FFE0F7FF',
  blueSoft: 'FFE8EEFF',
  purple: 'FF6D28D9',
};

export const INR = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
const DATE_FMT = 'dd-mmm-yyyy';
const TIME_FMT = 'hh:mm AM/PM';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Unpaid',
  PAID: 'Paid',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  NEEDS_CHANGES: 'Needs changes',
};

const STATUS_FILL: Record<string, string> = {
  PAID: C.cyanSoft,
  PACKED: C.amberSoft,
  SHIPPED: C.blueSoft,
  DELIVERED: C.greenSoft,
  CANCELLED: C.redSoft,
  RETURNED: C.redSoft,
  VERIFIED: C.greenSoft,
  REJECTED: C.redSoft,
  NEEDS_CHANGES: C.amberSoft,
  UNPAID: C.section,
  'NEEDS CHANGES': C.amberSoft,
};

export const PERIOD_LABEL: Record<string, string> = {
  daily: 'Daily (today)',
  weekly: 'Weekly (last 7 days)',
  monthly: 'Monthly (this month)',
  custom: 'Custom range',
};

export type ColumnKind = 'text' | 'int' | 'inr' | 'date' | 'time' | 'pct';

export interface ColumnSpec {
  header: string;
  width: number;
  kind: ColumnKind;
  total?: boolean;
  emphasis?: 'payout' | 'deduction' | 'earning';
}

export type CellValue = string | number | Date;

export const thinBorder = (argb = C.border): Partial<ExcelJS.Borders> => ({
  top: { style: 'thin', color: { argb } },
  left: { style: 'thin', color: { argb } },
  bottom: { style: 'thin', color: { argb } },
  right: { style: 'thin', color: { argb } },
});

export const solid = (argb: string): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb },
});

const emphasisHeader = (e?: ColumnSpec['emphasis']) =>
  e === 'payout' ? C.green : e === 'deduction' ? 'FF8E1B1B' : e === 'earning' ? C.purple : C.navy;
const emphasisText = (e?: ColumnSpec['emphasis']) =>
  e === 'payout' ? C.green : e === 'deduction' ? C.red : e === 'earning' ? C.purple : C.text;

export function applyKind(cell: ExcelJS.Cell, kind: ColumnKind) {
  switch (kind) {
    case 'inr':
      cell.numFmt = INR;
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      break;
    case 'int':
      cell.numFmt = '#,##0';
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      break;
    case 'pct':
      cell.numFmt = '0.##"%"';
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      break;
    case 'date':
      cell.numFmt = DATE_FMT;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      break;
    case 'time':
      cell.numFmt = TIME_FMT;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      break;
    default:
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
  }
}

export function banner(
  ws: ExcelJS.Worksheet,
  row: number,
  lastCol: number,
  text: string,
  fill: string,
  size: number,
  height: number,
) {
  ws.mergeCells(row, 1, row, lastCol);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { bold: true, size, color: { argb: C.white } };
  cell.fill = solid(fill);
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(row).height = height;
}

export function sectionHeader(ws: ExcelJS.Worksheet, row: number, title: string, lastCol = 3): number {
  ws.mergeCells(row, 1, row, lastCol);
  const cell = ws.getCell(row, 1);
  cell.value = title.toUpperCase();
  cell.font = { bold: true, size: 11, color: { argb: C.navy } };
  cell.fill = solid(C.section);
  cell.alignment = { vertical: 'middle', indent: 1 };
  cell.border = { bottom: { style: 'medium', color: { argb: C.primary } } };
  ws.getRow(row).height = 24;
  return row + 1;
}

export function tableHeader(ws: ExcelJS.Worksheet, row: number, headers: string[]): number {
  headers.forEach((h, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10, color: { argb: C.white } };
    cell.fill = solid(C.primary);
    cell.alignment = { vertical: 'middle', horizontal: i === 1 ? 'right' : 'left', indent: i === 1 ? 0 : 1 };
    cell.border = thinBorder(C.primary);
  });
  ws.getRow(row).height = 22;
  return row + 1;
}

export function keyValues(ws: ExcelJS.Worksheet, row: number, pairs: Array<[string, string]>): number {
  for (const [k, v] of pairs) {
    const key = ws.getCell(row, 1);
    key.value = k;
    key.font = { size: 10, color: { argb: C.muted } };
    key.alignment = { vertical: 'middle', indent: 1 };
    ws.mergeCells(row, 2, row, 3);
    const val = ws.getCell(row, 2);
    val.value = v;
    val.font = { size: 10, bold: true, color: { argb: C.text } };
    val.alignment = { vertical: 'middle', wrapText: true };
    [1, 2].forEach((c) => (ws.getCell(row, c).border = { bottom: { style: 'hair', color: { argb: C.border } } }));
    ws.getRow(row).height = v.length > 70 ? 30 : 18;
    row++;
  }
  return row;
}

export function figureRow(
  ws: ExcelJS.Worksheet,
  row: number,
  label: string,
  value: number | string,
  kind: ColumnKind,
  note?: string,
  emphasis?: 'payout' | 'deduction' | 'earning',
  bold = false,
) {
  const l = ws.getCell(row, 1);
  const v = ws.getCell(row, 2);
  const n = ws.getCell(row, 3);
  l.value = label;
  v.value = value;
  n.value = note ?? '';
  applyKind(v, kind);
  const highlight = emphasis === 'payout' || emphasis === 'earning';
  const accent = emphasis === 'earning' ? C.purple : C.green;
  l.font = { size: 10, bold: bold || highlight, color: { argb: highlight ? accent : C.text } };
  v.font = {
    size: highlight ? 12 : 10,
    bold: true,
    color: {
      argb: highlight
        ? accent
        : emphasis === 'deduction' || (typeof value === 'number' && value < 0)
          ? C.red
          : C.text,
    },
  };
  n.font = { size: 9, color: { argb: C.muted } };
  l.alignment = { vertical: 'middle', indent: 1, wrapText: true };
  n.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
  [l, v, n].forEach((c) => {
    c.border = thinBorder();
    if (emphasis === 'payout') c.fill = solid(C.greenSoft);
    else if (emphasis === 'earning') c.fill = solid('FFF3EEFF');
    else if (bold) c.fill = solid(C.primarySoft);
  });
  ws.getRow(row).height = highlight ? 26 : 20;
}

export function notesBlock(ws: ExcelJS.Worksheet, row: number, notes: string[], lastCol = 3): number {
  for (const note of notes) {
    ws.mergeCells(row, 1, row, lastCol);
    const cell = ws.getCell(row, 1);
    cell.value = `•  ${note}`;
    cell.font = { size: 10, color: { argb: C.muted } };
    cell.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(row).height = 30;
    row++;
  }
  return row;
}

/** Summary-style sheet: 3 columns (label, value, note) with two banner rows. */
export function summarySheet(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  subtitle: string,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, {
    properties: { tabColor: { argb: C.navy } },
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 46 }, { width: 22 }, { width: 62 }];
  banner(ws, 1, 3, title, C.navy, 18, 38);
  banner(ws, 2, 3, subtitle, C.primary, 10, 22);
  return ws;
}

/** Table sheet with frozen header, zebra rows, status pills, SUBTOTAL totals row and auto-filter. */
export function dataSheet(
  wb: ExcelJS.Workbook,
  name: string,
  tab: string,
  title: string,
  subtitle: string,
  columns: ColumnSpec[],
  values: CellValue[][],
  opts: { freezeColumns: number; emptyMessage: string; statusColumns?: number[] },
): ExcelJS.Worksheet {
  const headerRow = 4;
  const ws = wb.addWorksheet(name, {
    properties: { tabColor: { argb: tab } },
    views: [{ state: 'frozen', xSplit: opts.freezeColumns, ySplit: headerRow, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = columns.map((c) => ({ width: c.width }));
  const last = columns.length;

  banner(ws, 1, last, title, C.navy, 14, 30);
  banner(ws, 2, last, subtitle, C.primary, 10, 20);

  const hdr = ws.getRow(headerRow);
  columns.forEach((c, i) => {
    const cell = hdr.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 10, color: { argb: C.white } };
    cell.fill = solid(emphasisHeader(c.emphasis));
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder(C.navy);
  });
  hdr.height = 34;

  if (values.length === 0) {
    const r = headerRow + 1;
    ws.mergeCells(r, 1, r, last);
    const cell = ws.getCell(r, 1);
    cell.value = opts.emptyMessage;
    cell.font = { italic: true, color: { argb: C.muted } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(r).height = 28;
    return ws;
  }

  values.forEach((rowValues, idx) => {
    const r = ws.getRow(headerRow + 1 + idx);
    const zebra = idx % 2 === 1;
    rowValues.forEach((v, ci) => {
      const spec = columns[ci];
      const cell = r.getCell(ci + 1);
      cell.value = v === '' ? null : v;
      applyKind(cell, spec.kind);
      cell.border = thinBorder();
      cell.font = { size: 10, color: { argb: emphasisText(spec.emphasis) }, bold: spec.emphasis === 'payout' };
      if (zebra) cell.fill = solid(C.surfaceAlt);
    });
    for (const col of opts.statusColumns ?? []) {
      const status = String(rowValues[col - 1] ?? '').toUpperCase();
      const fill = STATUS_FILL[status];
      const cell = r.getCell(col);
      if (fill) cell.fill = solid(fill);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = { size: 10, bold: true, color: { argb: C.navy } };
    }
    r.height = 20;
  });

  const firstData = headerRow + 1;
  const lastData = headerRow + values.length;
  const totalRow = ws.getRow(lastData + 1);
  columns.forEach((c, i) => {
    const cell = totalRow.getCell(i + 1);
    const letter = ws.getColumn(i + 1).letter;
    if (i === 0) {
      cell.value = 'Total';
    } else if (c.total) {
      const result = values.reduce((s, row) => s + (typeof row[i] === 'number' ? (row[i] as number) : 0), 0);
      cell.value = {
        formula: `SUBTOTAL(109,${letter}${firstData}:${letter}${lastData})`,
        result: Math.round(result * 100) / 100,
      };
      applyKind(cell, c.kind);
    }
    cell.font = {
      bold: true,
      size: 10,
      color: { argb: c.emphasis ? emphasisText(c.emphasis) : C.navy },
    };
    cell.fill = solid(c.emphasis === 'payout' ? C.greenSoft : C.primarySoft);
    cell.border = {
      top: { style: 'medium', color: { argb: C.navy } },
      bottom: { style: 'medium', color: { argb: C.navy } },
      left: { style: 'thin', color: { argb: C.border } },
      right: { style: 'thin', color: { argb: C.border } },
    };
  });
  totalRow.height = 24;

  ws.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: lastData, column: last },
  };
  return ws;
}

export function formatIstDateTime(date: Date): string {
  const w = toIstWallClock(date);
  const h = w.getUTCHours();
  const min = String(w.getUTCMinutes()).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${formatIstDay(istYmd(date))}, ${h12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Excel serial-friendly IST calendar date (midnight UTC of the IST day). */
export function istDateCell(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function safeFilePart(name: string, fallback: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || fallback
  );
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
