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
  const normalize = (value) => value.toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const headings = rows[0].map(normalize);
  const findColumn = (names) => headings.findIndex((heading) => names.some((name) => name.some((part) => heading.includes(part))));
  const headerSku = findColumn([["sku"], ["parcakodu"], ["stokno"], ["urunno"], ["kod"], ["stokkodu"]]);
  const headerQty = findColumn([["adet"], ["miktar"], ["quantity"], ["qty"], ["adedi"]]);
  const headerCost = findColumn([["alisfiyati"], ["birimalis"], ["unitcost"], ["birimfiyat"], ["fiyat"], ["kdvharic"]]);
  const headerName = findColumn([["parcaadi"], ["urunadi"], ["urun"], ["name"], ["aciklama"]]);
  const headerPrice = findColumn([["satisfiyat"], ["perakende"], ["sellingprice"], ["saleprice"], ["satis"], ["birimsatis"]]);
  const headerCategory = findColumn([["kategori"], ["category"], ["grup"]]);
  const headerBrand = findColumn([["marka"], ["brand"], ["uretici"]]);
  const resolvedCost = headerCost >= 0 ? headerCost : findColumn([["fiyat"]]);
  const hasHeader = headerSku >= 0 && headerQty >= 0 && resolvedCost >= 0;
  const indexes = hasHeader
    ? { sku: headerSku, name: headerName, qty: headerQty, cost: resolvedCost, price: headerPrice, category: headerCategory, brand: headerBrand }
    : { sku: 0, name: rows[0].length >= 4 ? 1 : -1, qty: rows[0].length >= 4 ? 2 : 1, cost: rows[0].length >= 4 ? 3 : 2, price: rows[0].length >= 5 ? 4 : -1, category: -1, brand: -1 };
  const parseAmount = (value) => {
    const amount = value?.trim().replace(/\s/g, "");
    return Number(amount?.includes(",") ? amount.replace(/\./g, "").replace(",", ".") : amount);
  };
  const errors = [];
  const aggregated = new Map();
  rows.slice(hasHeader ? 1 : 0).forEach((cells, index) => {
    const sku = cells[indexes.sku]?.trim();
    const name = indexes.name >= 0 ? cells[indexes.name]?.trim() : "";
    const qty = Number(cells[indexes.qty]?.trim());
    const cost = parseAmount(cells[indexes.cost]);
    const priceText = indexes.price >= 0 ? cells[indexes.price]?.trim() : "";
    const price = priceText ? parseAmount(priceText) : undefined;
    const match = parts.filter((part) => sku
      ? part.sku.toLocaleLowerCase("tr") === sku.toLocaleLowerCase("tr")
      : name && part.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"));
    const lineNumber = index + (hasHeader ? 2 : 1);
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) { errors.push(`${lineNumber}. satır: adet veya alış fiyatı geçersiz.`); return; }
    if (priceText && (!Number.isFinite(price) || price < 0)) { errors.push(`${lineNumber}. satır: satış fiyatı geçersiz.`); return; }
    if (match.length > 1) { errors.push(`${lineNumber}. satır: ${sku || name || "Parça"} envanterde birden fazla eşleşiyor.`); return; }
    const part = match[0];
    if (!part && (!sku || !name)) { errors.push(`${lineNumber}. satır: yeni stok kartı için stok kodu ve parça adı gereklidir.`); return; }
    if (!part && price === undefined) { errors.push(`${lineNumber}. satır: yeni parça için satış fiyatı gereklidir.`); return; }
    const key = part?.id || sku.toLocaleLowerCase("tr");
    const previous = aggregated.get(key);
    if (previous) {
      if (previous.price !== undefined && price !== undefined && previous.price !== price) {
        errors.push(`${lineNumber}. satır: aynı stok kodu için farklı satış fiyatları girilmiş.`);
        return;
      }
      const totalQty = previous.qty + qty;
      previous.cost = (previous.cost * previous.qty + cost * qty) / totalQty;
      previous.qty = totalQty;
      if (previous.price === undefined) previous.price = price ?? part?.price;
    } else aggregated.set(key, {
      ...(part ? { partId: part.id } : {}),
      sku: part?.sku || sku,
      name: part?.name || name,
      category: part?.category || (indexes.category >= 0 ? cells[indexes.category]?.trim() : "") || "Genel",
      brand: part?.brand || (indexes.brand >= 0 ? cells[indexes.brand]?.trim() : ""),
      minimum: part?.minimum ?? 5,
      qty,
      cost,
      price: price ?? part?.price,
    });
  });
  return { items: [...aggregated.values()], errors, rows: rows.length - (hasHeader ? 1 : 0) };
}
