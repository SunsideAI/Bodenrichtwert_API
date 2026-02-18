import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Mecklenburg-Vorpommern Adapter
 *
 * Nutzt den geodaten-mv.de WFS 2.0 Endpunkt.
 * Daten: Bodenrichtwerte nach BORIS.MV2.1 Datenmodell
 * CRS: EPSG:25833 (UTM Zone 33N)
 * Lizenz: GutALVO M-V (frei zugänglich)
 */
export class MecklenburgVorpommernAdapter implements BodenrichtwertAdapter {
  state = 'Mecklenburg-Vorpommern';
  stateCode = 'MV';
  isFallback = false;

  private wfsUrl = 'https://www.geodaten-mv.de/dienste/bodenrichtwerte_wfs';

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    try {
      const delta = 0.0005;
      const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;

      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: 'boris:bodenrichtwert',
        bbox: bbox,
        outputFormat: 'application/json',
        count: '5',
      });

      const url = `${this.wfsUrl}?${params}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.error(`MV WFS error: ${res.status}`);
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
        wert: p.bodenrichtwert || p.brw || p.BRW || p.wert || 0,
        stichtag: p.stichtag || p.STICHTAG || 'unbekannt',
        nutzungsart: p.nutzungsart || p.NUTZUNG || 'unbekannt',
        entwicklungszustand: p.entwicklungszustand || p.ENTW || 'B',
        zone: p.zone || p.brw_zone || p.ZONE || '',
        gemeinde: p.gemeinde || p.GEMEINDE || p.gemeinde_name || '',
        bundesland: 'Mecklenburg-Vorpommern',
        quelle: 'BORIS-MV',
        lizenz: '© LAiV M-V',
      };
    } catch (err) {
      console.error('MV adapter error:', err);
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
