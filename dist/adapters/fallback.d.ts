import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Fallback-Adapter für Bundesländer ohne freien WFS.
 * Gibt immer null zurück mit Hinweis auf BORIS-Portal.
 */
export declare class FallbackAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    fallbackReason: string;
    borisUrl: string;
    constructor(stateName: string);
    getBodenrichtwert(_lat: number, _lon: number): Promise<NormalizedBRW | null>;
    healthCheck(): Promise<boolean>;
}
