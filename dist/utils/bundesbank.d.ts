/**
 * Bundesbank Wohnimmobilienpreisindex.
 *
 * Ruft den SDMX REST API Endpunkt der Deutschen Bundesbank ab
 * und liefert quartalsweise Preisindizes für Wohnimmobilien.
 *
 * Datenquelle: https://api.statistiken.bundesbank.de/rest/data/BBK01/BBSRI
 * Basis: 2015 = 100
 */
export interface PreisindexEntry {
    /** Quartal im Format "YYYY-QN", z.B. "2024-Q3" */
    quartal: string;
    /** Indexwert (Basis 2015=100), z.B. 148.5 */
    index: number;
}
/**
 * Ruft den Wohnimmobilienpreisindex von der Bundesbank SDMX API ab.
 * Gibt ein sortiertes Array von {quartal, index} zurück (ältestes zuerst).
 *
 * Bei Fehler wird eine leere Liste zurückgegeben (Fallback greift dann in bewertung.ts).
 */
export declare function fetchPreisindex(): Promise<PreisindexEntry[]>;
/**
 * Berechnet die Stichtag-Korrektur basierend auf dem echten Preisindex.
 *
 * @param stichtag - BRW-Stichtag als ISO-Datum (z.B. "2020-01-01")
 * @param indexData - Array von PreisindexEntry (sortiert nach Quartal)
 * @returns Korrekturfaktor (z.B. 0.15 = +15%) oder null wenn Index nicht nutzbar
 */
export declare function calcIndexKorrektur(stichtag: string, indexData: PreisindexEntry[]): number | null;
