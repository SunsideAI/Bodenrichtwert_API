/**
 * KI-Datenrecherche bei schlechter Datenlage.
 *
 * Nutzt Claude mit web_search Tool um lokale Immobiliendaten zu recherchieren,
 * wenn BORIS-BRW, IS24-Marktdaten oder andere Quellen fehlen/unzuverlässig sind.
 *
 * Trigger:
 *   - Kein BORIS-BRW (Bayern, BaWü, etc.)
 *   - Keine IS24-Marktdaten (kleine Gemeinden)
 *   - NHK-Markt-Divergenz > 40%
 *   - Konfidenz "gering"
 */
import type { NormalizedBRW } from '../adapters/base.js';
import type { ImmoScoutPrices } from './immoscout-scraper.js';
export interface ResearchTrigger {
    reason: string;
    priority: 'high' | 'medium';
}
export interface ResearchResult {
    /** Recherchierter Bodenrichtwert (€/m²) – wenn gefunden */
    recherchierter_brw: number | null;
    /** Recherchierter Kaufpreis pro m² */
    vergleichspreis_qm: number | null;
    /** Anzahl gefundener Vergleichsobjekte */
    vergleichsobjekte_anzahl: number | null;
    /** Mietpreis pro m² (wenn gefunden) */
    mietpreis_qm: number | null;
    /** Kurze Markt-Einschätzung */
    markt_einschaetzung: string | null;
    /** Zusammenfassung der Recherche */
    zusammenfassung: string;
    /** Gefundene Quellen-URLs */
    quellen: string[];
    /** Recherche-Dauer */
    dauer_ms: number;
    /** Welche Trigger die Recherche ausgelöst haben */
    trigger: string[];
}
/**
 * Prüft ob eine KI-Recherche nötig ist.
 * Gibt die Trigger-Gründe zurück (leeres Array = keine Recherche nötig).
 */
export declare function checkResearchTriggers(brw: NormalizedBRW | null, marktdaten: ImmoScoutPrices | null, bundesland: string): ResearchTrigger[];
/**
 * Führt eine KI-gestützte Marktrecherche durch.
 *
 * - Gecacht: 24h TTL
 * - Timeout: 20s (konfigurierbar via RESEARCH_TIMEOUT_MS)
 * - Graceful: Bei Fehler wird ein leeres Ergebnis zurückgegeben
 */
export declare function performResearch(adresse: string, bundesland: string, art: string | null, objektunterart: string | null, wohnflaeche: number | null, baujahr: number | null, triggers: ResearchTrigger[]): Promise<ResearchResult>;
export declare function clearResearchCache(): number;
export declare function researchCacheStats(): {
    size: number;
    ttl_hours: number;
};
