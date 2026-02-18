import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Sachsen Adapter
 *
 * Nutzt den WMS GetFeatureInfo Endpunkt (kein WFS verfügbar).
 * URL: landesvermessung.sachsen.de mit cfg-Parameter für Jahrgang.
 * CRS: EPSG:25833 (nativ), BBOX in EPSG:4326 (WMS 1.1.1)
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
