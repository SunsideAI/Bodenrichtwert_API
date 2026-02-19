/**
 * NHK 2010 — Normalherstellungskosten nach ImmoWertV 2022 Anlage 4.
 *
 * Berechnet den Gebäude-Herstellungswert basierend auf:
 *   - NHK 2010 Kostenkennwerten (EUR/m² BGF, Preisstand 2010)
 *   - Baupreisindex-Anpassung (2010 → aktuell) — automatisch via Destatis oder Fallback
 *   - Gesamtnutzungsdauer differenziert nach Gebäudetyp und Standardstufe (ImmoWertV 2022 Anlage 1)
 *   - Lineare Alterswertminderung (SW-RL §8)
 *   - Marktanpassungsfaktor (Sachwertfaktor) nach Anlage 25 BewG
 *
 * Quellen:
 *   - ImmoWertV 2022, Anlage 4: Kostenkennwerte nach Gebäudeart und Standardstufe
 *   - ImmoWertV 2022, Anlage 1: Gesamtnutzungsdauer (standardabhängig)
 *   - SW-RL Anlage 4: Restnutzungsdauer-Modifikation bei Modernisierung
 *   - Anlage 25 BewG (JStG 2022): Wertzahlen (Sachwertfaktoren) als MAF-Fallback
 *   - Destatis Tabelle 61261-0002: Baupreisindex für Wohngebäude (Basis 2015=100)
 */
export type GebaeudTyp = 'efh_freistehend' | 'dhh' | 'reihenend' | 'reihenmittel' | 'zfh' | 'mfh' | 'etw';
/** Standardstufe 1 (einfachst) bis 5 (stark gehoben) */
export type Standardstufe = 1 | 2 | 3 | 4 | 5;
export interface NHKResult {
    gebaeudewert: number;
    /** Gebäudewert vor Marktanpassung */
    gebaeudewert_vor_maf: number;
    nhk_2010_pro_qm_bgf: number;
    bgf_geschaetzt: number;
    baupreisindex_faktor: number;
    baupreisindex_quelle: string;
    alterswertminderung: number;
    gesamtnutzungsdauer: number;
    restnutzungsdauer: number;
    marktanpassungsfaktor: number;
    hinweise: string[];
}
/**
 * Bestimmt den Marktanpassungsfaktor (Sachwertfaktor) anhand des
 * vorlaeufigen Sachwerts und des BRW-Niveaus.
 *
 * Basis: Anlage 25 BewG (vereinfachte Approximation).
 */
export declare function lookupMAF(vorlaeufigSachwert: number, brwProQm: number): number;
/**
 * Mappt objektunterart-String auf GebaeudTyp.
 * Gleiche Logik wie calcObjektunterartFaktor in bewertung.ts.
 */
export declare function mapObjektunterart(objektunterart: string | null, istHaus: boolean): GebaeudTyp;
/**
 * Mappt ausstattung-String oder Score auf Standardstufe (1–5).
 */
export declare function mapAusstattung(ausstattung: string | null): Standardstufe;
/**
 * Berechnet den Gebäude-Herstellungswert nach NHK 2010.
 *
 * Formel: Gebäudewert = NHK_2010 × BGF × BPI-Faktor × (RND / GND) × MAF
 *
 * @param wohnflaeche - Wohnfläche in m²
 * @param baujahr - Baujahr (null → Default 30 Jahre Alter)
 * @param objektunterart - Objekttyp-String (null → EFH)
 * @param ausstattung - Ausstattungsniveau (Score 1–5 oder Text)
 * @param modernisierung - Modernisierungsgrad (Score 1–5 oder Text)
 * @param istHaus - true = Haus, false = Wohnung (Default: true)
 * @param brwProQm - Bodenrichtwert EUR/m² (für MAF-Bestimmung, Default: 100)
 * @param externalBpi - Externer Baupreisindex {aktuell, basis_2010, stand, quelle} (falls verfügbar)
 */
export declare function calcGebaeudewertNHK(wohnflaeche: number, baujahr: number | null, objektunterart: string | null, ausstattung: string | null, modernisierung: string | null, istHaus?: boolean, brwProQm?: number, externalBpi?: {
    aktuell: number;
    basis_2010: number;
    stand: string;
    quelle: string;
} | null): NHKResult;
