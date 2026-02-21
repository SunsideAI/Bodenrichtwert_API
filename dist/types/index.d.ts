/**
 * Gebäudezustand (Zustandsstufen 1–5, angelehnt an ImmoScout24 / gif-Richtlinien)
 *
 * Kann als numerischer Score (1–5) oder als Textstring gesendet werden.
 * Wird als Fallback für `modernisierung` verwendet wenn dieses fehlt.
 */
export declare const ZUSTAND_LABELS: Record<number, string>;
/** Umgekehrte Suche: Text → Score */
export declare const ZUSTAND_SCORES: Record<string, number>;
/**
 * Parst einen Zustand-Wert (numerisch oder Text) in einen Score 1–5.
 * Gibt null zurück wenn der Wert nicht erkannt wird.
 */
export declare function parseZustandScore(value: string | number | null | undefined): number | null;
