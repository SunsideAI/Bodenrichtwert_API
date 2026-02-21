import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Nordrhein-Westfalen Adapter
 *
 * Nutzt den BORIS-NRW WMS GetFeatureInfo-Endpunkt.
 * NRW bietet keinen öffentlichen WFS, nur WMS.
 * WMS: https://www.wms.nrw.de/boris/wms_nw_brw (aktueller Jahrgang)
 * WMS-T: https://www.wms.nrw.de/boris/wms-t_nw_brw (ab 2011)
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export declare class NRWAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wmsEndpoints;
    private layerCandidates;
    private discoveredLayers;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private queryEndpoint;
    /** GetCapabilities abfragen um verfügbare Layer zu finden */
    private discoverLayers;
    private queryWmsLayer;
    private parseJsonResponse;
    private parseXmlResponse;
    private parseHtmlResponse;
    private extractNumberFromXml;
    private parseGermanNumber;
    private extractFieldFromXml;
    healthCheck(): Promise<boolean>;
}
