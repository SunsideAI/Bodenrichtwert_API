import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Brandenburg Adapter
 *
 * Nutzt die OGC API Features von geobasis-bb.de.
 * Collection: br_bodenrichtwert (BRM 3.0.1 Datenmodell)
 * Felder sind teilweise verschachtelt (nutzung.art, gemeinde.bezeichnung).
 */
export declare class BrandenburgAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private baseUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    healthCheck(): Promise<boolean>;
}
