import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * ImmoScout Atlas Adapter
 *
 * Schätzt Bodenrichtwerte basierend auf ImmoScout24 Atlas-Marktpreisen.
 * KEIN offizieller BRW – nur eine Indikation basierend auf Immobilienpreisen.
 *
 * Ablauf:
 * 1. Reverse-Geocode lat/lon → Stadt + Bundesland
 * 2. ImmoScout Atlas URL bauen + fetchen
 * 3. _atlas_initialState JSON parsen → haus_kauf_preis
 * 4. Preisabhängigen Faktor anwenden → BRW-Schätzwert
 *
 * Die Umrechnung nutzt eine stetige logarithmische Funktion:
 *   faktor = 0.165 × ln(preis) − 0.935, begrenzt auf [0.15, 0.60]
 * Beispiele: 1000 €/m² → ~22%, 3000 €/m² → ~38%, 7000 €/m² → ~53%
 */
export declare class ImmoScoutAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private bundeslandSlug;
    constructor(state: 'Bayern' | 'Baden-Württemberg');
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    /**
     * Reverse-Geocode via Nominatim: lat/lon → Stadt + Landkreis + Slugs
     */
    private reverseGeocode;
    /**
     * Schätzt den Bodenrichtwert basierend auf dem Hauspreis.
     * Höhere Immobilienpreise → höherer Bodenanteil.
     *
     * Stetige logarithmische Funktion statt harter Stufen.
     * Kalibriert an empirischen Stützpunkten:
     *   1000 €/m² → ~22% Bodenanteil (ländlich)
     *   2000 €/m² → ~30% (Kleinstadt)
     *   3250 €/m² → ~38% (Suburban)
     *   5000 €/m² → ~46% (Urban)
     *   7000 €/m² → ~53% (Premium)
     *
     * Formel: faktor = 0.165 × ln(preis) − 0.935
     * Grenzen: [0.15, 0.60] — ländlicher Mindestwert / Luxus-Obergrenze
     */
    private estimateBRW;
    healthCheck(): Promise<boolean>;
}
