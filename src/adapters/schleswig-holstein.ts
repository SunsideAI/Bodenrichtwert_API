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
  private readonly wmsUrls = [
    'https://service.gdi-sh.de/WMS_SH_FD_VBORIS',
    'https://service.gdi-sh.de/WMS_SH_BORIS',
    'https://gdi.schleswig-holstein.de/WMS_SH_FD_VBORIS',
  ];

  private discoveredLayers: string[] | null = null;
  private discoveredUrl: string | null = null;

  // Static layer candidates – tried when GetCapabilities fails
  private readonly layerCandidates = [
    // Year-based (most likely for VBORIS SH)
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
    if (text.trim().length < 50) return null;

    const wert = this.extractValue(text);
    if (!wert || wert <= 0) return null;

    return {
      wert,
      stichtag: this.extractField(text, 'stichtag') || this.extractField(text, 'stag') || 'aktuell',
      nutzungsart: this.extractField(text, 'nutzungsart') || this.extractField(text, 'nuta') || 'W',
      entwicklungszustand: this.extractField(text, 'entwicklungszustand') || this.extractField(text, 'entw') || 'B',
      zone: this.extractField(text, 'zone') || this.extractField(text, 'wnum') || '',
      gemeinde: this.extractField(text, 'gemeinde') || this.extractField(text, 'gena') || '',
      bundesland: 'Schleswig-Holstein',
      quelle: 'VBORIS-SH',
      lizenz: '© LVermGeo SH (Ansicht frei)',
    };
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
    // FIELDS attribute style
    const attrRe = new RegExp(`\\b${field}="([^"]*)"`, 'i');
    const attrMatch = text.match(attrRe);
    if (attrMatch) return attrMatch[1].trim();

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
