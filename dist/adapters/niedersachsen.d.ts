import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Niedersachsen Adapter
 *
 * Nutzt den LGLN OpenData WFS Endpunkt (doorman/noauth).
 * Auto-Discovery: Holt TypeNames aus GetCapabilities beim ersten Aufruf.
 * Versucht auch jahresspezifische Endpunkte (boris_2024_wfs, boris_2023_wfs).
 * Schema: VBORIS 2.0 / BRM 3.0 (boris namespace)
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
    private relevantTypePatterns;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private queryEndpoint;
    /** GetCapabilities abfragen und FeatureType-Namen extrahieren */
    private discoverTypeNames;
    /** GML GetFeature Abfrage mit VBORIS 2.0 Parsing */
    private fetchGml;
    /** Bestes Feature aus GML-Response wählen (Wohnbau bevorzugt) */
    private parseBestFeature;
    /**
     * Exakten Feldnamen aus GML extrahieren (numerisch).
     * Matched nur den exakten lokalen Elementnamen, nicht Substrings.
     * z.B. "bodenrichtwert" matched <boris:bodenrichtwert> aber NICHT <boris:bodenrichtwertklassifikation>
     */
    private extractExactNumber;
    /**
     * Exakten Feldnamen aus GML extrahieren (Text).
     * Matched nur den exakten lokalen Elementnamen, nicht Substrings.
     */
    private extractExactField;
    healthCheck(): Promise<boolean>;
}
