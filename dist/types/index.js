// ─── Gemeinsame Konstanten / Label-Maps ──────────────────────────────────────
/**
 * Gebäudezustand (Zustandsstufen 1–5, angelehnt an ImmoScout24 / gif-Richtlinien)
 *
 * Kann als numerischer Score (1–5) oder als Textstring gesendet werden.
 * Wird als Fallback für `modernisierung` verwendet wenn dieses fehlt.
 */
export const ZUSTAND_LABELS = {
    1: 'Sanierungsbedarf',
    2: 'Renovierungsbedarf',
    3: 'Gepflegt',
    4: 'Gut',
    5: 'Neuwertig',
};
/** Umgekehrte Suche: Text → Score */
export const ZUSTAND_SCORES = {
    sanierungsbedarf: 1,
    renovierungsbedarf: 2,
    gepflegt: 3,
    gut: 4,
    neuwertig: 5,
};
/**
 * Parst einen Zustand-Wert (numerisch oder Text) in einen Score 1–5.
 * Gibt null zurück wenn der Wert nicht erkannt wird.
 */
export function parseZustandScore(value) {
    if (value == null || value === '')
        return null;
    const num = Number(value);
    if (!isNaN(num) && num >= 1 && num <= 5)
        return Math.round(num);
    const key = String(value).trim().toLowerCase().replace(/[^a-zäöü]/g, '');
    return ZUSTAND_SCORES[key] ?? null;
}
//# sourceMappingURL=index.js.map