import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Berlin Adapter
 *
 * Nutzt den neuen Geoportal Berlin WFS 2.0 (GeoServer) unter gdi.berlin.de.
 * Der alte FIS-Broker (fbinter.stadt-berlin.de) wurde Ende 2025 abgeschaltet.
 * Feature-Type: brw2025:brw_2025_vector
 * CRS: EPSG:4326 (WGS84) für bbox-Abfragen
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export declare class BerlinAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    healthCheck(): Promise<boolean>;
}
