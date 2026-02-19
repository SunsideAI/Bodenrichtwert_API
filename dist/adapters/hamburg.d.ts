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
    private uekWfsUrl;
    private uekWmsUrl;
    private discoveredTypeName;
    private readonly fallbackTypeNames;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    /**
     * Build multiple bbox strings to work around CRS and axis order issues.
     * Hamburg's deegree WFS uses EPSG:25832 (UTM Zone 32N) natively.
     * EPSG:4326 queries return 0 features, so we convert to UTM first.
     */
    private buildBboxStrategies;
    /**
     * Convert WGS84 lat/lon to UTM Zone 32N (EPSG:25832).
     * Standard Transverse Mercator projection formulas.
     */
    private wgs84ToUtm32;
    private tryWfsGml;
    /**
     * WMS GetFeatureInfo fallback.
     * Hamburg also has a WMS endpoint with different layer names.
     */
    private tryWmsQuery;
    /**
     * Extract BRW value from HTML table response.
     */
    private extractHtmlBrw;
    /** Ermittelt alle FeatureType-Namen via GetCapabilities, priorisiert */
    private getTypeNames;
    private extractGmlValue;
    private extractGmlField;
    healthCheck(): Promise<boolean>;
}
