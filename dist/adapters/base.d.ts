/**
 * Metadaten für geschätzte (nicht offizielle) BRW-Werte
 */
export interface EstimationMeta {
    methode: string;
    basis_preis: number;
    faktor: number;
    datenstand: string;
    hinweis: string;
}
/**
 * Normalisierte BRW-Daten – einheitliches Format über alle Bundesländer
 */
export interface NormalizedBRW {
    wert: number;
    stichtag: string;
    nutzungsart: string;
    entwicklungszustand: string;
    zone: string;
    gemeinde: string;
    bundesland: string;
    quelle: string;
    lizenz: string;
    schaetzung?: EstimationMeta;
}
/**
 * Interface das jeder Bundesland-Adapter implementieren muss
 */
export interface BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    fallbackReason?: string;
    borisUrl?: string;
    /**
     * BRW für gegebene WGS84-Koordinaten abfragen.
     * Gibt null zurück wenn kein BRW gefunden.
     */
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    /**
     * Prüft ob der WFS-Endpunkt erreichbar ist.
     */
    healthCheck(): Promise<boolean>;
}
