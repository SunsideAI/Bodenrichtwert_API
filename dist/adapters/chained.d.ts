import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * ChainedAdapter: Versucht den primären Adapter, fällt auf den sekundären zurück.
 *
 * Anwendungsfall: Bayern – erst VBORIS versuchen (selten kostenlos),
 * dann ImmoScout-Schätzung als Fallback.
 */
export declare class ChainedAdapter implements BodenrichtwertAdapter {
    private primary;
    private secondary;
    state: string;
    stateCode: string;
    isFallback: boolean;
    constructor(primary: BodenrichtwertAdapter, secondary: BodenrichtwertAdapter);
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    healthCheck(): Promise<boolean>;
}
