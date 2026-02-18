import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Niedersachsen Adapter
 *
 * Nutzt den LGLN OpenData WFS Endpunkt (doorman/noauth).
 * Server: XtraServer – unterstützt vermutlich kein JSON, daher GML-Parsing.
 * Daten: Bodenrichtwerte nach VBORIS-Kurzform (brw, stag, nuta, entw, gena, wnum)
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: dl-de/by-2-0 (Namensnennung)
 */
export declare class NiedersachsenAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    private typeNameCandidates;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private tryJsonQuery;
    private tryGmlQuery;
    /** Properties aus JSON-Response mappen (VBORIS Kurz- und Langform) */
    private mapProperties;
    /** Numerischen Wert aus GML-XML extrahieren (erster Treffer aus Kandidaten-Liste) */
    private extractGmlValue;
    /** Text-Wert aus GML-XML extrahieren (erster Treffer aus Kandidaten-Liste) */
    private extractGmlField;
    healthCheck(): Promise<boolean>;
}
