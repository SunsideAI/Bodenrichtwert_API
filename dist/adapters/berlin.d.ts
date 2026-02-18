import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Berlin Adapter
 *
 * Nutzt den FIS-Broker WFS 2.0 Endpunkt.
 * Daten: Bodenrichtwerte zum 01.01.2024
 * CRS: EPSG:25833 (UTM Zone 33N)
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export declare class BerlinAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    healthCheck(): Promise<boolean>;
}
