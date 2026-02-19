import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Bremen Adapter
 *
 * Nutzt den WFS-Endpunkt bei geobasisdaten.niedersachsen.de (gleiche Infrastruktur wie NI).
 * Auto-Discovery: Holt TypeNames aus GetCapabilities beim ersten Aufruf.
 * Schema: VBORIS 2.0 / BRM 3.0 (boris namespace)
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: CC BY-ND 4.0 (seit Juni 2024 frei verfügbar)
 */
export declare class BremenAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private baseUrl;
    private endpoints;
    private discoveredTypeNames;
    private relevantTypePatterns;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private queryEndpoint;
    private discoverTypeNames;
    private fetchGml;
    private parseBestFeature;
    private extractExactNumber;
    private extractExactField;
    healthCheck(): Promise<boolean>;
}
