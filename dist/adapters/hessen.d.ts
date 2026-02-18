import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Hessen Adapter
 *
 * Nutzt den GDS Hessen WFS 2.0 Endpunkt (BORIS Hessen).
 * Server: XtraServer – JSON evtl. nicht unterstützt, daher JSON+GML-Fallback.
 * Daten: Bodenrichtwerte zonal nach BRM 2.1.0 Schema
 * CRS: EPSG:25832, unterstützt auch EPSG:4258
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export declare class HessenAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private tryJsonQuery;
    private tryGmlQuery;
    private extractGmlValue;
    private extractGmlField;
    healthCheck(): Promise<boolean>;
}
