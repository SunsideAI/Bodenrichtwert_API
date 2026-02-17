import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Brandenburg Adapter
 *
 * Nutzt die moderne OGC API Features (OpenAPI 3.0) von geobasis-bb.de.
 * Best Practice Referenz – neues Datenmodell seit 2025.
 */
export declare class BrandenburgAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private baseUrl;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    healthCheck(): Promise<boolean>;
}
