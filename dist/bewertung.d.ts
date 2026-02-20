/**
 * Sachwert-lite Bewertungsmodul.
 *
 * Berechnet Immobilienwerte anhand von:
 *   - Bodenrichtwert (offiziell oder geschätzt)
 *   - ImmoScout-Marktpreise (Stadt- oder Stadtteil-Durchschnitt)
 *   - NHK 2010 Gebäudewert (ImmoWertV 2022 Anlage 4, mit MAF nach Anlage 25 BewG)
 *   - Ertragswertverfahren (ImmoWertV §§ 27-34) für MFH/Mietobjekte
 *   - Korrekturfaktoren (Baujahr, Modernisierung, Energie, Ausstattung, Objektunterart)
 *   - Baupreisindex (automatisch via Destatis Genesis API)
 *   - Bundesbank Wohnimmobilienpreisindex (Stichtag-Korrektur)
 *   - BORIS-NRW Immobilienrichtwerte (Cross-Validation)
 *
 * Ersetzt den bisherigen Zapier-JavaScript-Code + LLM "Sophia".
 */
import type { NormalizedBRW } from './adapters/base.js';
import type { ImmoScoutPrices } from './utils/immoscout-scraper.js';
import type { PreisindexEntry } from './utils/bundesbank.js';
import type { NRWImmobilienrichtwert } from './utils/nrw-irw.js';
import type { BaupreisindexResult } from './utils/destatis.js';
export interface BewertungInput {
    art: string | null;
    grundstuecksflaeche: number | null;
    wohnflaeche: number | null;
    baujahr: number | null;
    objektunterart: string | null;
    modernisierung: string | null;
    energie: string | null;
    ausstattung: string | null;
}
export interface BewertungFaktoren {
    baujahr: number;
    modernisierung: number;
    energie: number;
    ausstattung: number;
    objektunterart: number;
    grundstueck: number;
    neubau: number;
    stichtag_korrektur: number;
    gesamt: number;
}
export interface Bewertung {
    realistischer_qm_preis: number;
    qm_preis_spanne: {
        min: number;
        max: number;
    };
    realistischer_immobilienwert: number;
    immobilienwert_spanne: {
        min: number;
        max: number;
    };
    bodenwert: number;
    gebaeudewert: number;
    /** Ertragswert (nur bei MFH/ETW mit Mietdaten) */
    ertragswert: number | null;
    bewertungsmethode: 'sachwert-lite' | 'marktpreis-indikation' | 'vergleichswert';
    konfidenz: 'hoch' | 'mittel' | 'gering';
    faktoren: BewertungFaktoren;
    hinweise: string[];
    datenquellen: string[];
}
export declare function buildBewertung(input: BewertungInput, brw: NormalizedBRW | null, marktdaten: ImmoScoutPrices | null, preisindex?: PreisindexEntry[] | null, irw?: NRWImmobilienrichtwert | null, baupreisindex?: BaupreisindexResult | null, bundesland?: string): Bewertung;
