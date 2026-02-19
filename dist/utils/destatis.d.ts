/**
 * Destatis Genesis API — Baupreisindex für Wohngebäude.
 *
 * Ruft Tabelle 61261-0002 (quartalsweise Baupreisindizes, Basis 2015=100)
 * vom Statistischen Bundesamt ab und extrahiert den aktuellsten Index.
 *
 * Verwendet für die NHK 2010 Anpassung (2010 → aktuell).
 *
 * Datenquelle: https://www-genesis.destatis.de
 * Lizenz: Datenlizenz Deutschland – Namensnennung – Version 2.0
 */
export interface BaupreisindexEntry {
    /** Quartal im Format "YYYY-QN", z.B. "2025-Q3" */
    quartal: string;
    /** Indexwert (Basis 2015=100) */
    index: number;
}
export interface BaupreisindexResult {
    /** Aktuellster verfügbarer Indexwert */
    aktuell: number;
    /** Quartal des aktuellsten Werts */
    stand: string;
    /** Indexwert für 2010 (Jahresdurchschnitt, Basis 2015=100) */
    basis_2010: number;
    /** Faktor: aktuell / 2010 */
    faktor: number;
    /** Alle verfügbaren Quartale */
    zeitreihe: BaupreisindexEntry[];
    /** Datenquelle */
    quelle: 'Destatis Genesis 61261-0002' | 'Fallback (hardcoded)';
}
/**
 * Ruft den aktuellen Baupreisindex für Wohngebäude ab.
 *
 * 1. Versucht Destatis Genesis API (Tabelle 61261-0002)
 * 2. Fallback auf hardcoded Werte bei API-Fehler
 *
 * @returns BaupreisindexResult mit aktuellem Index und 2010-Basis
 */
export declare function fetchBaupreisindex(): Promise<BaupreisindexResult>;
