export interface GeoResult {
    lat: number;
    lon: number;
    state: string;
    city: string;
    district: string;
    county: string;
    displayName: string;
}
/**
 * Geocode eine Adresse zu Koordinaten + Bundesland.
 * Strategie: Nominatim als Primary, PLZ-Tabelle als Bundesland-Fallback.
 */
export declare function geocode(strasse: string, plz: string, ort: string): Promise<GeoResult | null>;
