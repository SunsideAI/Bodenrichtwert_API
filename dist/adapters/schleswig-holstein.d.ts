import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Schleswig-Holstein Adapter
 *
 * Nutzt den GDI-SH WMS GetFeatureInfo Endpunkt.
 * Entdeckt Layer-Namen dynamisch via GetCapabilities.
 * Daten: Bodenrichtwerte via VBORIS
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: Eingeschränkt – Ansicht frei, Caching/Download nicht gestattet
 */
export declare class SchleswigHolsteinAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private readonly wmsUrls;
    private discoveredLayers;
    private discoveredUrl;
    /**
     * Get appropriate HTTP headers for the given WMS URL.
     * The _DANORD endpoints require Referer-based authentication
     * (used by the official DANord VBORIS viewer).
     */
    private getHeaders;
    /**
     * Convert WGS84 lat/lon to UTM Zone 32N (EPSG:25832).
     * Standard Transverse Mercator projection formulas.
     */
    private wgs84ToUtm32;
    private readonly layerCandidates;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private discoverService;
    private queryWms;
    /**
     * Parse an HTML GetFeatureInfo response to extract BRW value.
     * Many GDI-DE WMS services return HTML tables with feature attributes.
     */
    private parseHtmlTable;
    private parseNumber;
    private buildResult;
    private extractHtmlField;
    private extractValue;
    private extractField;
    healthCheck(): Promise<boolean>;
}
