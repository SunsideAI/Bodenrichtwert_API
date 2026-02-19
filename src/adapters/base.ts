/**
 * Metadaten für geschätzte (nicht offizielle) BRW-Werte
 */
export interface EstimationMeta {
  methode: string;            // z.B. "ImmoScout Atlas Marktpreise × Faktor"
  basis_preis: number;        // Ursprünglicher Marktpreis (€/m²)
  faktor: number;             // Angewandter Umrechnungsfaktor (0.22–0.55)
  datenstand: string;         // z.B. "2026-Q1"
  hinweis: string;            // Disclaimer
}

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
  schaetzung?: EstimationMeta; // Nur bei Schätzwerten (z.B. ImmoScout)
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
