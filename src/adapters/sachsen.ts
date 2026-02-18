import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Sachsen Adapter
 *
 * Nutzt den WMS GetFeatureInfo Endpunkt (kein WFS verfügbar).
 * URL: landesvermessung.sachsen.de mit cfg-Parameter für Jahrgang.
 * CRS: EPSG:25833 (nativ), BBOX in EPSG:4326 (WMS 1.1.1)
 * Lizenz: Erlaubnis- und gebührenfrei
 */
export class SachsenAdapter implements BodenrichtwertAdapter {
  state = 'Sachsen';
  stateCode = 'SN';
  isFallback = false;

  private wmsUrl = 'https://www.landesvermessung.sachsen.de/fp/http-proxy/svc';

  // Reduzierte Layer-Kandidaten (häufigste zuerst)
  private layerCandidates = ['brw_zonen', 'Bauland', 'BRW', '0'];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    // Nur aktuellstes Jahr versuchen, dann ein Fallback-Jahr
    for (const year of ['2024', '2023']) {
      for (const layer of this.layerCandidates) {
        try {
          const result = await this.queryWms(lat, lon, year, layer);
          if (result) return result;
        } catch {
          // Nächste Kombination versuchen
        }
      }
    }
    return null;
  }

  private async queryWms(lat: number, lon: number, year: string, layer: string): Promise<NormalizedBRW | null> {
    const delta = 0.001;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

    const params = new URLSearchParams({
      cfg: `boris_${year}`,
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

    const url = `${this.wmsUrl}?${params}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const text = await res.text();
    if (text.includes('ServiceException') || text.includes('ExceptionReport')) return null;
    // Leere Antwort oder sehr kurzer Text → kein Treffer
    if (text.length < 50) return null;

    const wert = this.extractValue(text);
    if (!wert || wert <= 0) return null;

    return {
      wert,
      stichtag: this.extractField(text, 'stichtag') || this.extractField(text, 'stag') || `${year}-01-01`,
      nutzungsart: this.extractField(text, 'nutzungsart') || this.extractField(text, 'nuta') || 'unbekannt',
      entwicklungszustand: this.extractField(text, 'entwicklungszustand') || this.extractField(text, 'entw') || 'B',
      zone: this.extractField(text, 'zone') || this.extractField(text, 'wnum') || '',
      gemeinde: this.extractField(text, 'gemeinde') || this.extractField(text, 'gena') || '',
      bundesland: 'Sachsen',
      quelle: `BORIS-Sachsen (${year})`,
      lizenz: '© GeoSN, erlaubnis- und gebührenfrei',
    };
  }

  private extractValue(text: string): number | null {
    const patterns = [
      /<[^>]*:?(?:brw|wert|bodenrichtwert|richtwert|BRW|Wert|Bodenrichtwert)[^>]*>([\d.,]+)<\//i,
      /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m|€\/m)/i,
      /(?:brw|wert|bodenrichtwert)[:\s=]*([\d.,]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        let numStr = match[1];
        // Deutsche Zahlenformat: 1.250,50 → 1250.50
        if (numStr.includes(',')) {
          numStr = numStr.replace(/\./g, '').replace(',', '.');
        }
        const val = parseFloat(numStr);
        if (val > 0 && isFinite(val)) return val;
      }
    }
    return null;
  }

  private extractField(text: string, field: string): string | null {
    const re = new RegExp(`<[^>]*:?${field}[^>]*>([^<]+)<`, 'i');
    const match = text.match(re);
    return match ? match[1].trim() : null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        cfg: 'boris_2024',
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetCapabilities',
      });
      const res = await fetch(`${this.wmsUrl}?${params}`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
