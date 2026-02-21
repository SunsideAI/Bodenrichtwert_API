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

// ─── Konfiguration ──────────────────────────────────────────────────────────

const RESEARCH_TIMEOUT_MS = parseInt(process.env.RESEARCH_TIMEOUT_MS || '20000', 10);
const RESEARCH_MODEL = process.env.RESEARCH_MODEL || 'claude-sonnet-4-5-20250929';
const RESEARCH_MAX_SEARCHES = 5;

// ─── Interfaces ─────────────────────────────────────────────────────────────

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

// ─── Recherche-Cache (Speicher, 24h TTL) ────────────────────────────────────

interface CacheEntry {
  result: ResearchResult;
  createdAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const researchCache = new Map<string, CacheEntry>();

function buildCacheKey(adresse: string, art: string | null): string {
  const sig = `${adresse}|${art || ''}`.toLowerCase();
  let hash = 0;
  for (let i = 0; i < sig.length; i++) {
    hash = ((hash << 5) - hash + sig.charCodeAt(i)) | 0;
  }
  return `r:${hash}`;
}

function getCached(key: string): ResearchResult | null {
  const entry = researchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    researchCache.delete(key);
    return null;
  }
  return entry.result;
}

// ─── Trigger-Prüfung ───────────────────────────────────────────────────────

/**
 * Prüft ob eine KI-Recherche nötig ist.
 * Gibt die Trigger-Gründe zurück (leeres Array = keine Recherche nötig).
 */
export function checkResearchTriggers(
  brw: NormalizedBRW | null,
  marktdaten: ImmoScoutPrices | null,
  bundesland: string,
): ResearchTrigger[] {
  // Kein API-Key → keine Recherche möglich
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const triggers: ResearchTrigger[] = [];

  // 1. Kein BRW verfügbar (Fallback-Bundesländer oder keine Daten)
  if (!brw || brw.wert <= 0) {
    triggers.push({
      reason: `Kein Bodenrichtwert für ${bundesland} verfügbar`,
      priority: 'high',
    });
  }

  // 2. Keine IS24-Marktdaten
  if (!marktdaten) {
    triggers.push({
      reason: 'Keine ImmoScout24-Marktdaten gefunden',
      priority: 'high',
    });
  }

  // 3. Marktdaten nur auf Kreisebene (keine Stadtteil-Daten)
  if (marktdaten && !marktdaten.stadtteil && marktdaten.haus_kauf_preis == null && marktdaten.wohnung_kauf_preis == null) {
    triggers.push({
      reason: 'Marktdaten unvollständig (keine Kaufpreise)',
      priority: 'medium',
    });
  }

  return triggers;
}

// ─── Prompt-Bau ────────────────────────────────────────────────────────────

function buildResearchPrompt(
  adresse: string,
  bundesland: string,
  art: string | null,
  objektunterart: string | null,
  wohnflaeche: number | null,
  baujahr: number | null,
  triggers: ResearchTrigger[],
): string {
  const artBeschreibung = [art, objektunterart].filter(Boolean).join(', ') || 'Immobilie';
  const details = [
    wohnflaeche ? `Wohnfläche: ${wohnflaeche} m²` : null,
    baujahr ? `Baujahr: ${baujahr}` : null,
  ].filter(Boolean).join(', ');

  return `Du bist ein Immobilien-Marktanalyst. Recherchiere aktuelle Marktdaten für folgende Immobilie:

## Objekt
- Adresse: ${adresse}
- Bundesland: ${bundesland}
- Typ: ${artBeschreibung}
${details ? `- Details: ${details}` : ''}

## Warum Recherche nötig
${triggers.map(t => `- ${t.reason}`).join('\n')}

## Recherche-Aufgabe

Suche gezielt nach:

1. **Bodenrichtwert**: Suche "Bodenrichtwert [Ort] [Jahr]" oder "BRW [Ort]". Gutachterausschuss-Seiten, BORIS-Portale.
2. **Vergleichspreise**: Suche "Haus kaufen [Ort]" oder "[Objekttyp] [Ort] Kaufpreis". ImmoScout24, Immowelt, Homeday.
3. **Marktbericht**: Suche "Immobilienmarktbericht [Landkreis/Stadt] [Jahr]". Sparkassen, IVD, Gutachterausschuss.

## Antwortformat

Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Text drumherum):

{
  "recherchierter_brw": Zahl oder null,
  "vergleichspreis_qm": Zahl (€/m² Kaufpreis für vergleichbare Objekte) oder null,
  "vergleichsobjekte_anzahl": Zahl oder null,
  "mietpreis_qm": Zahl (€/m² Kaltmiete) oder null,
  "markt_einschaetzung": "kurzer Text zur Marktlage" oder null,
  "zusammenfassung": "2-3 Sätze was du gefunden hast",
  "quellen": ["URL1", "URL2", ...]
}

Wichtig:
- Nur verifizierte Zahlen aus den Suchergebnissen verwenden, NICHT schätzen
- Wenn du keine belastbaren Daten findest, setze die Felder auf null
- Preise in €/m² angeben
- Quellen als URLs auflisten`;
}

// ─── API-Aufruf mit Web Search ──────────────────────────────────────────────

async function callClaudeWithSearch(prompt: string): Promise<{
  text: string;
  citations: Array<{ url: string; title: string }>;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY nicht konfiguriert');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: RESEARCH_MODEL,
        max_tokens: 2048,
        temperature: 0.1,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: RESEARCH_MAX_SEARCHES,
          user_location: {
            type: 'approximate',
            country: 'DE',
            timezone: 'Europe/Berlin',
          },
        }],
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as {
      content: Array<{
        type: string;
        text?: string;
        citations?: Array<{ type: string; url: string; title: string }>;
      }>;
    };

    // Text und Citations extrahieren
    let fullText = '';
    const citations: Array<{ url: string; title: string }> = [];

    for (const block of data.content) {
      if (block.type === 'text' && block.text) {
        fullText += block.text;
        if (block.citations) {
          for (const c of block.citations) {
            if (c.url && !citations.some(existing => existing.url === c.url)) {
              citations.push({ url: c.url, title: c.title || '' });
            }
          }
        }
      }
    }

    return { text: fullText, citations };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Response-Parsing ──────────────────────────────────────────────────────

function parseResearchResponse(
  text: string,
  citations: Array<{ url: string; title: string }>,
  durationMs: number,
  triggers: ResearchTrigger[],
): ResearchResult {
  // JSON aus Antwort extrahieren
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      recherchierter_brw: null,
      vergleichspreis_qm: null,
      vergleichsobjekte_anzahl: null,
      mietpreis_qm: null,
      markt_einschaetzung: null,
      zusammenfassung: 'KI-Recherche konnte keine strukturierten Daten extrahieren.',
      quellen: citations.map(c => c.url),
      dauer_ms: durationMs,
      trigger: triggers.map(t => t.reason),
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Quellen: aus JSON + Citations zusammenführen
    const quellen = new Set<string>();
    if (Array.isArray(parsed.quellen)) {
      for (const q of parsed.quellen) {
        if (typeof q === 'string' && q.startsWith('http')) quellen.add(q);
      }
    }
    for (const c of citations) {
      if (c.url) quellen.add(c.url);
    }

    return {
      recherchierter_brw: typeof parsed.recherchierter_brw === 'number' ? parsed.recherchierter_brw : null,
      vergleichspreis_qm: typeof parsed.vergleichspreis_qm === 'number' ? parsed.vergleichspreis_qm : null,
      vergleichsobjekte_anzahl: typeof parsed.vergleichsobjekte_anzahl === 'number' ? parsed.vergleichsobjekte_anzahl : null,
      mietpreis_qm: typeof parsed.mietpreis_qm === 'number' ? parsed.mietpreis_qm : null,
      markt_einschaetzung: typeof parsed.markt_einschaetzung === 'string' ? parsed.markt_einschaetzung : null,
      zusammenfassung: typeof parsed.zusammenfassung === 'string' ? parsed.zusammenfassung : 'Recherche abgeschlossen.',
      quellen: [...quellen],
      dauer_ms: durationMs,
      trigger: triggers.map(t => t.reason),
    };
  } catch {
    return {
      recherchierter_brw: null,
      vergleichspreis_qm: null,
      vergleichsobjekte_anzahl: null,
      mietpreis_qm: null,
      markt_einschaetzung: null,
      zusammenfassung: 'KI-Recherche JSON-Parsing fehlgeschlagen.',
      quellen: citations.map(c => c.url),
      dauer_ms: durationMs,
      trigger: triggers.map(t => t.reason),
    };
  }
}

// ─── Hauptfunktion ─────────────────────────────────────────────────────────

/**
 * Führt eine KI-gestützte Marktrecherche durch.
 *
 * - Gecacht: 24h TTL
 * - Timeout: 20s (konfigurierbar via RESEARCH_TIMEOUT_MS)
 * - Graceful: Bei Fehler wird ein leeres Ergebnis zurückgegeben
 */
export async function performResearch(
  adresse: string,
  bundesland: string,
  art: string | null,
  objektunterart: string | null,
  wohnflaeche: number | null,
  baujahr: number | null,
  triggers: ResearchTrigger[],
): Promise<ResearchResult> {
  // Cache prüfen
  const cacheKey = buildCacheKey(adresse, art);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('KI-Recherche: Cache-Hit');
    return { ...cached, dauer_ms: 0 };
  }

  const startTime = Date.now();

  try {
    const prompt = buildResearchPrompt(adresse, bundesland, art, objektunterart, wohnflaeche, baujahr, triggers);
    const { text, citations } = await callClaudeWithSearch(prompt);
    const durationMs = Date.now() - startTime;

    const result = parseResearchResponse(text, citations, durationMs, triggers);

    // Cache schreiben (nur wenn sinnvolle Daten)
    if (result.recherchierter_brw || result.vergleichspreis_qm || result.mietpreis_qm) {
      researchCache.set(cacheKey, { result, createdAt: Date.now() });
    }

    console.log(
      `KI-Recherche abgeschlossen (${durationMs}ms): BRW=${result.recherchierter_brw}, qm=${result.vergleichspreis_qm}, Quellen=${result.quellen.length}`,
    );

    return result;
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err?.name === 'AbortError';

    console.warn(
      `KI-Recherche fehlgeschlagen (${durationMs}ms):`,
      isTimeout ? 'Timeout' : err?.message || err,
    );

    return {
      recherchierter_brw: null,
      vergleichspreis_qm: null,
      vergleichsobjekte_anzahl: null,
      mietpreis_qm: null,
      markt_einschaetzung: null,
      zusammenfassung: isTimeout
        ? `Recherche-Timeout nach ${RESEARCH_TIMEOUT_MS}ms`
        : `Recherche-Fehler: ${err?.message || 'unbekannt'}`,
      quellen: [],
      dauer_ms: durationMs,
      trigger: triggers.map(t => t.reason),
    };
  }
}

// ─── Cache-Management ──────────────────────────────────────────────────────

export function clearResearchCache(): number {
  const size = researchCache.size;
  researchCache.clear();
  return size;
}

export function researchCacheStats(): { size: number; ttl_hours: number } {
  return { size: researchCache.size, ttl_hours: CACHE_TTL_MS / (60 * 60 * 1000) };
}
