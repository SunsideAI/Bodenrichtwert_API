import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Sachsen Adapter
 *
 * Nutzt den GeoSN HTTP-Proxy WMS mit INFO_FORMAT=text/plain.
 *
 * Wichtig: text/xml liefert HTML (nicht XML!) – nur text/plain enthält die Daten.
 *
 * Antwortformat (text/plain):
 *   Layer 'brw_bauland_2024'
 *   Feature 1250309:
 *     BODENRICHTWERT_TEXT = '2400'
 *     STICHTAG_TXT = '01.01.2024'
 *     NUTZUNG = 'MK'
 *     ENTWICKLUNGSZUSTAND_K = 'B'
 *     GA_POST_ADRESSE = 'Burgplatz 1, 04109 Leipzig'
 *
 * CRS: EPSG:25833 (nativ), BBOX in EPSG:4326 (WMS 1.1.1)
 * Lizenz: Erlaubnis- und gebührenfrei (© GeoSN)
 */
export class SachsenAdapter implements BodenrichtwertAdapter {
  state = 'Sachsen';
  stateCode = 'SN';
  isFallback = false;

  private readonly proxyUrl = 'https://www.landesvermessung.sachsen.de/fp/http-proxy/svc';

  // Layer names as discovered via GetCapabilities (cfg=boris_YEAR)
  // brw_2024 maps to brw_bauland_2024 on the server
  private readonly layers = ['brw_2024', 'brw_2023'];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    for (const layer of this.layers) {
      const year = layer.match(/\d{4}/)?.[0] || '2024';
      try {
        const result = await this.queryWms(lat, lon, year, layer);
        if (result) return result;
      } catch {
        // Try next layer
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
      // text/xml returns HTML! Only text/plain contains the actual key=value data.
      INFO_FORMAT: 'text/plain',
      FEATURE_COUNT: '5',
      STYLES: '',
      FORMAT: 'image/png',
    });

    const url = `${this.proxyUrl}?${params}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const text = await res.text();

    // Empty or error response
    if (text.includes('ServiceException') || text.includes('ExceptionReport')) return null;
    if (!text.includes('Feature ') && !text.includes('BODENRICHTWERT')) return null;

    const parsed = this.parseTextPlain(text, year);
    return parsed;
  }

  /**
   * Parses the text/plain GetFeatureInfo response.
   * Format:
   *   Layer 'brw_bauland_2024'
   *   Feature 1234:
   *     KEY = 'VALUE'
   *     ...
   */
  private parseTextPlain(text: string, fallbackYear: string): NormalizedBRW | null {
    const get = (key: string): string => {
      // Match:  KEY = 'VALUE'  or  KEY = VALUE
      const re = new RegExp(`^\\s*${key}\\s*=\\s*'?([^'\\n]*)'?`, 'im');
      const m = text.match(re);
      return m ? m[1].trim() : '';
    };

    // Value field
    const brwRaw = get('BODENRICHTWERT_TEXT') || get('BODENRICHTWERT_LABEL') || get('BRW');
    if (!brwRaw) return null;

    const wert = parseFloat(brwRaw.replace(',', '.'));
    if (!wert || wert <= 0 || wert > 500_000 || !isFinite(wert)) return null;

    // Date: '01.01.2024' → '2024-01-01'
    const stichtagRaw = get('STICHTAG_TXT') || get('STICHTAG');
    const stichtag = this.convertDate(stichtagRaw) || `${fallbackYear}-01-01`;

    // Usage
    const nutzungsart = get('NUTZUNG') || get('NUTZUNG_TEXT') || 'unbekannt';

    // Development state
    const entwicklungszustand = get('ENTWICKLUNGSZUSTAND_K') || get('ENTW') || 'B';

    // Zone/reference number
    const zone = get('BODENRICHTWERTNUMMER') || get('BRZ_KURZTEXT') || '';

    // Municipality: extract from postal address "Burgplatz 1, 04109 Leipzig"
    const gemeinde = this.extractGemeinde(get('GA_POST_ADRESSE'), get('GA_POST_NAME'));

    return {
      wert,
      stichtag,
      nutzungsart,
      entwicklungszustand,
      zone,
      gemeinde,
      bundesland: 'Sachsen',
      quelle: `BORIS-Sachsen (${fallbackYear})`,
      lizenz: '© GeoSN, erlaubnis- und gebührenfrei',
    };
  }

  /** Convert German date format '01.01.2024' → '2024-01-01' */
  private convertDate(raw: string): string | null {
    const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  /** Extract city name from address string "Burgplatz 1, 04109 Leipzig" → "Leipzig" */
  private extractGemeinde(adresse: string, gaName: string): string {
    if (adresse) {
      // Last comma-separated part, remove postal code prefix
      const parts = adresse.split(',');
      if (parts.length > 1) {
        const stadtPart = parts[parts.length - 1].trim();
        const city = stadtPart.replace(/^\d{5}\s+/, '').trim();
        if (city) return city;
      }
    }
    if (gaName) {
      // "Gutachterausschuss ... in der Stadt Leipzig" → "Leipzig"
      const m = gaName.match(/(?:in der Stadt|im Landkreis|im Kreis|in der Gemeinde|in)\s+(.+)$/i);
      if (m) return m[1].trim();
    }
    return '';
  }

  async healthCheck(): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        cfg: 'boris_2024',
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetCapabilities',
      });
      const res = await fetch(`${this.proxyUrl}?${params}`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
