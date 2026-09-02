export type ExportRow = (string | number)[];

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(cell: string | number) {
  const str = String(cell);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportCSV(filename: string, headers: string[], rows: ExportRow[]) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  const csv = "﻿" + lines.join("\r\n"); // BOM for correct Arabic rendering in Excel
  downloadBlob(`${filename}.csv`, csv, "text/csv;charset=utf-8;");
}

export function exportExcel(filename: string, headers: string[], rows: ExportRow[]) {
  const table = `
    <table dir="rtl">
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>`;
  const html = `<html><head><meta charset="utf-8"></head><body>${table}</body></html>`;
  downloadBlob(`${filename}.xls`, html, "application/vnd.ms-excel;charset=utf-8;");
}
