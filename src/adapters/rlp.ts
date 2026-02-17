import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Rheinland-Pfalz Adapter
 * 
 * Nutzt den OGC API Features Endpunkt des Geoportals RLP.
 * Unterstützt bbox-Filter direkt in WGS84 (EPSG:4326).
 */
export class RheinlandPfalzAdapter implements BodenrichtwertAdapter {
  state = 'Rheinland-Pfalz';
  stateCode = 'RP';
  isFallback = false;

  // OGC API Features Endpunkt
  private baseUrl =
    'https://www.geoportal.rlp.de/spatial-objects/548/collections/bodenrichtwerte/items';

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    try {
      // bbox-Filter: kleines Rechteck um den Punkt (~50m)
      const delta = 0.0005;
      const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

      const url = `${this.baseUrl}?bbox=${bbox}&f=json&limit=5`;

      const res = await fetch(url, {
        headers: {
          'Accept': 'application/geo+json',
          'User-Agent': 'BRW-API/1.0 (lebenswert.de)',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        console.error(`RLP WFS error: ${res.status} ${res.statusText}`);
        return null;
      }

      const json = await res.json() as any;

      if (!json.features?.length) {
        return null;
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
        quelle: 'BORIS-RLP',
        lizenz: '© LVermGeo RLP',
      };
    } catch (err) {
      console.error('RLP adapter error:', err);
      return null;
    }
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
