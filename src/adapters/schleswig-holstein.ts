import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Schleswig-Holstein Adapter
 *
 * Nutzt den GDI-SH WMS GetFeatureInfo Endpunkt.
 * Entdeckt Layer-Namen dynamisch via GetCapabilities.
 * Daten: Bodenrichtwerte via VBORIS
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: Eingeschränkt – Ansicht frei, Caching/Download nicht gestattet
 */
export class SchleswigHolsteinAdapter implements BodenrichtwertAdapter {
  state = 'Schleswig-Holstein';
  stateCode = 'SH';
  isFallback = false;

  // Multiple URL candidates for SH BRW WMS
  // Note: service.gdi-sh.de backend was down; dienste.gdi-sh.de is the active alternative
  private readonly wmsUrls = [
    'https://dienste.gdi-sh.de/WMS_SH_FD_VBORIS',
    'https://service.gdi-sh.de/WMS_SH_FD_VBORIS',
    'https://service.gdi-sh.de/WMS_SH_BORIS',
    'https://gdi.schleswig-holstein.de/WMS_SH_FD_VBORIS',
    'https://sh-mis.schleswig-holstein.de/geoserver/vboris/wms',
  ];

  private discoveredLayers: string[] | null = null;
  private discoveredUrl: string | null = null;

  // Static layer candidates – tried when GetCapabilities fails
  private readonly layerCandidates = [
    // VBORIS date-keyed layer names (SH uses date suffix YYYYMMDD)
    'vBODENRICHTWERTZONE_20240101', 'vBODENRICHTWERTZONE_20230101', 'vBODENRICHTWERTZONE_20220101',
    'VBODENRICHTWERTZZONE_20240101',
    // Year-based
    'Stichtag_2024', 'Stichtag_2023', 'Stichtag_2022',
    // Generic VBORIS names
    'brw_aktuell', 'BRW_aktuell', 'brw_zonal', 'BRW_Zonal',
    'Bodenrichtwert', 'bodenrichtwert', 'BRW', 'brw',
    'BRW_Bauland', 'Bauland', 'bodenrichtwerte',
    // Numeric fallback
    '0', '1',
  ];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    // Discover actual layers via GetCapabilities
    if (!this.discoveredUrl) {
      await this.discoverService();
    }

    const urlsToTry = this.discoveredUrl ? [this.discoveredUrl] : this.wmsUrls;
    const layersToTry = this.discoveredLayers?.length ? this.discoveredLayers : this.layerCandidates;

    for (const wmsUrl of urlsToTry) {
      for (const layer of layersToTry) {
        try {
          const result = await this.queryWms(lat, lon, wmsUrl, layer);
          if (result) return result;
        } catch {
          // Try next layer
        }
      }
    }

    // Fallback: try all URLs × all candidates
    if (this.discoveredUrl) {
      for (const wmsUrl of this.wmsUrls) {
        for (const layer of this.layerCandidates) {
          try {
            const result = await this.queryWms(lat, lon, wmsUrl, layer);
            if (result) return result;
          } catch {
            // Continue
          }
        }
      }
    }

    console.error('SH adapter: Kein Treffer mit allen Layer-Kandidaten');
    return null;
  }

  private async discoverService(): Promise<void> {
    for (const baseUrl of this.wmsUrls) {
      try {
        const params = new URLSearchParams({
          SERVICE: 'WMS',
          VERSION: '1.1.1',
          REQUEST: 'GetCapabilities',
        });

        const res = await fetch(`${baseUrl}?${params}`, {
          headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) continue;

        const xml = await res.text();
        if (!xml.includes('<WMT_MS_Capabilities') && !xml.includes('<WMS_Capabilities')) continue;

        // Extract <Name> elements from layer sections
        const layers = [...xml.matchAll(/<Name>([^<]+)<\/Name>/gi)]
          .map(m => m[1].trim())
          .filter(n => n.length > 0 && n.length < 100 && !n.includes('WMS') && !n.includes('http'));

        if (layers.length > 0) {
          console.log(`SH WMS: Discovered layers at ${baseUrl}: ${layers.slice(0, 8).join(', ')}`);
          // Prefer BRW/Bodenrichtwert layers, filter out group layers
          const brwLayers = layers.filter(n =>
            n.toLowerCase().includes('brw') ||
            n.toLowerCase().includes('bodenrichtwert') ||
            n.toLowerCase().includes('stichtag') ||
            n.toLowerCase().includes('bauland')
          );
          this.discoveredLayers = brwLayers.length > 0 ? brwLayers : layers;
          this.discoveredUrl = baseUrl;
          return;
        }
      } catch {
        // Try next URL
      }
    }
  }

  private async queryWms(lat: number, lon: number, wmsUrl: string, layer: string): Promise<NormalizedBRW | null> {
    const delta = 0.001;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

    // Try text/plain first (like Sachsen), then text/xml
    for (const infoFormat of ['text/plain', 'text/xml', 'application/json']) {
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
          INFO_FORMAT: infoFormat,
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
        if (text.trim().length < 30) continue;

        // Skip if it returned HTML instead of data
        if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) continue;

        const wert = this.extractValue(text);
        if (!wert || wert <= 0) continue;

        return {
          wert,
          stichtag: this.extractField(text, 'stichtag') || this.extractField(text, 'stag') || this.extractField(text, 'STAG') || 'aktuell',
          nutzungsart: this.extractField(text, 'nutzungsart') || this.extractField(text, 'nuta') || this.extractField(text, 'NUTA') || 'W',
          entwicklungszustand: this.extractField(text, 'entwicklungszustand') || this.extractField(text, 'entw') || this.extractField(text, 'ENTW') || 'B',
          zone: this.extractField(text, 'zone') || this.extractField(text, 'wnum') || this.extractField(text, 'WNUM') || '',
          gemeinde: this.extractField(text, 'gemeinde') || this.extractField(text, 'gena') || this.extractField(text, 'GENA') || '',
          bundesland: 'Schleswig-Holstein',
          quelle: 'VBORIS-SH',
          lizenz: '© LVermGeo SH (Ansicht frei)',
        };
      } catch {
        // Try next format
      }
    }
    return null;
  }

  private extractValue(text: string): number | null {
    const patterns = [
      // text/plain key=value: BRW = '450' or BRW = 450
      /^\s*BRW\s*=\s*'?([\d.,]+)'?/im,
      /^\s*BODENRICHTWERT(?:_TEXT|_LABEL)?\s*=\s*'?([\d.,]+)'?/im,
      // XML element
      /<(?:[a-zA-Z]+:)?BRW(?:\s[^>]*)?>(\d+(?:[.,]\d+)?)</i,
      /<(?:[a-zA-Z]+:)?bodenrichtwert(?:\s[^>]*)?>(\d+(?:[.,]\d+)?)</i,
      // XML attribute
      /\bBRW="(\d+(?:[.,]\d+)?)"/i,
      // JSON field
      /"(?:BRW|brw|bodenrichtwert)"\s*:\s*([\d.]+)/i,
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
    // text/plain key=value style:  FIELD = 'VALUE' or  FIELD = VALUE
    const plainRe = new RegExp(`^\\s*${field}\\s*=\\s*'?([^'\\n]*)'?`, 'im');
    const plainMatch = text.match(plainRe);
    if (plainMatch) return plainMatch[1].trim();

    // XML attribute style
    const attrRe = new RegExp(`\\b${field}="([^"]*)"`, 'i');
    const attrMatch = text.match(attrRe);
    if (attrMatch) return attrMatch[1].trim();

    // XML element
    const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}(?:\\s[^>]*)?>([^<]+)<`, 'i');
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
