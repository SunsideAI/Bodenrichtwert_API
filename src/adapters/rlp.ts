import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Rheinland-Pfalz Adapter
 *
 * Nutzt den OGC API Features Endpunkt des Geoportals RLP (ldproxy).
 * Collections sind jahrgangsbasiert (z.B. BORIS 2024).
 * Beim ersten Aufruf wird die Collection-Liste dynamisch geladen,
 * um den exakten Collection-ID-String zu ermitteln.
 *
 * Endpunkt-Doku: https://geoportal.rlp.de/spatial-objects/548
 */
export class RheinlandPfalzAdapter implements BodenrichtwertAdapter {
  state = 'Rheinland-Pfalz';
  stateCode = 'RP';
  isFallback = false;

  private serviceUrl = 'https://www.geoportal.rlp.de/spatial-objects/548';

  /** Gecachte, sortierte Collection-IDs (neueste zuerst) */
  private resolvedCollections: string[] | null = null;

  /**
   * Collection-IDs dynamisch vom API-Endpoint laden.
   * Cached das Ergebnis für folgende Aufrufe.
   */
  private async getCollections(): Promise<string[]> {
    if (this.resolvedCollections) return this.resolvedCollections;

    try {
      const res = await fetch(`${this.serviceUrl}/collections?f=json`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const json = await res.json() as any;
        const cols: string[] = (json.collections || [])
          .map((c: any) => c.id as string)
          .filter((id: string) => /boris/i.test(id))
          .sort((a: string, b: string) => {
            const yearA = parseInt(a.replace(/\D/g, ''), 10) || 0;
            const yearB = parseInt(b.replace(/\D/g, ''), 10) || 0;
            return yearB - yearA; // neueste zuerst
          });

        if (cols.length > 0) {
          console.log(`RLP: ${cols.length} BORIS-Collections gefunden: ${cols.join(', ')}`);
          this.resolvedCollections = cols;
          return cols;
        }
      }
    } catch (err) {
      console.warn('RLP: Collections-Endpoint nicht erreichbar, verwende Fallback-IDs:', err);
    }

    // Fallback: Alle plausiblen ID-Formate für 2024/2022 durchprobieren
    const fallback = [
      'BORIS 2024', 'BORIS_2024', 'BORIS2024', 'boris_2024', 'boris2024',
      'BORIS 2022', 'BORIS_2022', 'BORIS2022', 'boris_2022', 'boris2022',
    ];
    this.resolvedCollections = fallback;
    return fallback;
  }

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    const collections = await this.getCollections();

    // bbox-Filter: kleines Rechteck um den Punkt (~100m)
    const delta = 0.001;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

    for (const collection of collections) {
      try {
        const encoded = encodeURIComponent(collection);
        const url = `${this.serviceUrl}/collections/${encoded}/items?bbox=${bbox}&f=json&limit=5`;

        console.log(`RLP: Frage ${collection} ab → ${url}`);

        const res = await fetch(url, {
          headers: {
            'Accept': 'application/geo+json',
            'User-Agent': 'BRW-API/1.0 (lebenswert.de)',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) {
          console.warn(`RLP ${collection}: HTTP ${res.status}`);
          continue;
        }

        const json = await res.json() as any;
        console.log(`RLP ${collection}: ${json.features?.length || 0} Features gefunden`);

        if (!json.features?.length) {
          continue;
        }

        // Wohnbau-BRW bevorzugen, sonst den ersten Treffer
        const wohn = json.features.find(
          (f: any) => {
            const nutzung = f.properties?.nutzungsart || f.properties?.art || '';
            return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
          }
        ) || json.features[0];

        const p = wohn.properties;

        return {
          wert: p.bodenrichtwert || p.brw || p.wert || 0,
          stichtag: p.stichtag || p.erhe_dat || 'unbekannt',
          nutzungsart: p.nutzungsart || p.art || 'unbekannt',
          entwicklungszustand: p.entwicklungszustand || p.entw || 'B',
          zone: p.zone || p.lage || p.brw_zone || '',
          gemeinde: p.gemeinde || p.ort || '',
          bundesland: 'Rheinland-Pfalz',
          quelle: `BORIS-RLP (${collection})`,
          lizenz: '© LVermGeo RLP',
        };
      } catch (err) {
        console.warn(`RLP ${collection} error:`, err);
        continue;
      }
    }

    console.error('RLP adapter: Kein Treffer in allen Collections');
    return null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.serviceUrl}/collections?f=json`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
