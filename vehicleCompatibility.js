import { isCancelledWorkOrder } from "./workOrderLifecycle.js";

export const FUEL_TYPES = ["Dizel", "Benzin"];

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function formatFitmentVehicle(fitment) {
  return [fitment?.make, fitment?.model, fitment?.year].filter(Boolean).join(" ").trim();
}

export function formatFitmentSpec(fitment) {
  return [fitment?.engine, fitment?.fuel].filter(Boolean).join(" · ");
}

export function searchFitments(fitments, query, fuel = "all") {
  const search = normalizeSearchText(query);
  const selectedFuel = String(fuel || "all");
  return [...(fitments || [])]
    .filter((fitment) => selectedFuel === "all" || String(fitment.fuel || "") === selectedFuel)
    .filter((fitment) => {
      if (!search) return true;
      const partsText = (fitment.parts || []).map((part) => `${part.name || ""} ${part.sku || ""}`).join(" ");
      return normalizeSearchText(`${fitment.make} ${fitment.model} ${fitment.year} ${fitment.fuel} ${fitment.engine} ${partsText}`).includes(search);
    })
    .sort((first, second) => {
      const make = String(first.make || "").localeCompare(String(second.make || ""), "tr");
      if (make) return make;
      const model = String(first.model || "").localeCompare(String(second.model || ""), "tr");
      if (model) return model;
      const year = String(first.year || "").localeCompare(String(second.year || ""), "tr");
      if (year) return year;
      return String(first.engine || "").localeCompare(String(second.engine || ""), "tr");
    });
}

function normalizePlate(value) {
  return String(value || "").replace(/\s+/g, "").toLocaleUpperCase("tr");
}

export function searchVehiclePartUsage(jobs, query) {
  const search = normalizeSearchText(query);
  const plateSearch = normalizePlate(query);
  if (!search) return [];

  const vehicles = new Map();
  const sortedJobs = jobs.filter((job) => !isCancelledWorkOrder(job)).sort((first, second) => (second.date || "").localeCompare(first.date || ""));

  sortedJobs.forEach((job) => {
    const plate = String(job.plate || "").trim().toLocaleUpperCase("tr");
    const plateKey = normalizePlate(plate);
    if (!plateKey) return;

    let vehicle = vehicles.get(plateKey);
    if (!vehicle) {
      vehicle = { plate, make: job.make || "", model: job.model || "", jobs: [], parts: new Map(), latestDate: job.date || "" };
      vehicles.set(plateKey, vehicle);
    }
    vehicle.jobs.push(job);
    if ((job.date || "") > vehicle.latestDate) {
      vehicle.latestDate = job.date || "";
      vehicle.plate = plate;
      vehicle.make = job.make || "";
      vehicle.model = job.model || "";
    }

    const visitId = job.code || job.id || `${plateKey}-${job.date || ""}`;
    (job.items || []).forEach((item) => {
      const partKey = item.partId || (item.sku ? `sku:${item.sku.toLocaleLowerCase("tr")}` : `name:${normalizeSearchText(item.name)}`);
      const usage = vehicle.parts.get(partKey) || {
        partId: item.partId || "",
        sku: item.sku || "",
        name: item.name || item.sku || "Parça",
        quantity: 0,
        visits: new Set(),
        lastDate: job.date || "",
        lastJobCode: job.code || job.id || "",
      };
      usage.quantity += Number(item.qty || 0);
      usage.visits.add(visitId);
      if ((job.date || "") > usage.lastDate) {
        usage.lastDate = job.date || "";
        usage.lastJobCode = job.code || job.id || "";
        usage.name = item.name || item.sku || usage.name;
        usage.sku = item.sku || usage.sku;
      }
      vehicle.parts.set(partKey, usage);
    });
  });

  return [...vehicles.values()]
    .filter((vehicle) => {
      const vehicleText = normalizeSearchText(`${vehicle.make} ${vehicle.model}`);
      return normalizePlate(vehicle.plate).includes(plateSearch) || vehicleText.includes(search);
    })
    .map((vehicle) => ({
      ...vehicle,
      jobs: [...vehicle.jobs].sort((first, second) => (second.date || "").localeCompare(first.date || "")),
      parts: [...vehicle.parts.values()]
        .map((part) => ({ ...part, visits: part.visits.size }))
        .sort((first, second) => (second.lastDate || "").localeCompare(first.lastDate || "") || first.name.localeCompare(second.name, "tr")),
    }))
    .sort((first, second) => (second.latestDate || "").localeCompare(first.latestDate || ""));
}
