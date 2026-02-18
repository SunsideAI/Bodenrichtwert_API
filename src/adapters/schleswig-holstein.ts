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

  /**
   * Convert WGS84 lat/lon to UTM Zone 32N (EPSG:25832).
   * Standard Transverse Mercator projection formulas.
   */
  private wgs84ToUtm32(lat: number, lon: number): { easting: number; northing: number } {
    const a = 6378137;
    const f = 1 / 298.257223563;
    const k0 = 0.9996;
    const lon0 = 9; // central meridian for zone 32
    const e2 = 2 * f - f * f;

    const latRad = lat * Math.PI / 180;
    const lon0Rad = lon0 * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;

    const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
    const T = Math.tan(latRad) ** 2;
    const C = (e2 / (1 - e2)) * Math.cos(latRad) ** 2;
    const A = Math.cos(latRad) * (lonRad - lon0Rad);

    const M = a * (
      (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * latRad
      - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * latRad)
      + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * latRad)
      - (35 * e2 ** 3 / 3072) * Math.sin(6 * latRad)
    );

    const easting = 500000 + k0 * N * (
      A + (1 - T + C) * A ** 3 / 6
      + (5 - 18 * T + T ** 2 + 72 * C - 58 * (e2 / (1 - e2))) * A ** 5 / 120
    );
    const northing = k0 * (
      M + N * Math.tan(latRad) * (
        A ** 2 / 2
        + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
        + (61 - 58 * T + T ** 2 + 600 * C - 330 * (e2 / (1 - e2))) * A ** 6 / 720
      )
    );

    return { easting, northing };
  }

  // Static layer candidates – tried when GetCapabilities fails.
  // SH uses "Stichtag_YYYY" naming (confirmed from DANord VBORIS viewer).
  private readonly layerCandidates = [
    // SH-specific "Stichtag_YYYY" naming (confirmed from DANord viewer URLs)
    'Stichtag_2024', 'Stichtag_2022', 'Stichtag_2020',
    'Stichtag_2018', 'Stichtag_2016', 'Stichtag_2014',
    // VBORIS date-keyed layer names (alternative format)
    'vBODENRICHTWERTZONE_20240101', 'vBODENRICHTWERTZONE_20220101',
    // Generic names
    'brw_aktuell', 'Bodenrichtwert', 'bodenrichtwert', 'BRW', 'brw',
    // Numeric fallback
    '0', '1',
  ];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    // Discover actual layers via GetCapabilities
    if (!this.discoveredUrl) {
      await this.discoverService();
    }

    const urlsToTry = this.discoveredUrl ? [this.discoveredUrl] : this.wmsUrls;
    // Limit layers to avoid excessive requests (each layer tries multiple versions × formats)
    const allLayers = this.discoveredLayers?.length ? this.discoveredLayers : this.layerCandidates;
    const layersToTry = allLayers.slice(0, 8);

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
    // Try both WMS 1.1.1 and 1.3.0 for GetCapabilities
    for (const baseUrl of this.wmsUrls) {
      for (const version of ['1.3.0', '1.1.1']) {
        try {
          const params = new URLSearchParams({
            SERVICE: 'WMS',
            VERSION: version,
            REQUEST: 'GetCapabilities',
          });

          const res = await fetch(`${baseUrl}?${params}`, {
            headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
            signal: AbortSignal.timeout(8000),
          });

          if (!res.ok) {
            console.log(`SH WMS: GetCapabilities ${version} at ${baseUrl} → ${res.status}`);
            continue;
          }

          const xml = await res.text();
          if (!xml.includes('<WMT_MS_Capabilities') && !xml.includes('<WMS_Capabilities')) {
            console.log(`SH WMS: GetCapabilities ${version} at ${baseUrl} → not a valid WMS response (${xml.substring(0, 100)})`);
            continue;
          }

          // Extract <Name> elements from layer sections, skip style names
          const layers = [...xml.matchAll(/<Name>([^<]+)<\/Name>/gi)]
            .map(m => m[1].trim())
            .filter(n =>
              n.length > 2 && n.length < 100 &&
              !n.includes('WMS') && !n.includes('http') &&
              n !== 'default'  // filter out style names
            );

          if (layers.length > 0) {
            console.log(`SH WMS: Discovered ${layers.length} layers at ${baseUrl} (v${version}): ${layers.slice(0, 10).join(', ')}`);

            // Include BRW-related layers AND group/position layers
            const brwLayers = layers.filter(n => {
              const lc = n.toLowerCase();
              return lc.includes('bodenrichtwert') ||  // Bodenrichtwertzonen_YYYY
                lc.includes('richtwert') ||            // Richtwertpositionen_YYYY
                lc.includes('stichtag') ||             // Stichtag_YYYY
                lc.includes('brw') ||
                lc.includes('bauland') ||
                lc === 'vboris';                       // group layer
            });

            // Sort by year descending (most recent first)
            const sorted = brwLayers.sort((a, b) => {
              const yearA = a.match(/_(\d{4})/)?.[1] || '0000';
              const yearB = b.match(/_(\d{4})/)?.[1] || '0000';
              if (yearB !== yearA) return yearB.localeCompare(yearA);
              // Prefer Bodenrichtwertzonen over Richtwertpositionen
              if (a.includes('Bodenrichtwert') && !b.includes('Bodenrichtwert')) return -1;
              if (b.includes('Bodenrichtwert') && !a.includes('Bodenrichtwert')) return 1;
              return 0;
            });

            console.log(`SH WMS: Selected ${sorted.length} BRW layers: ${sorted.slice(0, 8).join(', ')}`);
            this.discoveredLayers = sorted.length > 0 ? sorted : layers;
            this.discoveredUrl = baseUrl;
            return;
          }
        } catch (err) {
          console.log(`SH WMS: GetCapabilities ${version} at ${baseUrl} → error: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    console.log('SH WMS: Discovery failed for all URLs, using static layer candidates');
  }

  private async queryWms(lat: number, lon: number, wmsUrl: string, layer: string): Promise<NormalizedBRW | null> {
    const delta = 0.001;
    const { easting, northing } = this.wgs84ToUtm32(lat, lon);
    const utmDelta = 100; // 100 meters in UTM units

    // Try EPSG:25832 (native CRS) FIRST — SH services natively use UTM Zone 32N
    const wmsVersions: Array<{ version: string; bbox: string; srsParam: string; srs: string; xParam: string; yParam: string }> = [
      // WMS 1.3.0 + EPSG:25832 (native CRS, most likely to work)
      {
        version: '1.3.0',
        bbox: `${easting - utmDelta},${northing - utmDelta},${easting + utmDelta},${northing + utmDelta}`,
        srsParam: 'CRS',
        srs: 'EPSG:25832',
        xParam: 'I',
        yParam: 'J',
      },
      // WMS 1.3.0 + EPSG:4326 fallback (axis order: lat,lon for EPSG:4326)
      {
        version: '1.3.0',
        bbox: `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`,
        srsParam: 'CRS',
        srs: 'EPSG:4326',
        xParam: 'I',
        yParam: 'J',
      },
      // WMS 1.1.1 + EPSG:4326 fallback (axis order: lon,lat)
      {
        version: '1.1.1',
        bbox: `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`,
        srsParam: 'SRS',
        srs: 'EPSG:4326',
        xParam: 'X',
        yParam: 'Y',
      },
    ];

    // text/html is often the only supported format for GDI-DE services
    for (const v of wmsVersions) {
      for (const infoFormat of ['text/html', 'text/plain', 'text/xml', 'application/vnd.ogc.gml']) {
        try {
          const params = new URLSearchParams({
            SERVICE: 'WMS',
            VERSION: v.version,
            REQUEST: 'GetFeatureInfo',
            LAYERS: layer,
            QUERY_LAYERS: layer,
            [v.srsParam]: v.srs,
            BBOX: v.bbox,
            WIDTH: '101',
            HEIGHT: '101',
            [v.xParam]: '50',
            [v.yParam]: '50',
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
          if (text.trim().length < 20) continue;

          // For HTML responses, parse tables for BRW values
          if (text.trimStart().startsWith('<!') || text.trimStart().startsWith('<html') || text.trimStart().startsWith('<HTML') || text.trimStart().startsWith('<META') || text.trimStart().startsWith('<table')) {
            const result = this.parseHtmlTable(text);
            if (result) return result;
            continue;
          }

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
    }
    return null;
  }

  /**
   * Parse an HTML GetFeatureInfo response to extract BRW value.
   * Many GDI-DE WMS services return HTML tables with feature attributes.
   */
  private parseHtmlTable(html: string): NormalizedBRW | null {
    // Strategy 1: Find BRW in <td> cells by looking for patterns like:
    // <th>BRW</th><td>450</td> or <td>BRW</td><td>450</td>
    // Also match: Bodenrichtwert, brwkon
    const brwPatterns = [
      /(?:BRW|Bodenrichtwert|brwkon)[^<]*<\/t[dh]>\s*<td[^>]*>\s*([\d.,]+)/gi,
      /BRW[^"]*"[^"]*"[^>]*>\s*([\d.,]+)/gi,
    ];

    for (const pattern of brwPatterns) {
      const match = pattern.exec(html);
      if (match) {
        let numStr = match[1].trim();
        if (numStr.includes(',')) numStr = numStr.replace(/\./g, '').replace(',', '.');
        const wert = parseFloat(numStr);
        if (wert > 0 && wert <= 500_000) {
          return {
            wert,
            stichtag: this.extractHtmlField(html, ['Stichtag', 'STAG', 'stag', 'stichtag']) || 'aktuell',
            nutzungsart: this.extractHtmlField(html, ['Nutzungsart', 'NUTA', 'nuta', 'nutzungsart']) || 'unbekannt',
            entwicklungszustand: this.extractHtmlField(html, ['Entwicklungszustand', 'ENTW', 'entw']) || 'B',
            zone: this.extractHtmlField(html, ['Zone', 'WNUM', 'wnum', 'Bodenrichtwertnummer']) || '',
            gemeinde: this.extractHtmlField(html, ['Gemeinde', 'GENA', 'gena', 'Gemeindename']) || '',
            bundesland: 'Schleswig-Holstein',
            quelle: 'VBORIS-SH',
            lizenz: '© LVermGeo SH (Ansicht frei)',
          };
        }
      }
    }

    // Strategy 2: Look for numeric values in table cells after stripping tags
    // Some tables have the value directly as EUR/m² text
    const eurMatch = html.match(/([\d.,]+)\s*(?:EUR\/m|€\/m)/i);
    if (eurMatch) {
      let numStr = eurMatch[1].trim();
      if (numStr.includes(',')) numStr = numStr.replace(/\./g, '').replace(',', '.');
      const wert = parseFloat(numStr);
      if (wert > 0 && wert <= 500_000) {
        return {
          wert,
          stichtag: 'aktuell',
          nutzungsart: 'unbekannt',
          entwicklungszustand: 'B',
          zone: '',
          gemeinde: '',
          bundesland: 'Schleswig-Holstein',
          quelle: 'VBORIS-SH',
          lizenz: '© LVermGeo SH (Ansicht frei)',
        };
      }
    }

    return null;
  }

  private extractHtmlField(html: string, fieldNames: string[]): string | null {
    for (const name of fieldNames) {
      // Match: <th>FieldName</th><td>Value</td> or <td>FieldName</td><td>Value</td>
      const re = new RegExp(`${name}[^<]*<\\/t[dh]>\\s*<td[^>]*>\\s*([^<]+)`, 'i');
      const match = html.match(re);
      if (match) {
        const val = match[1].trim();
        if (val.length > 0 && val !== '---' && val !== '-') return val;
      }
    }
    return null;
  }

  private extractValue(text: string): number | null {
    const patterns = [
      // text/plain key=value: BRW = '450' or brwkon = '0.35'
      /^\s*BRW\s*=\s*'?([\d.,]+)'?/im,
      /^\s*brwkon\s*=\s*'?([\d.,]+)'?/im,
      /^\s*BODENRICHTWERT(?:_TEXT|_LABEL)?\s*=\s*'?([\d.,]+)'?/im,
      // XML element
      /<(?:[a-zA-Z]+:)?BRW(?:\s[^>]*)?>(\d+(?:[.,]\d+)?)</i,
      /<(?:[a-zA-Z]+:)?brwkon(?:\s[^>]*)?>(\d+(?:[.,]\d+)?)</i,
      /<(?:[a-zA-Z]+:)?bodenrichtwert(?:\s[^>]*)?>(\d+(?:[.,]\d+)?)</i,
      // XML attribute
      /\bBRW="(\d+(?:[.,]\d+)?)"/i,
      /\bbrwkon="(\d+(?:[.,]\d+)?)"/i,
      // JSON field
      /"(?:BRW|brw|bodenrichtwert|brwkon)"\s*:\s*([\d.]+)/i,
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
