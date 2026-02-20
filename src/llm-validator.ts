/**
 * LLM-basierte Validierungsschicht für Immobilienbewertungen.
 *
 * Prüft jedes Bewertungsergebnis mittels Claude auf Plausibilität.
 * Läuft asynchron und blockiert nie die Haupt-Response –
 * bei Timeout oder Fehler wird das Ergebnis ohne Validierung zurückgegeben.
 */

import type { Bewertung, BewertungInput } from './bewertung.js';
import type { NormalizedBRW } from './adapters/base.js';

// ─── Konfiguration ──────────────────────────────────────────────────────────

const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10);
const LLM_MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-5-20250929';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  status: 'plausibel' | 'auffaellig' | 'unplausibel' | 'fehler' | 'deaktiviert';
  confidence: number;           // 0.0 – 1.0, wie sicher sich das LLM ist
  bewertung_angemessen: boolean;
  abweichung_einschaetzung: string | null; // z.B. "Wert ~15% zu hoch für Lage"
  empfohlener_wert: number | null;         // LLM-Schätzwert (wenn abweichend)
  hinweise: string[];
  modell: string;
  dauer_ms: number;
}

// ─── Validierungs-Cache (Speicher, 24h TTL) ─────────────────────────────────

interface CacheEntry {
  result: ValidationResult;
  createdAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const validationCache = new Map<string, CacheEntry>();

function buildCacheKey(input: BewertungInput, bewertung: Bewertung): string {
  const sig = [
    input.art,
    input.baujahr,
    input.wohnflaeche,
    input.grundstuecksflaeche,
    input.objektunterart,
    input.modernisierung,
    bewertung.realistischer_immobilienwert,
    bewertung.bodenwert,
  ].join('|');
  // Simple hash
  let hash = 0;
  for (let i = 0; i < sig.length; i++) {
    hash = ((hash << 5) - hash + sig.charCodeAt(i)) | 0;
  }
  return `v:${hash}`;
}

function getCached(key: string): ValidationResult | null {
  const entry = validationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    validationCache.delete(key);
    return null;
  }
  return entry.result;
}

// ─── Prompt-Bau ─────────────────────────────────────────────────────────────

function buildPrompt(
  input: BewertungInput,
  bewertung: Bewertung,
  brw: NormalizedBRW | null,
  adresse: string,
  bundesland: string,
): string {
  return `Du bist ein erfahrener Immobilien-Sachverständiger (§ 198 BewG, ImmoWertV 2022).
Prüfe die folgende automatische Immobilienbewertung auf Plausibilität.

## Eingabedaten
- Adresse: ${adresse}
- Bundesland: ${bundesland}
- Immobilienart: ${input.art || 'nicht angegeben'}
- Objektunterart: ${input.objektunterart || 'nicht angegeben'}
- Baujahr: ${input.baujahr || 'nicht angegeben'}
- Wohnfläche: ${input.wohnflaeche ? input.wohnflaeche + ' m²' : 'nicht angegeben'}
- Grundstücksfläche: ${input.grundstuecksflaeche ? input.grundstuecksflaeche + ' m²' : 'nicht angegeben'}
- Modernisierung: ${input.modernisierung || 'nicht angegeben'}
- Energieeffizienz: ${input.energie || 'nicht angegeben'}
- Ausstattung: ${input.ausstattung || 'nicht angegeben'}

## Bodenrichtwert
- BRW: ${brw ? brw.wert + ' €/m²' : 'nicht verfügbar'}${brw?.stichtag ? ` (Stichtag: ${brw.stichtag})` : ''}${brw?.schaetzung ? ' (geschätzt)' : ' (offiziell)'}

## Bewertungsergebnis (automatisch berechnet)
- Methode: ${bewertung.bewertungsmethode}
- Konfidenz: ${bewertung.konfidenz}
- Realistischer Immobilienwert: ${bewertung.realistischer_immobilienwert.toLocaleString('de-DE')} €
- Wertspanne: ${bewertung.immobilienwert_spanne.min.toLocaleString('de-DE')} – ${bewertung.immobilienwert_spanne.max.toLocaleString('de-DE')} €
- qm-Preis: ${bewertung.realistischer_qm_preis.toLocaleString('de-DE')} €/m²
- Bodenwert: ${bewertung.bodenwert.toLocaleString('de-DE')} €
- Gebäudewert: ${bewertung.gebaeudewert.toLocaleString('de-DE')} €
- Ertragswert: ${bewertung.ertragswert ? bewertung.ertragswert.toLocaleString('de-DE') + ' €' : 'nicht berechnet'}
- Datenquellen: ${bewertung.datenquellen.join(', ')}

## Korrekturfaktoren
- Baujahr: ${(bewertung.faktoren.baujahr * 100).toFixed(1)}%
- Modernisierung: ${(bewertung.faktoren.modernisierung * 100).toFixed(1)}%
- Energie: ${(bewertung.faktoren.energie * 100).toFixed(1)}%
- Ausstattung: ${(bewertung.faktoren.ausstattung * 100).toFixed(1)}%
- Gesamt: ${(bewertung.faktoren.gesamt * 100).toFixed(1)}%

## Bestehende Hinweise
${bewertung.hinweise.length > 0 ? bewertung.hinweise.map(h => '- ' + h).join('\n') : '(keine)'}

## Aufgabe
Bewerte die Plausibilität. Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Text drumherum):

{
  "status": "plausibel" | "auffaellig" | "unplausibel",
  "confidence": 0.0-1.0,
  "bewertung_angemessen": true/false,
  "abweichung_einschaetzung": "kurze Begründung wenn auffällig/unplausibel, sonst null",
  "empfohlener_wert": Zahl oder null,
  "hinweise": ["max 3 kurze Hinweise zur Bewertungsqualität"]
}

Kriterien:
- "plausibel": Wert liegt im erwartbaren Bereich für Lage, Alter und Zustand
- "auffaellig": Wert weicht leicht ab (10-25%), könnte aber noch stimmen
- "unplausibel": Wert weicht stark ab (>25%) oder widerspricht Marktkenntnis
- confidence: Wie sicher bist du dir bei deiner Einschätzung?
- empfohlener_wert: Nur setzen wenn du einen deutlich besseren Schätzwert hast`;
}

// ─── API-Aufruf ─────────────────────────────────────────────────────────────

async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY nicht konfiguriert');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 512,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const textBlock = data.content.find((c) => c.type === 'text');
    if (!textBlock) throw new Error('Keine Text-Antwort vom LLM');
    return textBlock.text;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Response-Parsing ───────────────────────────────────────────────────────

function parseResponse(raw: string, durationMs: number): ValidationResult {
  // JSON aus der Antwort extrahieren (auch wenn Markdown drumherum)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      status: 'fehler',
      confidence: 0,
      bewertung_angemessen: true,
      abweichung_einschaetzung: 'LLM-Antwort konnte nicht geparst werden',
      empfohlener_wert: null,
      hinweise: [raw.slice(0, 200)],
      modell: LLM_MODEL,
      dauer_ms: durationMs,
    };
  }

  const parsed = JSON.parse(jsonMatch[0]);

  const validStatuses = ['plausibel', 'auffaellig', 'unplausibel'];
  const status = validStatuses.includes(parsed.status) ? parsed.status : 'auffaellig';

  return {
    status,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
    bewertung_angemessen: parsed.bewertung_angemessen !== false,
    abweichung_einschaetzung: parsed.abweichung_einschaetzung || null,
    empfohlener_wert: typeof parsed.empfohlener_wert === 'number' ? parsed.empfohlener_wert : null,
    hinweise: Array.isArray(parsed.hinweise) ? parsed.hinweise.slice(0, 3) : [],
    modell: LLM_MODEL,
    dauer_ms: durationMs,
  };
}

// ─── Hauptfunktion ──────────────────────────────────────────────────────────

/**
 * Validiert ein Bewertungsergebnis mittels LLM (Claude).
 *
 * - Nicht-blockierend: Bei Fehler/Timeout wird graceful ein "fehler"-Status zurückgegeben
 * - Gecacht: Gleiche Input+Ergebnis-Kombination wird 24h zwischengespeichert
 * - Deaktivierbar: Ohne ANTHROPIC_API_KEY wird sofort "deaktiviert" zurückgegeben
 */
export async function validateBewertung(
  input: BewertungInput,
  bewertung: Bewertung,
  brw: NormalizedBRW | null,
  adresse: string,
  bundesland: string,
): Promise<ValidationResult> {
  // Deaktiviert wenn kein API-Key
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      status: 'deaktiviert',
      confidence: 0,
      bewertung_angemessen: true,
      abweichung_einschaetzung: null,
      empfohlener_wert: null,
      hinweise: ['LLM-Validierung deaktiviert (kein ANTHROPIC_API_KEY)'],
      modell: 'none',
      dauer_ms: 0,
    };
  }

  // Cache prüfen
  const cacheKey = buildCacheKey(input, bewertung);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('LLM-Validierung: Cache-Hit');
    return { ...cached, dauer_ms: 0 };
  }

  const startTime = Date.now();

  try {
    const prompt = buildPrompt(input, bewertung, brw, adresse, bundesland);
    const raw = await callClaude(prompt);
    const durationMs = Date.now() - startTime;

    const result = parseResponse(raw, durationMs);

    // Cache schreiben
    validationCache.set(cacheKey, { result, createdAt: Date.now() });

    console.log(
      `LLM-Validierung: ${result.status} (confidence: ${result.confidence}, ${durationMs}ms)`,
    );

    return result;
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err?.name === 'AbortError';

    console.warn(
      `LLM-Validierung fehlgeschlagen (${durationMs}ms):`,
      isTimeout ? 'Timeout' : err?.message || err,
    );

    return {
      status: 'fehler',
      confidence: 0,
      bewertung_angemessen: true, // Im Zweifel Bewertung durchlassen
      abweichung_einschaetzung: isTimeout
        ? `Timeout nach ${LLM_TIMEOUT_MS}ms`
        : `Fehler: ${err?.message || 'unbekannt'}`,
      empfohlener_wert: null,
      hinweise: [],
      modell: LLM_MODEL,
      dauer_ms: durationMs,
    };
  }
}

// ─── Auto-Korrektur ─────────────────────────────────────────────────────────

/**
 * Wendet die LLM-Validierung als Korrektur auf die Bewertung an.
 *
 * Korrektur-Logik (graduiert, nicht blind übernehmen):
 *   - plausibel / fehler / deaktiviert → keine Änderung
 *   - auffaellig (10-25%) + confidence ≥ 0.7 + empfohlener_wert → 30% Blend
 *   - unplausibel (>25%) + confidence ≥ 0.75 + empfohlener_wert → 50% Blend
 *
 * Gibt eine korrigierte Kopie zurück (Original bleibt unverändert).
 */
export function applyLLMCorrection(
  bewertung: Bewertung,
  validation: ValidationResult,
): Bewertung {
  // Kein empfohlener Wert → nichts zu korrigieren
  if (validation.empfohlener_wert == null || validation.empfohlener_wert <= 0) {
    return bewertung;
  }

  // Nur bei auffällig/unplausibel korrigieren
  if (validation.status !== 'auffaellig' && validation.status !== 'unplausibel') {
    return bewertung;
  }

  // Confidence-Schwelle prüfen
  const minConfidence = validation.status === 'unplausibel' ? 0.75 : 0.70;
  if (validation.confidence < minConfidence) {
    return bewertung;
  }

  // Blend-Stärke: wie stark ziehen wir zum LLM-Wert?
  const blendWeight = validation.status === 'unplausibel' ? 0.50 : 0.30;

  const originalWert = bewertung.realistischer_immobilienwert;
  const llmWert = validation.empfohlener_wert;

  // Sanity-Check: LLM-Wert muss zwischen 20% und 500% des Originals liegen
  const ratio = llmWert / originalWert;
  if (ratio < 0.20 || ratio > 5.0) {
    return bewertung;
  }

  // Graduierter Blend
  const korrigierterWert = Math.round(
    originalWert * (1 - blendWeight) + llmWert * blendWeight,
  );
  const wohnflaeche = bewertung.realistischer_qm_preis > 0
    ? bewertung.realistischer_immobilienwert / bewertung.realistischer_qm_preis
    : 1;
  const korrigierterQmPreis = Math.round(korrigierterWert / wohnflaeche);

  // Spanne neu berechnen (gleichen Spread beibehalten)
  const originalSpread = bewertung.immobilienwert_spanne.max > 0
    ? (bewertung.immobilienwert_spanne.max - bewertung.realistischer_immobilienwert)
      / bewertung.realistischer_immobilienwert
    : 0.15;

  const abweichungPct = Math.round(((korrigierterWert - originalWert) / originalWert) * 100);
  const richtung = abweichungPct > 0 ? 'angehoben' : 'reduziert';

  return {
    ...bewertung,
    realistischer_immobilienwert: korrigierterWert,
    realistischer_qm_preis: korrigierterQmPreis,
    immobilienwert_spanne: {
      min: Math.round(korrigierterWert * (1 - originalSpread)),
      max: Math.round(korrigierterWert * (1 + originalSpread)),
    },
    qm_preis_spanne: {
      min: Math.round(korrigierterQmPreis * (1 - originalSpread)),
      max: Math.round(korrigierterQmPreis * (1 + originalSpread)),
    },
    hinweise: [
      ...bewertung.hinweise,
      `KI-Korrektur (${validation.status}): Wert um ${Math.abs(abweichungPct)}% ${richtung} `
      + `(${originalWert.toLocaleString('de-DE')} → ${korrigierterWert.toLocaleString('de-DE')} €, `
      + `Blend ${Math.round(blendWeight * 100)}% LLM-Empfehlung, Confidence ${(validation.confidence * 100).toFixed(0)}%).`,
    ],
    datenquellen: [
      ...bewertung.datenquellen,
      `KI-Validierung (${validation.modell})`,
    ],
  };
}

// ─── Cache-Management ───────────────────────────────────────────────────────

export function clearValidationCache(): number {
  const size = validationCache.size;
  validationCache.clear();
  return size;
}

export function validationCacheStats(): { size: number; ttl_hours: number } {
  return { size: validationCache.size, ttl_hours: CACHE_TTL_MS / (60 * 60 * 1000) };
}
