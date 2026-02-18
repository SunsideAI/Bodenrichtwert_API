import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Sachsen Adapter
 *
 * Nutzt den WMS GetFeatureInfo Endpunkt (kein WFS verfügbar).
 * Daten: Bodenrichtwerte (jahresspezifischer Dienst)
 * CRS: EPSG:25833 (UTM Zone 33N)
 * Lizenz: Erlaubnis- und gebührenfrei
 */
export declare class SachsenAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wmsUrl;
    private layerCandidates;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private queryWms;
    private extractValue;
    private extractField;
    healthCheck(): Promise<boolean>;
}
