import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
import { scrapeImmoScoutAtlas, slugify } from '../utils/immoscout-scraper.js';

const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';

/**
 * ImmoScout Atlas Adapter
 *
 * Schätzt Bodenrichtwerte basierend auf ImmoScout24 Atlas-Marktpreisen.
 * KEIN offizieller BRW – nur eine Indikation basierend auf Immobilienpreisen.
 *
 * Ablauf:
 * 1. Reverse-Geocode lat/lon → Stadt + Bundesland
 * 2. ImmoScout Atlas URL bauen + fetchen
 * 3. _atlas_initialState JSON parsen → haus_kauf_preis
 * 4. Preisabhängigen Faktor anwenden → BRW-Schätzwert
 *
 * Die Umrechnung nutzt preisabhängige Faktoren:
 * - Teure Lagen (>6000 €/m²): ~55% Bodenanteil
 * - Günstige Lagen (<1500 €/m²): ~22% Bodenanteil
 */
export class ImmoScoutAdapter implements BodenrichtwertAdapter {
  state: string;
  stateCode: string;
  isFallback = false;

  private bundeslandSlug: string;

  constructor(state: 'Bayern' | 'Baden-Württemberg') {
    this.state = state;
    this.stateCode = state === 'Bayern' ? 'BY' : 'BW';
    this.bundeslandSlug = slugify(state);
  }

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    // 1. Reverse-Geocode: lat/lon → Stadt
    const location = await this.reverseGeocode(lat, lon);
    if (!location) {
      console.warn(`${this.stateCode} ImmoScout: Reverse-Geocode failed for ${lat},${lon}`);
      return null;
    }

    console.log(`${this.stateCode} ImmoScout: Reverse-Geocode → ${location.stadt} (${location.bundeslandSlug}/${location.stadtSlug})`);

    // 2. ImmoScout Atlas scrapen
    const prices = await scrapeImmoScoutAtlas(
      location.bundeslandSlug,
      location.stadtSlug,
    );

    if (!prices) {
      console.warn(`${this.stateCode} ImmoScout: Keine Preisdaten für ${location.stadt}`);
      return null;
    }

    // 3. Basispreis bestimmen (haus_kauf bevorzugt, wohnung_kauf als Fallback)
    const basisPreis = prices.haus_kauf_preis
      ?? (prices.wohnung_kauf_preis ? Math.round(prices.wohnung_kauf_preis * 0.9) : null);

    if (!basisPreis || basisPreis <= 0) {
      console.warn(`${this.stateCode} ImmoScout: Kein Hauspreis für ${location.stadt}`);
      return null;
    }

    // 4. BRW schätzen
    const { wert, factor } = this.estimateBRW(basisPreis);
    const datenstand = `${prices.jahr}-Q${prices.quartal}`;

    console.log(`${this.stateCode} ImmoScout: ${location.stadt} → Hauspreis ${basisPreis} €/m² × ${factor} = ${wert} €/m² (geschätzt)`);

    return {
      wert,
      stichtag: `${prices.jahr}-01-01`,
      nutzungsart: 'Wohnbaufläche (geschätzt)',
      entwicklungszustand: 'B',
      zone: prices.stadtteil || prices.stadt || location.stadt,
      gemeinde: prices.stadt || location.stadt,
      bundesland: this.state,
      quelle: 'ImmoScout24 Atlas (Schätzwert)',
      lizenz: 'Schätzung basierend auf Marktdaten. Kein offizieller Bodenrichtwert.',
      schaetzung: {
        methode: 'ImmoScout Atlas Marktpreise × preisabhängiger Faktor',
        basis_preis: basisPreis,
        faktor: factor,
        datenstand,
        hinweis: 'Schätzwert basierend auf Immobilienmarktdaten. Kein offizieller Bodenrichtwert. Abweichungen von ±30-50% zum tatsächlichen BRW sind möglich.',
      },
    };
  }

  /**
   * Reverse-Geocode via Nominatim: lat/lon → Stadt + Slugs
   */
  private async reverseGeocode(lat: number, lon: number): Promise<{
    stadt: string;
    stadtSlug: string;
    bundeslandSlug: string;
  } | null> {
    try {
      const url = `${NOMINATIM_URL}/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'BRW-API/1.0 (lebenswert.de)',
          'Accept-Language': 'de',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return null;

      const data = await res.json() as any;
      const address = data.address || {};

      // Stadt: city > town > municipality > county
      const stadt = address.city || address.town || address.municipality || address.county || '';
      if (!stadt) return null;

      // Bundesland-Slug: aus dem Adapter-State ableiten (nicht aus Nominatim)
      return {
        stadt,
        stadtSlug: slugify(stadt),
        bundeslandSlug: this.bundeslandSlug,
      };
    } catch (err) {
      console.error(`${this.stateCode} ImmoScout: Reverse-Geocode error:`, err);
      return null;
    }
  }

  /**
   * Schätzt den Bodenrichtwert basierend auf dem Hauspreis.
   * Höhere Immobilienpreise → höherer Bodenanteil.
   */
  private estimateBRW(hausKaufPreis: number): { wert: number; factor: number } {
    if (hausKaufPreis >= 6000) {
      // Premium urban (München Zentrum, Stuttgart Zentrum)
      return { wert: Math.round(hausKaufPreis * 0.55), factor: 0.55 };
    } else if (hausKaufPreis >= 4000) {
      // Urban (Augsburg, Freiburg, Heidelberg)
      return { wert: Math.round(hausKaufPreis * 0.45), factor: 0.45 };
    } else if (hausKaufPreis >= 2500) {
      // Suburban (Ulm, Regensburg, Karlsruhe Rand)
      return { wert: Math.round(hausKaufPreis * 0.38), factor: 0.38 };
    } else if (hausKaufPreis >= 1500) {
      // Kleinstadt
      return { wert: Math.round(hausKaufPreis * 0.30), factor: 0.30 };
    } else {
      // Ländlich
      return { wert: Math.round(hausKaufPreis * 0.22), factor: 0.22 };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Prüfe ob ImmoScout Atlas erreichbar ist
      const res = await fetch(`${ATLAS_BASE}/orte/deutschland/${this.bundeslandSlug}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      return res.ok || res.status === 403; // 403 = erreichbar aber blockiert
    } catch {
      return false;
    }
  }
}

const ATLAS_BASE = 'https://atlas.immobilienscout24.de';
