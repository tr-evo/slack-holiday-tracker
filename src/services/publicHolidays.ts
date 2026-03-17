export const BUNDESLAENDER: Record<string, string> = {
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
};

export interface PublicHoliday {
  date: string;
  name: string;
  nameDe: string;
}

let _feiertagejs: any = null;

async function loadFeiertagejs() {
  if (!_feiertagejs) {
    _feiertagejs = await import("feiertagejs");
  }
  return _feiertagejs;
}

/**
 * Get public holidays for a given year and Bundesland using feiertagejs.
 * Works for any year, no API calls or DB needed.
 */
export async function getPublicHolidaysForYear(year: number, bundesland: string): Promise<PublicHoliday[]> {
  const f = await loadFeiertagejs();
  const holidays = f.getHolidays(year, bundesland as any);
  return holidays.map((h: any) => ({
    date: h.date.toISOString().slice(0, 10),
    nameDe: h.translate("de"),
    name: h.translate("en") || h.translate("de"),
  }));
}

/**
 * Get just the date strings for holiday calculation.
 */
export async function getHolidayDatesForYear(year: number, bundesland: string): Promise<string[]> {
  const holidays = await getPublicHolidaysForYear(year, bundesland);
  return holidays.map((h) => h.date);
}

/**
 * Get holiday dates across multiple years.
 */
export async function getHolidayDatesForYears(years: number[], bundesland: string): Promise<string[]> {
  const results = await Promise.all(years.map((y) => getHolidayDatesForYear(y, bundesland)));
  return results.flat();
}
