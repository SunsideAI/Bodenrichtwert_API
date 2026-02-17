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
