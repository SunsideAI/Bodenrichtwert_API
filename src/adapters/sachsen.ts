import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Sachsen Adapter
 *
 * Nutzt den WMS GetFeatureInfo Endpunkt von GeoSN.
 * Versucht GetCapabilities für echte Layer-Namen.
 * CRS: EPSG:25833 (nativ), BBOX in EPSG:4326 (WMS 1.1.1)
 * Lizenz: Erlaubnis- und gebührenfrei (© GeoSN)
 */
export class SachsenAdapter implements BodenrichtwertAdapter {
  state = 'Sachsen';
  stateCode = 'SN';
  isFallback = false;

  // Multiple URL candidates for Sachsen BRW WMS
  private readonly wmsUrls = [
    'https://www.landesvermessung.sachsen.de/fp/http-proxy/svc',
    'https://geodienste.sachsen.de/wms_geosn_bodenrichtwerte/guest',
    'https://www.geodaten.sachsen.de/wss/service/SN_GeoSN_BRW_gast/guest',
    'https://www.geodaten.sachsen.de/wss/service/SN_LfULG_BODENRICHTWERTE_gast/guest',
  ];

  private discoveredLayers: string[] | null = null;
  private discoveredUrl: string | null = null;

  // Static layer candidates to try when discovery fails
  private readonly layerCandidates = [
    'Bodenrichtwerte', 'bodenrichtwerte', 'BRW', 'brw',
    'BRW_Zonen', 'brw_zonen', 'Bauland', '0', '1',
  ];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    // Try to discover the service first
    if (!this.discoveredUrl) {
      await this.discoverService();
    }

    const urlsToTry = this.discoveredUrl
      ? [this.discoveredUrl]
      : this.wmsUrls;

    const layersToTry = this.discoveredLayers?.length
      ? this.discoveredLayers
      : this.layerCandidates;

    for (const wmsUrl of urlsToTry) {
      for (const year of ['2024', '2023']) {
        for (const layer of layersToTry) {
          try {
            const result = await this.queryWms(wmsUrl, lat, lon, year, layer);
            if (result) return result;
          } catch {
            // Try next combination
          }
        }
      }
    }

    // Last resort: try all URL × layer combos without year param
    for (const wmsUrl of this.wmsUrls) {
      for (const layer of this.layerCandidates) {
        try {
          const result = await this.queryWms(wmsUrl, lat, lon, null, layer);
          if (result) return result;
        } catch {
          // Continue
        }
      }
    }

    return null;
  }

  /** Try GetCapabilities on each URL to discover actual layer names */
  private async discoverService(): Promise<void> {
    for (const baseUrl of this.wmsUrls) {
      try {
        const urls = [
          `${baseUrl}?cfg=boris_2024&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities`,
          `${baseUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities`,
        ];

        for (const capUrl of urls) {
          const res = await fetch(capUrl, {
            headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
            signal: AbortSignal.timeout(8000),
          });

          if (!res.ok) continue;

          const xml = await res.text();
          if (!xml.includes('<WMT_MS_Capabilities') && !xml.includes('<WMS_Capabilities')) continue;

          // Extract layer names
          const layers = [...xml.matchAll(/<(?:Name|Layer)>([^<]+)<\/(?:Name|Layer)>/gi)]
            .map(m => m[1].trim())
            .filter(n => n.length > 0 && n.length < 80 && !n.includes('WMS'));

          if (layers.length > 0) {
            console.log(`SN WMS: Discovered layers at ${baseUrl}: ${layers.slice(0, 5).join(', ')}`);
            this.discoveredLayers = layers;
            this.discoveredUrl = baseUrl;
            return;
          }
        }
      } catch {
        // Try next URL
      }
    }
  }

  private async queryWms(
    baseUrl: string,
    lat: number,
    lon: number,
    year: string | null,
    layer: string
  ): Promise<NormalizedBRW | null> {
    const delta = 0.001;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

    const paramObj: Record<string, string> = {
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
    };

    // Add year as cfg parameter for proxy-style URLs
    if (year && baseUrl.includes('http-proxy')) {
      paramObj['cfg'] = `boris_${year}`;
    }

    const params = new URLSearchParams(paramObj);
    const url = `${baseUrl}?${params}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const text = await res.text();
    if (text.includes('ServiceException') || text.includes('ExceptionReport')) return null;
    if (text.length < 50) return null;

    const wert = this.extractValue(text);
    if (!wert || wert <= 0) return null;

    return {
      wert,
      stichtag: this.extractField(text, 'stichtag') || this.extractField(text, 'stag') || (year ? `${year}-01-01` : 'aktuell'),
      nutzungsart: this.extractField(text, 'nutzungsart') || this.extractField(text, 'nuta') || 'unbekannt',
      entwicklungszustand: this.extractField(text, 'entwicklungszustand') || this.extractField(text, 'entw') || 'B',
      zone: this.extractField(text, 'zone') || this.extractField(text, 'wnum') || '',
      gemeinde: this.extractField(text, 'gemeinde') || this.extractField(text, 'gena') || '',
      bundesland: 'Sachsen',
      quelle: `BORIS-Sachsen${year ? ` (${year})` : ''}`,
      lizenz: '© GeoSN, erlaubnis- und gebührenfrei',
    };
  }

  private extractValue(text: string): number | null {
    const patterns = [
      // Exact BRW tag
      /<(?:[a-zA-Z]+:)?BRW>(\d+(?:[.,]\d+)?)</i,
      // Exact bodenrichtwert tag
      /<(?:[a-zA-Z]+:)?bodenrichtwert>(\d+(?:[.,]\d+)?)</i,
      // FIELDS attribute style
      /\bBRW="(\d+(?:[.,]\d+)?)"/i,
      // EUR/m²
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
    // FIELDS attribute style
    const attrRe = new RegExp(`\\b${field}="([^"]*)"`, 'i');
    const attrMatch = text.match(attrRe);
    if (attrMatch) return attrMatch[1].trim();

    // XML tag style
    const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}>([^<]+)<`, 'i');
    const match = text.match(re);
    return match ? match[1].trim() : null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      for (const url of this.wmsUrls) {
        const params = new URLSearchParams({
          SERVICE: 'WMS',
          VERSION: '1.1.1',
          REQUEST: 'GetCapabilities',
        });
        const res = await fetch(`${url}?${params}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
