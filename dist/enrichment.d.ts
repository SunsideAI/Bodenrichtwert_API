/**
 * Business Logic: Erstindikation berechnen.
 * Prüft Immobilienart, berechnet Erbbauzins-Spannen.
 */
interface ErbbauzinsBerechnung {
    grundstueck_m2: number;
    brw_eur_m2: number;
    grundstueckswert: number;
    erbbauzins_3pct_jaehrlich: number;
    erbbauzins_3pct_monatlich: number;
    erbbauzins_4pct_jaehrlich: number;
    erbbauzins_4pct_monatlich: number;
    erbbauzins_5_5pct_jaehrlich: number;
    erbbauzins_5_5pct_monatlich: number;
}
export interface Erstindikation {
    ist_haus: boolean;
    grundstuecksflaeche_bekannt: boolean;
    hinweis: string;
    rechnung?: ErbbauzinsBerechnung;
    beispielrechnung_haus?: ErbbauzinsBerechnung;
    beispielrechnungen?: Record<string, ErbbauzinsBerechnung>;
}
/**
 * Erstindikation basierend auf BRW, Immobilienart und Grundstücksfläche berechnen.
 */
export declare function buildEnrichment(brwPerM2: number | null, art?: string, grundstuecksflaeche?: number | null): Erstindikation;
export {};
