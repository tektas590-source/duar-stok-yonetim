function normalizePartQuery(value) {
  return value.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

export function findPartMatches(query, parts) {
  const normalizedQuery = normalizePartQuery(query);
  if (!normalizedQuery) return [];

  return parts
    .map((part) => {
      const sku = normalizePartQuery(part.sku);
      const name = normalizePartQuery(part.name);
      const fields = [sku, name];
      const rank = fields.includes(normalizedQuery) ? 0 : fields.some((field) => field.startsWith(normalizedQuery)) ? 1 : fields.some((field) => field.includes(normalizedQuery)) ? 2 : -1;
      return { part, rank };
    })
    .filter((match) => match.rank >= 0)
    .sort((first, second) => first.rank - second.rank || first.part.name.localeCompare(second.part.name, "tr"))
    .map(({ part }) => part);
}

export function parsePastedPartQueries(text) {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.includes("\t") ? line.split("\t") : line.includes(";") ? line.split(";") : line.includes(",") ? line.split(",") : [line];
      return cells[0].trim();
    })
    .filter(Boolean);
}
