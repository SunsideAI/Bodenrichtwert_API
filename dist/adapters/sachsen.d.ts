import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Sachsen Adapter
 *
 * Nutzt den GeoSN HTTP-Proxy WMS mit INFO_FORMAT=text/plain.
 *
 * Wichtig: text/xml liefert HTML (nicht XML!) – nur text/plain enthält die Daten.
 *
 * Antwortformat (text/plain):
 *   Layer 'brw_bauland_2024'
 *   Feature 1250309:
 *     BODENRICHTWERT_TEXT = '2400'
 *     STICHTAG_TXT = '01.01.2024'
 *     NUTZUNG = 'MK'
 *     ENTWICKLUNGSZUSTAND_K = 'B'
 *     GA_POST_ADRESSE = 'Burgplatz 1, 04109 Leipzig'
 *
 * CRS: EPSG:25833 (nativ), BBOX in EPSG:4326 (WMS 1.1.1)
 * Lizenz: Erlaubnis- und gebührenfrei (© GeoSN)
 */
export declare class SachsenAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private readonly proxyUrl;
    private readonly layers;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private queryWms;
    /**
     * Parses the text/plain GetFeatureInfo response.
     * Format:
     *   Layer 'brw_bauland_2024'
     *   Feature 1234:
     *     KEY = 'VALUE'
     *     ...
     */
    private parseTextPlain;
    /** Convert German date format '01.01.2024' → '2024-01-01' */
    private convertDate;
    /** Extract city name from address string "Burgplatz 1, 04109 Leipzig" → "Leipzig" */
    private extractGemeinde;
    healthCheck(): Promise<boolean>;
}
