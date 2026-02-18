import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Mecklenburg-Vorpommern Adapter
 *
 * Versucht zuerst den öffentlichen WFS-Endpunkt, fällt bei 401 auf
 * alternative WMS/WFS-Endpunkte zurück.
 * Daten: Bodenrichtwerte nach BORIS.MV2.1 Datenmodell
 * CRS: EPSG:25833 (UTM Zone 33N)
 * Lizenz: GutALVO M-V (frei zugänglich)
 */
export class MecklenburgVorpommernAdapter implements BodenrichtwertAdapter {
  state = 'Mecklenburg-Vorpommern';
  stateCode = 'MV';
  isFallback = false;

  // WFS endpoints to try (WFS requires auth on some, WMS may be open)
  private readonly wfsUrls = [
    'https://www.geodaten-mv.de/dienste/bodenrichtwerte_wfs',
    'https://geoserver.geodaten-mv.de/geoserver/bodenrichtwerte/wfs',
    'https://www.geodaten-mv.de/geoserver/bodenrichtwerte/wfs',
  ];

  // WMS endpoints as fallback
  private readonly wmsUrls = [
    'https://www.geodaten-mv.de/dienste/bodenrichtwerte_wms',
    'https://www.geodaten-mv.de/geoserver/bodenrichtwerte/wms',
    'https://geoserver.geodaten-mv.de/geoserver/bodenrichtwerte/wms',
  ];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    // Try WFS endpoints first
    for (const wfsUrl of this.wfsUrls) {
      try {
        const result = await this.tryWfsQuery(wfsUrl, lat, lon);
        if (result) return result;
      } catch {
        // Try next
      }
    }

    // Fall back to WMS GetFeatureInfo
    for (const wmsUrl of this.wmsUrls) {
      try {
        const result = await this.tryWmsQuery(wmsUrl, lat, lon);
        if (result) return result;
      } catch {
        // Try next
      }
    }

    return null;
  }

  private async tryWfsQuery(wfsUrl: string, lat: number, lon: number): Promise<NormalizedBRW | null> {
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

    const url = `${wfsUrl}?${params}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.error(`MV WFS auth error: ${res.status} at ${wfsUrl}`);
      }
      return null;
    }

    const text = await res.text();
    if (!text.trimStart().startsWith('{')) return null;

    const json = JSON.parse(text) as any;
    if (!json.features?.length) return null;

    // Prefer Wohnbau
    const wohn = json.features.find((f: any) => {
      const nutzung = f.properties?.nutzungsart || f.properties?.NUTZUNG || '';
      return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
    }) || json.features[0];

    const p = wohn.properties;

    const wertRaw = p.bodenrichtwert ?? p.brw ?? p.BRW ?? p.wert ?? 0;
    const wert = parseFloat(String(wertRaw));
    if (!wert || wert <= 0 || wert > 500_000) return null;

    return {
      wert,
      stichtag: p.stichtag || p.STICHTAG || 'unbekannt',
      nutzungsart: p.nutzungsart || p.NUTZUNG || 'unbekannt',
      entwicklungszustand: p.entwicklungszustand || p.ENTW || 'B',
      zone: p.zone || p.brw_zone || p.ZONE || '',
      gemeinde: p.gemeinde || p.GEMEINDE || p.gemeinde_name || '',
      bundesland: 'Mecklenburg-Vorpommern',
      quelle: 'BORIS-MV',
      lizenz: '© LAiV M-V',
    };
  }

  private async tryWmsQuery(wmsUrl: string, lat: number, lon: number): Promise<NormalizedBRW | null> {
    const delta = 0.001;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

    // Try common MV BRW layer names
    const layers = ['bodenrichtwert', 'Bodenrichtwert', 'BRW', 'brw', 'bodenrichtwerte', '0'];

    for (const layer of layers) {
      try {
        const params = new URLSearchParams({
          SERVICE: 'WMS',
          VERSION: '1.1.1',
          REQUEST: 'GetFeatureInfo',
          LAYERS: layer,
          QUERY_LAYERS: layer,
          SRS: 'EPSG:4326',
          BBOX: bbox,
          WIDTH: '101',
          HEIGHT: '101',
          X: '50',
          Y: '50',
          INFO_FORMAT: 'text/xml',
          FEATURE_COUNT: '5',
          STYLES: '',
          FORMAT: 'image/png',
        });

        const url = `${wmsUrl}?${params}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) continue;

        const text = await res.text();
        if (text.includes('ServiceException') || text.includes('ExceptionReport')) continue;
        if (text.trim().length < 50) continue;

        const wert = this.extractValue(text);
        if (!wert || wert <= 0) continue;

        return {
          wert,
          stichtag: this.extractField(text, 'stichtag') || this.extractField(text, 'stag') || 'unbekannt',
          nutzungsart: this.extractField(text, 'nutzungsart') || this.extractField(text, 'nuta') || 'unbekannt',
          entwicklungszustand: this.extractField(text, 'entwicklungszustand') || this.extractField(text, 'entw') || 'B',
          zone: this.extractField(text, 'zone') || this.extractField(text, 'wnum') || '',
          gemeinde: this.extractField(text, 'gemeinde') || this.extractField(text, 'gena') || '',
          bundesland: 'Mecklenburg-Vorpommern',
          quelle: 'BORIS-MV (WMS)',
          lizenz: '© LAiV M-V',
        };
      } catch {
        // Try next layer
      }
    }
    return null;
  }

  private extractValue(text: string): number | null {
    const patterns = [
      /<(?:[a-zA-Z]+:)?BRW>(\d+(?:[.,]\d+)?)</i,
      /<(?:[a-zA-Z]+:)?bodenrichtwert>(\d+(?:[.,]\d+)?)</i,
      /\bBRW="(\d+(?:[.,]\d+)?)"/i,
      /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m|€\/m)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        let numStr = match[1];
        if (numStr.includes(',')) {
          numStr = numStr.replace(/\./g, '').replace(',', '.');
        }
        const val = parseFloat(numStr);
        if (val > 0 && val <= 500_000 && isFinite(val)) return val;
      }
    }
    return null;
  }

  private extractField(text: string, field: string): string | null {
    const attrRe = new RegExp(`\\b${field}="([^"]*)"`, 'i');
    const attrMatch = text.match(attrRe);
    if (attrMatch) return attrMatch[1].trim();

    const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}>([^<]+)<`, 'i');
    const match = text.match(re);
    return match ? match[1].trim() : null;
  }

  async healthCheck(): Promise<boolean> {
    for (const url of this.wfsUrls) {
      try {
        const params = new URLSearchParams({
          service: 'WFS',
          version: '2.0.0',
          request: 'GetCapabilities',
        });
        const res = await fetch(`${url}?${params}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) return true;
      } catch {
        // Try next
      }
    }
    return false;
  }
}
