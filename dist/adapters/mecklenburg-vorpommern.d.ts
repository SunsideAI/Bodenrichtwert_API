import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Mecklenburg-Vorpommern Adapter
 *
 * Nutzt den geodaten-mv.de WFS 2.0 Endpunkt.
 * Daten: Bodenrichtwerte nach BORIS.MV2.1 Datenmodell
 * CRS: EPSG:25833 (UTM Zone 33N)
 * Lizenz: GutALVO M-V (frei zugänglich)
 */
export declare class MecklenburgVorpommernAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    healthCheck(): Promise<boolean>;
}
