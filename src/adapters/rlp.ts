import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Rheinland-Pfalz Adapter
 *
 * Nutzt den OGC API Features Endpunkt des Geoportals RLP (ldproxy).
 * Collections sind jahrgangsbasiert: BORIS_2024, BORIS_2022, etc.
 * Unterstützt bbox-Filter direkt in WGS84 (EPSG:4326).
 *
 * Endpunkt-Doku: https://geoportal.rlp.de/spatial-objects/548
 */
export class RheinlandPfalzAdapter implements BodenrichtwertAdapter {
  state = 'Rheinland-Pfalz';
  stateCode = 'RP';
  isFallback = false;

  private serviceUrl = 'https://www.geoportal.rlp.de/spatial-objects/548/collections';

  // Aktuellste Collections zuerst – Fallback auf ältere Jahrgänge
  private collections = ['BORIS_2024', 'BORIS_2022', 'BORIS_2020'];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    // bbox-Filter: kleines Rechteck um den Punkt (~50m)
    const delta = 0.0005;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

    for (const collection of this.collections) {
      try {
        const url = `${this.serviceUrl}/${collection}/items?bbox=${bbox}&f=json&limit=5`;

        const res = await fetch(url, {
          headers: {
            'Accept': 'application/geo+json',
            'User-Agent': 'BRW-API/1.0 (lebenswert.de)',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) {
          console.warn(`RLP ${collection}: HTTP ${res.status} – versuche nächsten Jahrgang`);
          continue;
        }

        const json = await res.json() as any;

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
          quelle: `BORIS-RLP (${collection.replace('_', ' ')})`,
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
      const url = `${this.serviceUrl}/${this.collections[0]}/items?limit=1&f=json`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
