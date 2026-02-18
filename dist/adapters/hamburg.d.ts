import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Hamburg Adapter
 *
 * Nutzt geodienste.hamburg.de WFS 2.0.
 * VBORIS-Feldnamen (Kurzform): BRW, STAG, NUTA, ENTW, BRZNAME, WNUM, GENA
 * CRS: EPSG:25832, Lizenz: dl-de/by-2-0
 */
export declare class HamburgAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    private discoveredTypeName;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private tryJsonQuery;
    private tryGmlQuery;
    /** Ermittelt den FeatureType-Namen via GetCapabilities */
    private getTypeName;
    private extractGmlValue;
    private extractGmlField;
    healthCheck(): Promise<boolean>;
}
