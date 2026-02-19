import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Bayern Adapter
 *
 * Nutzt das neue VBORIS-Portal (seit August 2025):
 * https://geoportal.bayern.de/bodenrichtwerte/vboris
 *
 * Die alte URL (geoservices.bayern.de/wms/v1/ogc_bodenrichtwerte.cgi)
 * gibt seit ~2025 HTTP 404 zurück.
 *
 * Layer: bodenrichtwerte_aktuell (queryable=1, bestätigt via GetCapabilities)
 * CRS: EPSG:4326, EPSG:25832, EPSG:3857, EPSG:31468 (alle bestätigt)
 * GetFeatureInfo-Formate: text/plain, text/html, application/vnd.ogc.gml
 * WMS-Version: 1.1.1
 *
 * HINWEIS: Die meisten Gutachterausschüsse in Bayern geben
 * "Information gebührenpflichtig" für den BRW-Wert zurück.
 * Getestet: München, Augsburg, Nürnberg, Garmisch-Partenkirchen — alle paywalled.
 * Nur wenige Stellen sind öffentlich zugänglich.
 * Der Adapter gibt null zurück wenn der Wert gebührenpflichtig ist.
 *
 * Lizenz: © Bayerische Vermessungsverwaltung (www.geodaten.bayern.de)
 */
export declare class BayernAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private readonly wmsUrls;
    private layerCandidates;
    private discoveredLayers;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private queryEndpoint;
    private discoverLayers;
    private queryWms;
    private wgs84ToUtm32;
    private parseTextPlain;
    private parseXml;
    private parseHtml;
    /**
     * Parser für die VBORIS-HTML-Tabelle (bestätigtes Format via curl).
     * Extrahiert Key-Value-Paare aus <td>Key</td><td>Value</td> Zeilen.
     */
    private parseVborisTable;
    /** Generischer HTML-Parser als Fallback */
    private parseHtmlGeneric;
    private extractNumber;
    private extractField;
    /** '01.01.2024' → '2024-01-01' */
    private convertDate;
    healthCheck(): Promise<boolean>;
}
