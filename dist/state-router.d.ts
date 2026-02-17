import type { BodenrichtwertAdapter } from './adapters/base.js';
/**
 * Wählt den richtigen Adapter für ein Bundesland.
 * Gibt FallbackAdapter zurück für unbekannte/nicht implementierte Länder.
 */
export declare function routeToAdapter(state: string): BodenrichtwertAdapter;
/**
 * Gibt alle registrierten Adapter zurück (für Health-Check Endpoint)
 */
export declare function getAllAdapters(): Record<string, BodenrichtwertAdapter>;
