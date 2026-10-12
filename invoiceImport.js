export function parseInvoicePaste(text, parts) {
  const source = text.trim();
  if (!source) return { items: [], errors: [], rows: 0 };
  const firstLine = source.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
  const rows = [];
  for (const line of source.split(/\r?\n/)) {
    const cells = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && line[index + 1] === '"' && quoted) { value += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (character === delimiter && !quoted) { cells.push(value.trim()); value = ""; }
      else value += character;
    }
    cells.push(value.trim());
    if (cells.some(Boolean)) rows.push(cells);
  }
  if (!rows.length) return { items: [], errors: ["Yapıştırılan metinde okunabilir satır bulunamadı."], rows: 0 };
  const normalize = (value) => value.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const headings = rows[0].map(normalize);
  const findColumn = (names) => headings.findIndex((heading) => names.some((name) => name.some((part) => heading.includes(part))));
  const headerSku = findColumn([["sku"], ["parcakodu"], ["stokno"], ["urunno"], ["kod"]]);
  const headerQty = findColumn([["adet"], ["miktar"], ["quantity"], ["qty"]]);
  const headerCost = findColumn([["alisfiyati"], ["birimfiyat"], ["birimalis"], ["unitcost"], ["fiyat"]]);
  const headerName = findColumn([["parcaadi"], ["urunadi"], ["urun"], ["name"]]);
  const hasHeader = headerSku >= 0 && headerQty >= 0 && headerCost >= 0;
  const indexes = hasHeader ? { sku: headerSku, name: headerName, qty: headerQty, cost: headerCost } : { sku: 0, name: rows[0].length >= 4 ? 1 : -1, qty: rows[0].length >= 4 ? 2 : 1, cost: rows[0].length >= 4 ? 3 : 2 };
  const errors = [];
  const aggregated = new Map();
  rows.slice(hasHeader ? 1 : 0).forEach((cells, index) => {
    const sku = cells[indexes.sku]?.trim();
    const name = indexes.name >= 0 ? cells[indexes.name]?.trim() : "";
    const qty = Number(cells[indexes.qty]?.trim());
    const costText = cells[indexes.cost]?.trim().replace(/\s/g, "");
    const cost = Number(costText?.includes(",") ? costText.replace(/\./g, "").replace(",", ".") : costText);
    const match = parts.filter((part) => (sku && part.sku.toLocaleLowerCase("tr") === sku.toLocaleLowerCase("tr")) || (name && part.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr")));
    const lineNumber = index + (hasHeader ? 2 : 1);
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) { errors.push(`${lineNumber}. satır: adet veya alış fiyatı geçersiz.`); return; }
    if (match.length !== 1) { errors.push(`${lineNumber}. satır: ${sku || name || "Parça"} envanterde ${match.length ? "birden fazla eşleşiyor" : "bulunamadı"}.`); return; }
    const part = match[0];
    const previous = aggregated.get(part.id);
    if (previous) {
      const totalQty = previous.qty + qty;
      previous.cost = (previous.cost * previous.qty + cost * qty) / totalQty;
      previous.qty = totalQty;
    } else aggregated.set(part.id, { partId: part.id, name: part.name, sku: part.sku, qty, cost });
  });
  return { items: [...aggregated.values()], errors, rows: rows.length - (hasHeader ? 1 : 0) };
}
