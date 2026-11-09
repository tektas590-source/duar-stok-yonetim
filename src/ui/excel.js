import * as XLSX from "xlsx";

export async function readSheetRows(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
}

export function downloadRows(fileName, sheetName, rows, widths = []) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  if (widths.length) sheet["!cols"] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, fileName);
}
