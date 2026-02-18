import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Niedersachsen Adapter
 *
 * Nutzt den LGLN OpenData WFS Endpunkt (doorman/noauth).
 * Auto-Discovery: Holt TypeNames aus GetCapabilities beim ersten Aufruf.
 * Versucht auch jahresspezifische Endpunkte (boris_2024_wfs, boris_2023_wfs).
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: dl-de/by-2-0 (Namensnennung)
 */
export declare class NiedersachsenAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private baseUrl;
    private endpoints;
    private discoveredTypeNames;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private queryEndpoint;
    /** GetCapabilities abfragen und FeatureType-Namen extrahieren */
    private discoverTypeNames;
    /** JSON/GeoJSON GetFeature Abfrage */
    private fetchFeatures;
    /** GML GetFeature Abfrage (ohne outputFormat → Server-Default) */
    private fetchGml;
    /** Properties aus JSON-Response mappen (VBORIS Kurz- und Langform) */
    private mapProperties;
    private extractGmlValue;
    private extractGmlField;
    healthCheck(): Promise<boolean>;
}
