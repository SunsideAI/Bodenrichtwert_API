import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Hessen Adapter
 *
 * Nutzt den GDS Hessen WFS 2.0 Endpunkt (BORIS Hessen).
 * Server (XtraServer): JSON wird NICHT unterstützt (400 Bad Request).
 * Verwendet nur GML/WFS.
 *
 * GML-Struktur (BRM 2.1.0):
 *   <boris:bodenrichtwert uom="EUR/m^2">8500</boris:bodenrichtwert>
 *   ↑ Attribut im Tag – Regex muss Attribute erlauben!
 *
 * CRS: EPSG:25832, unterstützt auch EPSG:4258
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export declare class HessenAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    private readonly MAX_BRW;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private tryGmlQuery;
    /**
     * Extracts a numeric value from a GML element.
     * Crucially allows attributes in the opening tag, e.g.:
     *   <boris:bodenrichtwert uom="EUR/m^2">8500</boris:bodenrichtwert>
     */
    private extractGmlValue;
    private extractGmlField;
    healthCheck(): Promise<boolean>;
}
