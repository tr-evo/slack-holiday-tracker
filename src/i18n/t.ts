import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(filename: string): Record<string, string> {
  const content = readFileSync(join(__dirname, filename), "utf-8");
  return JSON.parse(content);
}

const translations: Record<string, Record<string, string>> = {
  en: loadJson("en.json"),
  de: loadJson("de.json"),
};

export function t(
  key: string,
  lang: string = "en",
  params?: Record<string, string>
): string {
  let text = translations[lang]?.[key] ?? translations["en"]?.[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, v);
    }
  }

  return text;
}
