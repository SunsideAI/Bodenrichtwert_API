/**
 * BORIS-NRW Immobilienrichtwerte (IRW) — Amtliche Vergleichswerte.
 *
 * Ruft über WMS GetFeatureInfo die offiziellen Immobilienrichtwerte
 * der Gutachterausschüsse NRW ab. IRW liefern EUR/m² Wohnfläche
 * für ein standorttypisches Normobjekt (inkl. Boden + Gebäude).
 *
 * Teilmärkte: EFH, ZFH, RDH (Reihen-/Doppelhaus), ETW, MFH
 *
 * Datenquelle: https://www.wms.nrw.de/boris/wms_nw_irw
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export interface NRWImmobilienrichtwert {
    /** Immobilienrichtwert in EUR/m² Wohnfläche */
    irw: number;
    /** Teilmarkt (z.B. "EFH", "ETW", "RDH", "MFH") */
    teilmarkt: string;
    /** Stichtag (z.B. "2025-01-01") */
    stichtag: string;
    /** Normobjekt-Eigenschaften (soweit aus WMS-Response extrahierbar) */
    normobjekt: {
        baujahr?: number;
        wohnflaeche?: number;
        grundstuecksflaeche?: number;
        gebaeudeart?: string;
    };
    /** Gemeindename */
    gemeinde: string;
    quelle: 'BORIS-NRW Immobilienrichtwerte';
}
/**
 * Ruft den Immobilienrichtwert für eine NRW-Koordinate ab.
 * Versucht beide WMS-Endpunkte mit Layer-Discovery.
 *
 * @param lat - Breitengrad (WGS84)
 * @param lon - Längengrad (WGS84)
 * @param teilmarktFilter - Optionaler Teilmarkt-Filter (z.B. "EFH", "ETW")
 * @returns IRW-Daten oder null
 */
export declare function fetchImmobilienrichtwert(lat: number, lon: number, teilmarktFilter?: string): Promise<NRWImmobilienrichtwert | null>;
