/**
 * Ertragswertverfahren nach ImmoWertV 2022 §§ 27-34.
 *
 * Berechnet den Ertragswert (Renditewert) einer Immobilie basierend auf:
 *   - Jahresrohertrag (Mieteinnahmen)
 *   - Bewirtschaftungskosten (II. BV §26)
 *   - Liegenschaftszins (BewG §256 / Gutachterausschuss)
 *   - Vervielfältiger (Barwertfaktor)
 *   - Bodenwert
 *
 * Dieses Verfahren ist besonders geeignet für:
 *   - Mehrfamilienhäuser (MFH)
 *   - Eigentumswohnungen (ETW) als Kapitalanlage
 *   - Mietwohngrundstücke
 *
 * Quellen:
 *   - ImmoWertV 2022, §§ 27-34: Ertragswertverfahren
 *   - ImmoWertV 2022, Anlage 1: Vervielfältigertabelle
 *   - BewG § 256: Liegenschaftszinssätze (gesetzlicher Fallback)
 *   - II. BV § 26: Verwaltungskosten (Anhaltswerte)
 */
export interface ErtragswertInput {
    /** Wohnfläche in m² (für Rohertrag-Berechnung aus Mietpreis/m²) */
    wohnflaeche: number;
    /** Monatliche Kaltmiete pro m² (aus ImmoScout-Marktdaten) */
    mietpreisProQm: number;
    /** Bodenwert in EUR (BRW × Grundstücksfläche) */
    bodenwert: number;
    /** Bodenrichtwert EUR/m² (für Liegenschaftszins-Ableitung) */
    brwProQm: number;
    /** Baujahr (für Bewirtschaftungskosten + RND) */
    baujahr: number | null;
    /** Restnutzungsdauer in Jahren (wenn bereits berechnet) */
    restnutzungsdauer?: number;
    /** Gebäudetyp (für Liegenschaftszins-Bestimmung) */
    gebaeudTyp: 'mfh' | 'etw' | 'efh' | 'zfh';
}
export interface ErtragswertResult {
    /** Ertragswert (Gesamtwert) in EUR */
    ertragswert: number;
    /** Gebäudeertragswert in EUR */
    gebaeudeertragswert: number;
    /** Jahresrohertrag (Bruttomieteinnahmen) in EUR */
    jahresrohertrag: number;
    /** Bewirtschaftungskosten in EUR/Jahr */
    bewirtschaftungskosten: number;
    /** Jahresreinertrag in EUR */
    jahresreinertrag: number;
    /** Verwendeter Liegenschaftszins (als Dezimalzahl) */
    liegenschaftszins: number;
    /** Barwertfaktor (Vervielfältiger) */
    vervielfaeltiger: number;
    /** Bodenwert in EUR */
    bodenwert: number;
    /** Hinweise zur Berechnung */
    hinweise: string[];
}
/**
 * Berechnet den Ertragswert nach ImmoWertV 2022 §§ 27-34 (allgemeines Verfahren).
 *
 * Formel:
 *   Ertragswert = Gebäudeertragswert + Bodenwert
 *   Gebäudeertragswert = (Reinertrag - Bodenwertverzinsung) × Vervielfältiger
 *   Reinertrag = Rohertrag - Bewirtschaftungskosten
 *
 * @param input - Eingabeparameter für die Ertragswertberechnung
 * @returns ErtragswertResult oder null wenn Berechnung nicht möglich
 */
export declare function calcErtragswert(input: ErtragswertInput): ErtragswertResult | null;
