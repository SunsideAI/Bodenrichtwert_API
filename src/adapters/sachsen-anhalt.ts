import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Sachsen-Anhalt Adapter
 *
 * Nutzt den Geodatenportal WMS GetFeatureInfo Endpunkt (kein WFS verfügbar).
 * Daten: Bodenrichtwerte 2024
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: dl-de/by-2-0 (© GeoBasis-DE / LVermGeo ST)
 */
export class SachsenAnhaltAdapter implements BodenrichtwertAdapter {
  state = 'Sachsen-Anhalt';
  stateCode = 'ST';
  isFallback = false;

  private baseUrl = 'https://www.geodatenportal.sachsen-anhalt.de/wss/service';

  // Max realistic BRW
  private readonly MAX_BRW = 500_000;

  // Layer-Kandidaten für den ST WMS
  private layerCandidates = ['Bauland', 'BRW', 'bodenrichtwerte', '0', '1'];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    for (const year of ['2024', '2022']) {
      for (const layer of this.layerCandidates) {
        try {
          const result = await this.queryWms(lat, lon, year, layer);
          if (result) return result;
        } catch {
          // Nächste Kombination versuchen
        }
      }
    }
    console.error('ST adapter: Kein Treffer mit allen Jahr/Layer-Kombinationen');
    return null;
  }

  private async queryWms(lat: number, lon: number, year: string, layer: string): Promise<NormalizedBRW | null> {
    const delta = 0.001;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

    const wmsUrl = `${this.baseUrl}/ST_LVermGeo_BRW${year}_gast/guest`;

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

    if (!res.ok) return null;

    const text = await res.text();
    if (text.includes('ServiceException') || text.includes('ExceptionReport')) return null;

    const wert = this.extractValue(text);
    if (!wert || wert <= 0) return null;

    return {
      wert,
      stichtag: this.extractField(text, 'stichtag') || this.extractField(text, 'stag') || `${year}-01-01`,
      nutzungsart: this.extractField(text, 'nutzungsart') || this.extractField(text, 'nuta') || 'unbekannt',
      entwicklungszustand: this.extractField(text, 'entwicklungszustand') || this.extractField(text, 'entw') || 'B',
      zone: this.extractField(text, 'zone') || this.extractField(text, 'wnum') || '',
      gemeinde: this.extractField(text, 'gemeinde') || this.extractField(text, 'gena') || '',
      bundesland: 'Sachsen-Anhalt',
      quelle: `BORIS-ST (${year})`,
      lizenz: '© GeoBasis-DE / LVermGeo ST, dl-de/by-2-0',
    };
  }

  private extractValue(text: string): number | null {
    // Try known exact VBORIS field names first (avoid matching BEZUGSWERT, GRUNDWERT etc.)
    const exactPatterns = [
      // Exact tag: <BRW>...</BRW> or <ns:BRW>...</ns:BRW>
      /<(?:[a-zA-Z]+:)?BRW>(\d+(?:[.,]\d+)?)</i,
      // Exact bodenrichtwert tag
      /<(?:[a-zA-Z]+:)?bodenrichtwert>(\d+(?:[.,]\d+)?)</i,
      // FIELDS attribute style (e.g. NRW style): BRW="6600"
      /\bBRW="(\d+(?:[.,]\d+)?)"/i,
      // EUR/m² mention in text
      /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m|€\/m)/i,
    ];

    for (const pattern of exactPatterns) {
      const match = text.match(pattern);
      if (match) {
        let numStr = match[1];
        // German number format: 1.250,50 → 1250.50
        if (numStr.includes(',')) {
          numStr = numStr.replace(/\./g, '').replace(',', '.');
        }
        const val = parseFloat(numStr);
        if (val > 0 && val <= this.MAX_BRW && isFinite(val)) return val;
      }
    }

    return null;
  }

  private extractField(text: string, field: string): string | null {
    // FIELDS attribute style (e.g. field="value")
    const attrRe = new RegExp(`\\b${field}="([^"]*)"`, 'i');
    const attrMatch = text.match(attrRe);
    if (attrMatch) return attrMatch[1].trim();

    // XML tag style
    const tagRe = new RegExp(`<(?:[a-zA-Z]+:)?${field}>([^<]+)<`, 'i');
    const tagMatch = text.match(tagRe);
    return tagMatch ? tagMatch[1].trim() : null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const wmsUrl = `${this.baseUrl}/ST_LVermGeo_BRW2024_gast/guest`;
      const params = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetCapabilities',
      });
      const res = await fetch(`${wmsUrl}?${params}`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
