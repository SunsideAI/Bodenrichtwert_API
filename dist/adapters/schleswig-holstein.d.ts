import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Schleswig-Holstein Adapter
 *
 * Nutzt den GDI-SH WMS GetFeatureInfo Endpunkt (kein WFS verfügbar).
 * Daten: Bodenrichtwerte via VBORIS
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: Eingeschränkt – Ansicht frei, Caching/Download nicht gestattet
 */
export declare class SchleswigHolsteinAdapter implements BodenrichtwertAdapter {
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
