import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Sachsen-Anhalt Adapter
 *
 * Nutzt den Geodatenportal WMS GetFeatureInfo Endpunkt (kein WFS verfügbar).
 * Daten: Bodenrichtwerte 2024
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: dl-de/by-2-0 (© GeoBasis-DE / LVermGeo ST)
 */
export declare class SachsenAnhaltAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private baseUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private queryWms;
    private extractValue;
    private extractField;
    healthCheck(): Promise<boolean>;
}
