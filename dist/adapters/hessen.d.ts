import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Hessen Adapter
 *
 * Nutzt den GDS Hessen WFS 2.0 Endpunkt (BORIS Hessen).
 * Daten: Bodenrichtwerte zonal + lagetypisch
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export declare class HessenAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    healthCheck(): Promise<boolean>;
}
