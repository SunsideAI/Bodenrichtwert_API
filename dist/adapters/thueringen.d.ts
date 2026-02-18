import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Thüringen Adapter
 *
 * Nutzt den GeoProxy Thüringen WFS Endpunkt (vBORIS_simple_wfs).
 * Daten: Bodenrichtwertzonen seit 31.12.2008
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: dl-de/by-2-0 (© GDI-Th)
 */
export declare class ThueringenAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    healthCheck(): Promise<boolean>;
}
