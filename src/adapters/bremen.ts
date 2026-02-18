import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Bremen Adapter
 *
 * Nutzt den WFS-Endpunkt bei geobasisdaten.niedersachsen.de (gleiche Infrastruktur wie NI).
 * Auto-Discovery: Holt TypeNames aus GetCapabilities beim ersten Aufruf.
 * Schema: VBORIS 2.0 / BRM 3.0 (boris namespace)
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: CC BY-ND 4.0 (seit Juni 2024 frei verfügbar)
 */
export class BremenAdapter implements BodenrichtwertAdapter {
  state = 'Bremen';
  stateCode = 'HB';
  isFallback = false;

  private baseUrl = 'https://www.geobasisdaten.niedersachsen.de/doorman/noauth';

  private endpoints = [
    'WFS_borisHB',
    'WFS_borisHB_2024',
    'WFS_borisHB_2022',
  ];

  private discoveredTypeNames: Record<string, string[]> = {};

  private relevantTypePatterns = ['BodenrichtwertZonal', 'BodenrichtwertLagetypisch'];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    for (const endpoint of this.endpoints) {
      try {
        const result = await this.queryEndpoint(lat, lon, endpoint);
        if (result) return result;
      } catch (err) {
        console.warn(`HB ${endpoint} error:`, err);
      }
    }

    console.error('HB adapter: Kein Treffer mit allen Endpunkten');
    return null;
  }

  private async queryEndpoint(lat: number, lon: number, endpoint: string): Promise<NormalizedBRW | null> {
    const wfsUrl = `${this.baseUrl}/${endpoint}`;

    let typeNames = this.discoveredTypeNames[endpoint];
    if (!typeNames) {
      const allTypes = await this.discoverTypeNames(wfsUrl);
      typeNames = allTypes.filter(t =>
        this.relevantTypePatterns.some(p => t.includes(p))
      );
      this.discoveredTypeNames[endpoint] = typeNames;
      console.log(`HB ${endpoint}: Using typeNames:`, typeNames);
    }

    if (typeNames.length === 0) return null;

    for (const typeName of typeNames) {
      try {
        const result = await this.fetchGml(wfsUrl, lat, lon, typeName);
        if (result) return result;
      } catch { /* next */ }
    }

    return null;
  }

  private async discoverTypeNames(wfsUrl: string): Promise<string[]> {
    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetCapabilities',
      });

      const res = await fetch(`${wfsUrl}?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return [];

      const xml = await res.text();

      const typeNames: string[] = [];
      const nameRegex = /<(?:wfs:)?Name>([^<]+)<\/(?:wfs:)?Name>/g;
      let match;
      while ((match = nameRegex.exec(xml)) !== null) {
        const name = match[1].trim();
        if (name && !name.includes('WFS') && !name.includes('Service')) {
          typeNames.push(name);
        }
      }

      return typeNames;
    } catch (err) {
      console.warn('HB GetCapabilities error:', err);
      return [];
    }
  }

  private async fetchGml(wfsUrl: string, lat: number, lon: number, typeName: string): Promise<NormalizedBRW | null> {
    const delta = 0.0005;
    const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;

    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: typeName,
      bbox: bbox,
      count: '5',
    });

    const res = await fetch(`${wfsUrl}?${params}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const xml = await res.text();

    if (xml.includes('ExceptionReport') || xml.includes('ServiceException')) return null;
    if (xml.includes('numberOfFeatures="0"') || xml.includes('numberReturned="0"')) return null;

    return this.parseBestFeature(xml);
  }

  private parseBestFeature(xml: string): NormalizedBRW | null {
    const featureRegex = /<boris:BR_Bodenrichtwert(?:Zonal|Lagetypisch)[^>]*>([\s\S]*?)<\/boris:BR_Bodenrichtwert(?:Zonal|Lagetypisch)>/g;
    const features: string[] = [];
    let match;
    while ((match = featureRegex.exec(xml)) !== null) {
      features.push(match[1]);
    }

    if (features.length === 0) {
      features.push(xml);
    }

    // Wohnbau-Feature bevorzugen
    let bestFeature = features[0];
    for (const feature of features) {
      const nutzung = this.extractExactField(feature, 'art') ||
                       this.extractExactField(feature, 'nutzungsartBodenrichtwert') || '';
      if (nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn')) {
        bestFeature = feature;
        break;
      }
    }

    const wert = this.extractExactNumber(bestFeature, 'bodenrichtwert');
    if (!wert || wert <= 0) {
      console.warn('HB: bodenrichtwert field not found or zero');
      return null;
    }

    const stichtag = this.extractExactField(bestFeature, 'stichtag') || 'unbekannt';
    const nutzungsart = this.extractExactField(bestFeature, 'art') ||
                         this.extractExactField(bestFeature, 'nutzungsartBodenrichtwert') ||
                         'unbekannt';
    const entwicklungszustand = this.extractExactField(bestFeature, 'entwicklungszustand') || 'B';
    const ortsteil = this.extractExactField(bestFeature, 'ortsteil') || '';

    return {
      wert,
      stichtag,
      nutzungsart,
      entwicklungszustand,
      zone: '',
      gemeinde: ortsteil,
      bundesland: 'Bremen',
      quelle: 'BORIS-HB (GAA Bremen)',
      lizenz: '© GAA Bremen, CC BY-ND 4.0',
    };
  }

  private extractExactNumber(xml: string, field: string): number | null {
    const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${field}(?:\\s[^>]*)?>([\\d.,]+)<`, 'i');
    const match = xml.match(re);
    if (match) {
      let numStr = match[1];
      if (numStr.includes(',')) {
        numStr = numStr.replace(/\./g, '').replace(',', '.');
      }
      const val = parseFloat(numStr);
      if (val > 0 && isFinite(val)) return val;
    }
    return null;
  }

  private extractExactField(xml: string, field: string): string | null {
    const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${field}(?:\\s[^>]*)?>([^<]+)<`, 'i');
    const match = xml.match(re);
    if (match) return match[1].trim();
    return null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetCapabilities',
      });
      const res = await fetch(`${this.baseUrl}/WFS_borisHB?${params}`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
