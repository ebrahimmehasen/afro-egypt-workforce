export type ExportRow = (string | number)[];

function downloadBlob(filename: string, content: BlobPart, mime: string) {
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

export async function exportExcel(filename: string, headers: string[], rows: ExportRow[]) {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = headers.map((h, i) => ({
    wch: Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)) + 2,
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  const buffer: ArrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadBlob(
    `${filename}.xlsx`,
    buffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
