/**
 * ImmoScout24 Atlas + Suche Scraper (TypeScript)
 *
 * Portiert die Kernlogik des Python-Scrapers (SunsideAI/Bodenrichtwer_Scraper)
 * nach TypeScript. Extrahiert _atlas_initialState JSON aus ImmoScout Atlas-Seiten
 * und gibt strukturierte Preisdaten zurück.
 *
 * Quelle: atlas.immobilienscout24.de/orte/deutschland/{bundesland}/{stadt}
 * Fallback: IS24 Mobile API (api.mobile.immobilienscout24.de/search/list)
 */
export declare const ATLAS_BASE = "https://atlas.immobilienscout24.de";
export interface ImmoScoutPrices {
    stadt: string;
    stadtteil: string;
    bundesland: string;
    haus_kauf_preis: number | null;
    haus_kauf_min: number | null;
    haus_kauf_max: number | null;
    wohnung_kauf_preis: number | null;
    wohnung_kauf_min: number | null;
    wohnung_kauf_max: number | null;
    haus_miete_preis: number | null;
    haus_miete_min: number | null;
    haus_miete_max: number | null;
    wohnung_miete_preis: number | null;
    wohnung_miete_min: number | null;
    wohnung_miete_max: number | null;
    jahr: number;
    quartal: number;
    lat: number;
    lng: number;
}
/**
 * Konvertiert einen deutschen Ortsnamen in einen ImmoScout-URL-Slug.
 * ImmoScout nutzt echte Unicode-Zeichen (ü, ö, ä, ß) in URLs:
 *   "München" → "münchen"  (NICHT "muenchen"!)
 *   "Baden-Württemberg" → "baden-württemberg"
 * fetch() URL-encodiert automatisch: "münchen" → "m%C3%BCnchen"
 */
export declare function slugify(name: string): string;
/**
 * ASCII-only Slug für IS24 Mobile API Geocode-Pfade.
 * Die Mobile API verwendet teils ASCII-Slugs (ü→ue, ö→oe, ä→ae, ß→ss)
 * statt Unicode wie der Atlas.
 */
export declare function slugifyAscii(name: string): string;
/**
 * Scrapt ImmoScout Atlas für eine Stadt und gibt Preisdaten zurück.
 *
 * @param bundeslandSlug - z.B. "bayern", "baden-wuerttemberg"
 * @param stadtSlug - z.B. "muenchen", "stuttgart"
 * @param stadtteilSlug - optional: z.B. "schwabing"
 */
export declare function scrapeImmoScoutAtlas(bundeslandSlug: string, stadtSlug: string, stadtteilSlug?: string): Promise<ImmoScoutPrices | null>;
/**
 * Baut den IS24-Geocode-Pfad-Slug für einen Landkreis.
 * "Landkreis Gifhorn" → "gifhorn-kreis"
 * "Kreis Soest" → "soest-kreis"
 * "Region Hannover" → "region-hannover"
 * "" (kreisfrei) → ""
 */
export declare function buildSearchKreisSlug(county: string): string;
/**
 * IS24 Mobile API Suche: Aggregiert Listing-Preise zu Marktdaten.
 * Fallback für Orte ohne Atlas-Daten (z.B. Meine, Gifhorn-Kreis).
 *
 * Geocode-Pfad: /de/{bundesland}/{kreis}/{ort}
 */
export declare function scrapeImmoScoutSearch(bundeslandSlug: string, kreisSlug: string | undefined, ortSlug: string, ortName: string): Promise<ImmoScoutPrices | null>;
/**
 * Scrapt die Stadtteile einer Stadt und gibt eine Liste zurück.
 * Nützlich um den nächsten Stadtteil per Koordinaten zu finden.
 */
export declare function scrapeImmoScoutDistricts(bundeslandSlug: string, stadtSlug: string): Promise<ImmoScoutPrices[]>;
