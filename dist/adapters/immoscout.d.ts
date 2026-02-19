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
 * Die Umrechnung nutzt preisabhängige Faktoren:
 * - Teure Lagen (>6000 €/m²): ~55% Bodenanteil
 * - Günstige Lagen (<1500 €/m²): ~22% Bodenanteil
 */
export declare class ImmoScoutAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private bundeslandSlug;
    constructor(state: 'Bayern' | 'Baden-Württemberg');
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    /**
     * Reverse-Geocode via Nominatim: lat/lon → Stadt + Slugs
     */
    private reverseGeocode;
    /**
     * Schätzt den Bodenrichtwert basierend auf dem Hauspreis.
     * Höhere Immobilienpreise → höherer Bodenanteil.
     */
    private estimateBRW;
    healthCheck(): Promise<boolean>;
}
