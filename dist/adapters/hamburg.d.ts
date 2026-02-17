import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Hamburg Adapter
 *
 * Nutzt geodienste.hamburg.de WFS.
 * Normierte BRW auf 1000m²/GFZ 1.0 – perfekt für Erstindikation.
 * CRS: EPSG:25832, Lizenz: dl-de/by-2-0
 */
export declare class HamburgAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private wfsUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    healthCheck(): Promise<boolean>;
}
