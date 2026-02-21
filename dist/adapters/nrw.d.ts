import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Nordrhein-Westfalen Adapter
 *
 * Nutzt den BORIS-NRW WMS GetFeatureInfo-Endpunkt (ESRI ArcGIS Server).
 * NRW bietet keinen öffentlichen WFS, nur WMS.
 * WMS: https://www.wms.nrw.de/boris/wms_nw_brw (aktueller Jahrgang)
 * WMS-T: https://www.wms.nrw.de/boris/wms-t_nw_brw (ab 2011)
 *
 * ESRI-WMS liefert GetFeatureInfo als <FIELDS attr="val" /> Attribut-Format.
 * Layer-IDs können numerisch ("5") oder benannt ("brw_ein_zweigeschossig") sein.
 *
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export declare class NRWAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wmsEndpoints;
    private knownLayers;
    private discoveredLayers;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private queryEndpoint;
    /** Schnelle XML-Abfrage mit Early-Return bei leerer ESRI-Response */
    private queryWmsXml;
    /** GetCapabilities abfragen um verfügbare Layer zu finden */
    private discoverLayers;
    private queryWmsLayer;
    /**
     * Erkennt leere ESRI WMS-Responses:
     * - Selbstschließendes XML: <FeatureInfoResponse ... />
     * - HTML nur mit CSS/Boilerplate ohne Tabellendaten
     */
    private isEmptyResponse;
    private parseJsonResponse;
    private parseXmlResponse;
    private parseHtmlResponse;
    private extractNumberFromXml;
    private parseGermanNumber;
    private extractFieldFromXml;
    healthCheck(): Promise<boolean>;
}
