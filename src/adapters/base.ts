/**
 * Normalisierte BRW-Daten – einheitliches Format über alle Bundesländer
 */
export interface NormalizedBRW {
  wert: number;              // €/m²
  stichtag: string;          // z.B. "2024-01-01"
  nutzungsart: string;       // z.B. "Wohnbaufläche", "W"
  entwicklungszustand: string; // z.B. "B" (baureif)
  zone: string;              // BRW-Zone Name
  gemeinde: string;
  bundesland: string;
  quelle: string;            // z.B. "BORIS-HH"
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
