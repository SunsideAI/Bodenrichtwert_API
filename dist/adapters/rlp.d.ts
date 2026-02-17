import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Rheinland-Pfalz Adapter
 *
 * Nutzt den WMS "Generalisierte Bodenrichtwerte" GetFeatureInfo-Endpunkt.
 *
 * Hintergrund:
 *   - /spatial-objects/548 (OGC API) = Premiumdienst → 401 Unauthorized
 *   - /spatial-objects/299 (OGC API) = Basisdienst → nur Zonengeometrie, keine Werte
 *   - geo5.service24.rlp.de WMS GetFeatureInfo = liefert generalisierte BRW-Werte
 *
 * WMS: https://geo5.service24.rlp.de/wms/genbori_rp.fcgi
 * Layer: Wohnbauflaechen, Gemischte_Bauflaechen, Gewerbeflaechen, etc.
 */
export declare class RheinlandPfalzAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wmsUrl;
    private layers;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private queryWmsLayer;
    private queryWmsHtml;
    /** Bodenrichtwert aus XML-GetFeatureInfo extrahieren */
    private extractValueFromXml;
    /** Feldwert aus XML extrahieren */
    private extractFieldFromXml;
    /** BRW-Wert aus HTML-GetFeatureInfo extrahieren */
    private extractValueFromHtml;
    /** Gemeindename aus HTML-GetFeatureInfo extrahieren */
    private extractGemeindeFromHtml;
    healthCheck(): Promise<boolean>;
}
