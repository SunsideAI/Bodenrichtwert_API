import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Berlin Adapter
 *
 * Nutzt den FIS-Broker WFS 2.0 – Geometrie-Endpunkt (re_brw_2024).
 * Der Sachdaten-Endpunkt (s_brw) unterstützt kein GeoJSON,
 * daher nutzen wir den Geometrie-Endpunkt mit application/geo+json.
 * CRS: EPSG:25833 (UTM Zone 33N)
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export declare class BerlinAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    /** Fallback: Sachdaten-Endpunkt mit GML-Parsing */
    private tryGmlFallback;
    private extractGmlValue;
    private extractGmlField;
    healthCheck(): Promise<boolean>;
}
