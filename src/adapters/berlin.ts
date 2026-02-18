import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Berlin Adapter
 *
 * Nutzt den FIS-Broker WFS 2.0 Endpunkt.
 * Daten: Bodenrichtwerte zum 01.01.2024
 * CRS: EPSG:25833 (UTM Zone 33N)
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export class BerlinAdapter implements BodenrichtwertAdapter {
  state = 'Berlin';
  stateCode = 'BE';
  isFallback = false;

  private wfsUrl = 'https://fbinter.stadt-berlin.de/fb/wfs/data/senstadt/s_brw_2024';

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    try {
      const delta = 0.0005;
      const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;

      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: 'fis:s_brw_2024',
        bbox: bbox,
        outputFormat: 'application/json',
        count: '5',
      });

      const url = `${this.wfsUrl}?${params}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        console.error(`BE WFS error: ${res.status}`);
        return null;
      }

      const json = await res.json() as any;

      if (!json.features?.length) return null;

      // Wohnbau-BRW bevorzugen
      const wohn = json.features.find(
        (f: any) => {
          const nutzung = f.properties?.nutzungsart || f.properties?.NUTZUNG || '';
          return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
        }
      ) || json.features[0];

      const p = wohn.properties;

      return {
        wert: p.BRW || p.brw || p.bodenrichtwert || p.BODENRICHTWERT || 0,
        stichtag: p.STICHTAG || p.stichtag || '2024-01-01',
        nutzungsart: p.NUTZUNG || p.nutzungsart || 'unbekannt',
        entwicklungszustand: p.ENTW || p.entwicklungszustand || 'B',
        zone: p.BRW_ZONE || p.brw_zone || p.ZONE || '',
        gemeinde: p.BEZIRK || p.bezirk || 'Berlin',
        bundesland: 'Berlin',
        quelle: 'BORIS-Berlin (FIS-Broker)',
        lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
      };
    } catch (err) {
      console.error('BE adapter error:', err);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetCapabilities',
      });
      const res = await fetch(`${this.wfsUrl}?${params}`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
