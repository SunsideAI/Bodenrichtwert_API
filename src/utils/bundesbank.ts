/**
 * Bundesbank Wohnimmobilienpreisindex.
 *
 * Ruft den SDMX REST API Endpunkt der Deutschen Bundesbank ab
 * und liefert quartalsweise Preisindizes für Wohnimmobilien.
 *
 * Datenquelle: https://api.statistiken.bundesbank.de/rest/data/BBK01/BBSRI
 * Basis: 2015 = 100
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PreisindexEntry {
  /** Quartal im Format "YYYY-QN", z.B. "2024-Q3" */
  quartal: string;
  /** Indexwert (Basis 2015=100), z.B. 148.5 */
  index: number;
}

// ─── API-Abruf ───────────────────────────────────────────────────────────────

const BUNDESBANK_API_URL =
  'https://api.statistiken.bundesbank.de/rest/data/BBK01/BBSRI';

/**
 * Ruft den Wohnimmobilienpreisindex von der Bundesbank SDMX API ab.
 * Gibt ein sortiertes Array von {quartal, index} zurück (ältestes zuerst).
 *
 * Bei Fehler wird eine leere Liste zurückgegeben (Fallback greift dann in bewertung.ts).
 */
export async function fetchPreisindex(): Promise<PreisindexEntry[]> {
  try {
    const res = await fetch(BUNDESBANK_API_URL, {
      headers: {
        Accept: 'application/vnd.sdmx.data+json;version=1.0.0-wd',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`Bundesbank API HTTP ${res.status}: ${res.statusText}`);
      return [];
    }

    const json = (await res.json()) as any;
    return parseSdmxResponse(json);
  } catch (err) {
    console.warn('Bundesbank API Fehler:', err);
    return [];
  }
}

/**
 * Parst die SDMX-JSON-Response der Bundesbank in ein einfaches Array.
 *
 * SDMX-JSON Struktur:
 *   dataSets[0].series["0:0:0:0"].observations: { "0": [value], "1": [value], ... }
 *   structure.dimensions.observation[0].values: [{ id: "2000-Q1" }, ...]
 */
function parseSdmxResponse(json: any): PreisindexEntry[] {
  try {
    const observations = findObservations(json);
    if (!observations) return [];

    // Zeitdimensionen extrahieren
    const timeDimension = json?.structure?.dimensions?.observation?.find(
      (d: any) => d.id === 'TIME_PERIOD',
    );
    const timeValues: { id: string }[] = timeDimension?.values ?? [];

    const entries: PreisindexEntry[] = [];

    for (const [indexStr, values] of Object.entries(observations)) {
      const idx = parseInt(indexStr, 10);
      const timeEntry = timeValues[idx];
      const value = Array.isArray(values) ? (values as number[])[0] : null;

      if (timeEntry?.id && typeof value === 'number' && !isNaN(value)) {
        entries.push({
          quartal: timeEntry.id,
          index: value,
        });
      }
    }

    // Sortiert nach Quartal (chronologisch)
    entries.sort((a, b) => a.quartal.localeCompare(b.quartal));
    return entries;
  } catch (err) {
    console.warn('Bundesbank SDMX Parsing Fehler:', err);
    return [];
  }
}

/**
 * Findet die Observations in der SDMX-Response.
 * Die Struktur kann variieren — wir suchen das erste verfügbare Series-Objekt.
 */
function findObservations(json: any): Record<string, number[]> | null {
  const series = json?.dataSets?.[0]?.series;
  if (!series) return null;

  // Erstes verfügbares Series-Objekt nehmen
  const firstKey = Object.keys(series)[0];
  if (!firstKey) return null;

  return series[firstKey]?.observations ?? null;
}

// ─── Stichtag-Korrektur auf Basis des Preisindex ─────────────────────────────

/**
 * Berechnet die Stichtag-Korrektur basierend auf dem echten Preisindex.
 *
 * @param stichtag - BRW-Stichtag als ISO-Datum (z.B. "2020-01-01")
 * @param indexData - Array von PreisindexEntry (sortiert nach Quartal)
 * @returns Korrekturfaktor (z.B. 0.15 = +15%) oder null wenn Index nicht nutzbar
 */
export function calcIndexKorrektur(
  stichtag: string,
  indexData: PreisindexEntry[],
): number | null {
  if (!indexData.length) return null;

  const stichtagDate = new Date(stichtag);
  if (isNaN(stichtagDate.getTime())) return null;

  const stichtagQuartal = dateToQuartal(stichtagDate);
  const aktuellesQuartal = dateToQuartal(new Date());

  // Index am Stichtag finden (exakt oder nächstliegendes Quartal)
  const stichtagIndex = findClosestIndex(stichtagQuartal, indexData);
  const aktuellerIndex = findClosestIndex(aktuellesQuartal, indexData);

  if (stichtagIndex == null || aktuellerIndex == null) return null;
  if (stichtagIndex === 0) return null; // Division by zero vermeiden

  // Korrektur = (aktuell / stichtag) - 1
  const korrektur = aktuellerIndex / stichtagIndex - 1;

  // Negative Korrektur (Markt ist gefallen) auch zurückgeben
  return Math.round(korrektur * 1000) / 1000; // Auf 3 Dezimalstellen runden
}

/**
 * Konvertiert ein Datum in "YYYY-QN" Format.
 */
function dateToQuartal(date: Date): string {
  const year = date.getFullYear();
  const quarter = Math.ceil((date.getMonth() + 1) / 3);
  return `${year}-Q${quarter}`;
}

/**
 * Findet den Index-Wert für das nächstliegende Quartal.
 * Sucht exakten Match, dann das nächst-ältere Quartal.
 */
function findClosestIndex(
  quartal: string,
  indexData: PreisindexEntry[],
): number | null {
  // Exakter Match
  const exact = indexData.find((e) => e.quartal === quartal);
  if (exact) return exact.index;

  // Nächst-älteres Quartal (das letzte vor dem Zielquartal)
  const older = indexData.filter((e) => e.quartal <= quartal);
  if (older.length > 0) return older[older.length - 1].index;

  // Falls alle Einträge neuer sind, den ältesten nehmen
  return indexData[0]?.index ?? null;
}
