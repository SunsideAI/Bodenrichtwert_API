/**
 * Statische PLZ → Bundesland Zuordnung.
 * Basiert auf den groben PLZ-Bereichen. Nicht 100% exakt an Grenzen,
 * aber ausreichend für Bundesland-Routing.
 *
 * Quelle: Deutsche Post PLZ-Verzeichnis
 */
/**
 * PLZ (als String, z.B. "55469") → Bundesland.
 * Gibt null zurück wenn keine Zuordnung gefunden.
 */
export declare function plzToState(plz: string): string | null;
