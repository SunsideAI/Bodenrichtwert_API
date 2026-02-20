/**
 * LLM-basierte Validierungsschicht für Immobilienbewertungen.
 *
 * Prüft jedes Bewertungsergebnis mittels Claude auf Plausibilität.
 * Läuft asynchron und blockiert nie die Haupt-Response –
 * bei Timeout oder Fehler wird das Ergebnis ohne Validierung zurückgegeben.
 */
import type { Bewertung, BewertungInput } from './bewertung.js';
import type { NormalizedBRW } from './adapters/base.js';
export interface ValidationResult {
    status: 'plausibel' | 'auffaellig' | 'unplausibel' | 'fehler' | 'deaktiviert';
    confidence: number;
    bewertung_angemessen: boolean;
    abweichung_einschaetzung: string | null;
    empfohlener_wert: number | null;
    hinweise: string[];
    modell: string;
    dauer_ms: number;
}
/**
 * Validiert ein Bewertungsergebnis mittels LLM (Claude).
 *
 * - Nicht-blockierend: Bei Fehler/Timeout wird graceful ein "fehler"-Status zurückgegeben
 * - Gecacht: Gleiche Input+Ergebnis-Kombination wird 24h zwischengespeichert
 * - Deaktivierbar: Ohne ANTHROPIC_API_KEY wird sofort "deaktiviert" zurückgegeben
 */
export declare function validateBewertung(input: BewertungInput, bewertung: Bewertung, brw: NormalizedBRW | null, adresse: string, bundesland: string): Promise<ValidationResult>;
export declare function clearValidationCache(): number;
export declare function validationCacheStats(): {
    size: number;
    ttl_hours: number;
};
