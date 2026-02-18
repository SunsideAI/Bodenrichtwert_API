import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Brandenburg Adapter
 *
 * Nutzt die OGC API Features von geobasis-bb.de.
 * Collection: br_bodenrichtwert (BRM 3.0.1 Datenmodell)
 * Felder sind teilweise verschachtelt (nutzung.art, gemeinde.bezeichnung).
 */
export class BrandenburgAdapter implements BodenrichtwertAdapter {
  state = 'Brandenburg';
  stateCode = 'BB';
  isFallback = false;

  private baseUrl = 'https://ogc-api.geobasis-bb.de/boris/collections/br_bodenrichtwert/items';

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    try {
      const delta = 0.0005;
      const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

      // Request more results so we can filter for most recent year
      const url = `${this.baseUrl}?bbox=${bbox}&f=json&limit=20`;

      const res = await fetch(url, {
        headers: {
          'Accept': 'application/geo+json',
          'User-Agent': 'BRW-API/1.0 (lebenswert.de)',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        console.error(`BB OGC API error: ${res.status}`);
        return null;
      }

      const json = await res.json() as any;

      if (!json.features?.length) return null;

      // Sort by stichtag descending to prefer the most recent data
      const sorted = [...json.features].sort((a: any, b: any) => {
        const da = new Date(a.properties?.stichtag || '2000-01-01').getTime();
        const db = new Date(b.properties?.stichtag || '2000-01-01').getTime();
        return db - da;
      });

      // Only keep entries from the last 5 years if possible
      const currentYear = new Date().getFullYear();
      const recent = sorted.filter((f: any) => {
        const stichtag = f.properties?.stichtag || '';
        const year = parseInt(stichtag.substring(0, 4)) || 0;
        return year >= currentYear - 5;
      });

      const candidates = recent.length > 0 ? recent : sorted;

      // Prefer Wohnbau
      const wohn = candidates.find((f: any) => {
        const art = f.properties?.nutzung?.art || f.properties?.nutzungsart || '';
        return art.includes('Wohn') || art.includes('(W)') || art.includes('(WA)') || art.includes('(WR)') || art.startsWith('W');
      }) || candidates[0];

      const p = wohn.properties;

      // BRM 3.0.1 may use different field names – try known variants in priority order
      const wertCandidates = [
        p.bodenrichtwert,
        p.brw,
        p.BRW,
        p.richtwert,
        p.wert,
        p.betrag,
      ];
      let wert = 0;
      for (const c of wertCandidates) {
        const v = parseFloat(String(c ?? ''));
        if (v > 0 && v <= 500000 && isFinite(v)) {
          wert = v;
          break;
        }
      }

      if (!wert) {
        console.error('BB: Kein valider Wert gefunden. Properties:', JSON.stringify(p).slice(0, 500));
        return null;
      }

      // BRM 3.0.1: entwicklungszustand can be "Baureifes Land (B)" – extract code
      const entwRaw = p.entwicklungszustand || 'B';
      const entwMatch = entwRaw.match(/\(([A-Z]+)\)/);
      const entwicklungszustand = entwMatch ? entwMatch[1] : entwRaw;

      // Nutzungsart aus verschachteltem Feld oder flachem String
      const nutzungsart = p.nutzung?.art || p.nutzungsart || 'unbekannt';

      // Gemeinde can be an object, array of objects, or plain string
      const gemeinde = this.extractGemeinde(p.gemeinde);

      return {
        wert,
        stichtag: p.stichtag || 'unbekannt',
        nutzungsart,
        entwicklungszustand,
        zone: p.bodenrichtwertzoneName || p.zone || '',
        gemeinde,
        bundesland: 'Brandenburg',
        quelle: 'BORIS-BB',
        lizenz: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
      };
    } catch (err) {
      console.error('BB adapter error:', err);
      return null;
    }
  }

  private extractGemeinde(raw: any): string {
    if (!raw) return '';
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      return raw.map((g: any) => {
        if (typeof g === 'string') return g;
        return g.bezeichnung || g.name || g.gemeindename || '';
      }).filter(Boolean).join(', ');
    }
    if (typeof raw === 'object') {
      return raw.bezeichnung || raw.name || raw.gemeindename || '';
    }
    return String(raw);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}?limit=1&f=json`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
