import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Schleswig-Holstein Adapter
 *
 * Nutzt den GDI-SH WMS GetFeatureInfo Endpunkt (kein WFS verfügbar).
 * Daten: Bodenrichtwerte via VBORIS
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: Eingeschränkt – Ansicht frei, Caching/Download nicht gestattet
 */
export class SchleswigHolsteinAdapter implements BodenrichtwertAdapter {
  state = 'Schleswig-Holstein';
  stateCode = 'SH';
  isFallback = false;

  private wmsUrl = 'https://service.gdi-sh.de/WMS_SH_FD_VBORIS';

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    try {
      const delta = 0.001;
      const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

      const params = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetFeatureInfo',
        LAYERS: 'BRW_Bauland',
        QUERY_LAYERS: 'BRW_Bauland',
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

      if (!res.ok) {
        console.error(`SH WMS error: ${res.status}`);
        return null;
      }

      const text = await res.text();
      const wert = this.extractValue(text);
      if (!wert || wert <= 0) return null;

      return {
        wert,
        stichtag: this.extractField(text, 'stichtag') || this.extractField(text, 'STICHTAG') || 'aktuell',
        nutzungsart: this.extractField(text, 'nutzungsart') || 'W',
        entwicklungszustand: this.extractField(text, 'entwicklungszustand') || 'B',
        zone: this.extractField(text, 'zone') || this.extractField(text, 'ZONE') || '',
        gemeinde: this.extractField(text, 'gemeinde') || this.extractField(text, 'GEMEINDE') || '',
        bundesland: 'Schleswig-Holstein',
        quelle: 'VBORIS-SH',
        lizenz: '© LVermGeo SH (Ansicht frei)',
      };
    } catch (err) {
      console.error('SH adapter error:', err);
      return null;
    }
  }

  private extractValue(text: string): number | null {
    const patterns = [
      /<(?:brw|wert|bodenrichtwert|richtwert|BRW|Wert|Bodenrichtwert)>([\d.,]+)<\//i,
      /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m|€\/m)/i,
      /(?:brw|wert|bodenrichtwert)[:\s=]*([\d.,]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const val = parseFloat(match[1].replace(',', '.'));
        if (val > 0) return val;
      }
    }
    return null;
  }

  private extractField(text: string, field: string): string | null {
    const re = new RegExp(`<${field}[^>]*>([^<]+)</${field}>`, 'i');
    const match = text.match(re);
    return match ? match[1].trim() : null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const params = new URLSearchParams({
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
