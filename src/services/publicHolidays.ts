import { getDb } from "../db/connection.js";
import { createPublicHolidayRepo } from "../db/repositories/publicHolidayRepo.js";

// German holiday names → English translations
const TRANSLATIONS: Record<string, string> = {
  "Neujahrstag": "New Year's Day",
  "Heilige Drei Könige": "Epiphany",
  "Internationaler Frauentag": "International Women's Day",
  "Karfreitag": "Good Friday",
  "Ostermontag": "Easter Monday",
  "Tag der Arbeit": "Labour Day",
  "Christi Himmelfahrt": "Ascension Day",
  "Pfingstmontag": "Whit Monday",
  "Fronleichnam": "Corpus Christi",
  "Mariä Himmelfahrt": "Assumption Day",
  "Weltkindertag": "World Children's Day",
  "Tag der Deutschen Einheit": "German Unity Day",
  "Reformationstag": "Reformation Day",
  "Allerheiligen": "All Saints' Day",
  "Buß- und Bettag": "Repentance and Prayer Day",
  "1. Weihnachtstag": "Christmas Day",
  "2. Weihnachtstag": "St. Stephen's Day",
};

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

interface FeiertageResponse {
  [name: string]: { datum: string; hinweis: string };
}

export async function fetchPublicHolidays(year: number, bundesland: string): Promise<{ date: string; name: string; nameDe: string }[]> {
  const url = `https://feiertage-api.de/api/?jahr=${year}&nur_land=${bundesland}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch holidays: ${res.status}`);
  const data: FeiertageResponse = await res.json();

  return Object.entries(data).map(([nameDe, { datum }]) => ({
    date: datum,
    name: TRANSLATIONS[nameDe] ?? nameDe,
    nameDe,
  }));
}

export async function seedPublicHolidays(year: number, bundesland: string): Promise<number> {
  const holidays = await fetchPublicHolidays(year, bundesland);
  const db = getDb();
  const repo = createPublicHolidayRepo(db);

  for (const h of holidays) {
    repo.add(h);
  }

  return holidays.length;
}
