import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Nordrhein-Westfalen Adapter
 *
 * Nutzt den boris.nrw.de WFS 2.0 Endpunkt.
 * Älteste und umfangreichste offene BRW-Daten (seit 2011).
 * CRS: EPSG:25832 (UTM Zone 32N)
 */
export declare class NRWAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    healthCheck(): Promise<boolean>;
}
