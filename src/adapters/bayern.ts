import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Bayern Adapter
 *
 * Nutzt den offiziellen Bayern-Geoportal WMS GetFeatureInfo Endpunkt.
 * URL: https://geoservices.bayern.de/wms/v1/ogc_bodenrichtwerte.cgi
 * WMS-Version: 1.1.1 (!) – 1.3.0 liefert leere GetCapabilities.
 *
 * Layer: bodenrichtwerte_aktuell (bestätigt via Geoportal Bayern)
 * CRS: EPSG:25832 nativ, EPSG:4326 wird unterstützt
 * BBOX (WMS 1.1.1, EPSG:4326): minlon,minlat,maxlon,maxlat
 *
 * Lizenz: © Bayerische Vermessungsverwaltung (www.geodaten.bayern.de)
 */
export class BayernAdapter implements BodenrichtwertAdapter {
  state = 'Bayern';
  stateCode = 'BY';
  isFallback = false;

  private readonly wmsUrl = 'https://geoservices.bayern.de/wms/v1/ogc_bodenrichtwerte.cgi';

  // Bekannte Layer (bestätigt via Geoportal-Viewer)
  private layerCandidates = [
    'bodenrichtwerte_aktuell',
    'bodenrichtwerte',
    '0',
  ];

  private discoveredLayers: string[] | null = null;

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    if (!this.discoveredLayers) {
      this.discoveredLayers = await this.discoverLayers();
      console.log('BY WMS: Discovered layers:', this.discoveredLayers);
    }

    const layersToTry = this.discoveredLayers.length > 0
      ? this.discoveredLayers
      : this.layerCandidates;

    // Zwei CRS-Strategien: erst EPSG:4326, dann EPSG:25832 mit UTM-Konvertierung
    for (const layer of layersToTry) {
      // Strategie 1: EPSG:4326 (direkt mit lat/lon)
      for (const fmt of ['text/xml', 'text/plain', 'text/html', 'application/json'] as const) {
        try {
          const result = await this.queryWms(lat, lon, layer, fmt, 'EPSG:4326');
          if (result) return result;
        } catch { /* nächste Kombination */ }
      }

      // Strategie 2: EPSG:25832 (UTM-Konvertierung)
      for (const fmt of ['text/xml', 'text/plain', 'text/html'] as const) {
        try {
          const result = await this.queryWms(lat, lon, layer, fmt, 'EPSG:25832');
          if (result) return result;
        } catch { /* nächste Kombination */ }
      }
    }

    console.error('BY adapter: Kein Treffer mit allen Layer/Format/CRS-Kombinationen');
    return null;
  }

  private async discoverLayers(): Promise<string[]> {
    // Versuche beide WMS-Versionen für GetCapabilities
    for (const version of ['1.1.1', '1.3.0']) {
      try {
        const params = new URLSearchParams({
          SERVICE: 'WMS',
          VERSION: version,
          REQUEST: 'GetCapabilities',
        });

        const res = await fetch(`${this.wmsUrl}?${params}`, {
          headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) continue;

        const xml = await res.text();
        const layers: string[] = [];

        // Queryable Layer bevorzugen
        const queryableRegex = /<Layer[^>]*queryable=["']1["'][^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
        let match;
        while ((match = queryableRegex.exec(xml)) !== null) {
          layers.push(match[1].trim());
        }

        // Falls kein queryable-Attribut, alle Layer-Namen
        if (layers.length === 0) {
          const nameRegex = /<Layer[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
          while ((match = nameRegex.exec(xml)) !== null) {
            const name = match[1].trim();
            if (name && !name.toLowerCase().includes('wms') && !name.toLowerCase().includes('service')) {
              layers.push(name);
            }
          }
        }

        if (layers.length > 0) {
          console.log(`BY GetCapabilities (v${version}): Found ${layers.length} layers`);
          return layers;
        }
      } catch (err) {
        console.warn(`BY GetCapabilities (v${version}) error:`, err);
      }
    }
    return [];
  }

  private async queryWms(
    lat: number,
    lon: number,
    layer: string,
    infoFormat: string,
    srs: string,
  ): Promise<NormalizedBRW | null> {
    let bbox: string;
    if (srs === 'EPSG:25832') {
      // WGS84 → UTM Zone 32N Konvertierung
      const [e, n] = this.wgs84ToUtm32(lat, lon);
      const delta = 50; // 50m Radius in UTM
      bbox = `${e - delta},${n - delta},${e + delta},${n + delta}`;
    } else {
      // WMS 1.1.1 + EPSG:4326: BBOX = minlon,minlat,maxlon,maxlat
      const delta = 0.001;
      bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
    }

    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetFeatureInfo',
      LAYERS: layer,
      QUERY_LAYERS: layer,
      SRS: srs,
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

    const res = await fetch(`${this.wmsUrl}?${params}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const text = await res.text();
    if (!text || text.length < 10) return null;
    if (text.includes('ServiceException') || text.includes('ExceptionReport')) return null;

    console.log(`BY WMS [${layer}/${infoFormat}/${srs}] response (300 chars):`, text.substring(0, 300));

    if (infoFormat === 'application/json') return this.parseJson(text);
    if (infoFormat === 'text/plain') return this.parseTextPlain(text);
    if (infoFormat === 'text/xml') return this.parseXml(text);
    return this.parseHtml(text);
  }

  // ─── WGS84 → UTM Zone 32N (vereinfachte Konvertierung) ────────────────────

  private wgs84ToUtm32(lat: number, lon: number): [number, number] {
    const a = 6378137.0;
    const f = 1 / 298.257223563;
    const k0 = 0.9996;
    const e = Math.sqrt(2 * f - f * f);
    const e2 = e * e;
    const ep2 = e2 / (1 - e2);
    const lon0 = 9; // UTM Zone 32 Zentralmeridian

    const latRad = (lat * Math.PI) / 180;
    const lonRad = ((lon - lon0) * Math.PI) / 180;

    const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
    const T = Math.tan(latRad) ** 2;
    const C = ep2 * Math.cos(latRad) ** 2;
    const A = lonRad * Math.cos(latRad);

    const M =
      a *
      ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latRad -
        ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latRad) +
        ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad) -
        ((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad));

    const easting =
      500000 +
      k0 *
        N *
        (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120);

    const northing =
      k0 *
      (M +
        N *
          Math.tan(latRad) *
          (A ** 2 / 2 +
            ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
            ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));

    return [easting, northing];
  }

  // ─── Parser ────────────────────────────────────────────────────────────────

  private parseJson(text: string): NormalizedBRW | null {
    try {
      const json = JSON.parse(text);
      const features = json.features;
      if (!features?.length) return null;

      const wohn = features.find(
        (f: any) => (f.properties?.nutzungsart || f.properties?.NUTZUNGSART || '').startsWith('W')
      ) || features[0];

      const p = wohn.properties;
      const wert = p.brw ?? p.BRW ?? p.bodenrichtwert ?? p.BODENRICHTWERT ?? p.wert ?? 0;
      if (!wert || wert <= 0) return null;

      return {
        wert: Number(wert),
        stichtag: this.convertDate(p.stichtag || p.STICHTAG || p.dat || '') || 'aktuell',
        nutzungsart: p.nutzungsart || p.NUTZUNGSART || p.nutzung || 'unbekannt',
        entwicklungszustand: p.entwicklungszustand || p.ENTWICKLUNGSZUSTAND || p.entw || 'B',
        zone: p.zone || p.brz || p.lage || '',
        gemeinde: p.gemeinde || p.GEMEINDE || p.ort || '',
        bundesland: 'Bayern',
        quelle: 'BORIS-Bayern (Bayerische Vermessungsverwaltung)',
        lizenz: '© Bayerische Vermessungsverwaltung, www.geodaten.bayern.de',
      };
    } catch {
      return null;
    }
  }

  private parseTextPlain(text: string): NormalizedBRW | null {
    // Format: "KEY = 'VALUE'" oder "KEY = VALUE" oder "KEY: VALUE"
    const get = (key: string): string => {
      const patterns = [
        new RegExp(`^\\s*${key}\\s*=\\s*'?([^'\\n]*)'?`, 'im'),
        new RegExp(`${key}[:\\s]+([^\\n]+)`, 'im'),
      ];
      for (const re of patterns) {
        const m = text.match(re);
        if (m) return m[1].trim();
      }
      return '';
    };

    const brwRaw = get('BODENRICHTWERT') || get('BRW') || get('bodenrichtwert')
      || get('RICHTWERT') || get('richtwert') || get('brw');
    if (!brwRaw) return null;

    const wert = parseFloat(brwRaw.replace(/\./g, '').replace(',', '.'));
    if (!wert || wert <= 0 || !isFinite(wert)) return null;

    const stichtagRaw = get('STICHTAG') || get('stichtag') || get('DAT') || get('DATUM');
    return {
      wert,
      stichtag: this.convertDate(stichtagRaw) || stichtagRaw || 'aktuell',
      nutzungsart: get('NUTZUNGSART') || get('nutzungsart') || get('NUTZUNG') || get('ART') || 'unbekannt',
      entwicklungszustand: get('ENTWICKLUNGSZUSTAND') || get('ENTW') || 'B',
      zone: get('BRWNUMMER') || get('ZONE') || get('BRZ') || '',
      gemeinde: get('GEMEINDE') || get('gemeinde') || get('GEM') || get('ORT') || '',
      bundesland: 'Bayern',
      quelle: 'BORIS-Bayern (Bayerische Vermessungsverwaltung)',
      lizenz: '© Bayerische Vermessungsverwaltung, www.geodaten.bayern.de',
    };
  }

  private parseXml(xml: string): NormalizedBRW | null {
    const wert = this.extractNumber(xml, [
      'bodenrichtwert', 'BODENRICHTWERT', 'brw', 'BRW', 'wert', 'WERT', 'richtwert',
    ]);
    if (!wert || wert <= 0) return null;

    const stichtagRaw = this.extractField(xml, ['stichtag', 'STICHTAG', 'dat', 'DAT', 'datum']) || '';
    return {
      wert,
      stichtag: this.convertDate(stichtagRaw) || stichtagRaw || 'aktuell',
      nutzungsart: this.extractField(xml, ['nutzungsart', 'NUTZUNGSART', 'nutzung', 'art']) || 'unbekannt',
      entwicklungszustand: this.extractField(xml, ['entwicklungszustand', 'ENTWICKLUNGSZUSTAND', 'entw']) || 'B',
      zone: this.extractField(xml, ['brwnummer', 'zone', 'brz', 'lage']) || '',
      gemeinde: this.extractField(xml, ['gemeinde', 'GEMEINDE', 'gem', 'ort']) || '',
      bundesland: 'Bayern',
      quelle: 'BORIS-Bayern (Bayerische Vermessungsverwaltung)',
      lizenz: '© Bayerische Vermessungsverwaltung, www.geodaten.bayern.de',
    };
  }

  private parseHtml(html: string): NormalizedBRW | null {
    const plain = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');

    const patterns = [
      /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m²|€\/m²|EUR\/qm|€\/qm)/i,
      /(?:Bodenrichtwert|BRW)[:\s]+(\d+(?:[.,]\d+)?)/i,
      /(\d{2,6}(?:[.,]\d+)?)\s*(?:EUR|€)/i,
    ];

    let wert: number | null = null;
    for (const p of patterns) {
      const m = plain.match(p);
      if (m) {
        wert = parseFloat(m[1].replace(',', '.'));
        if (wert > 0) break;
      }
    }
    if (!wert || wert <= 0) return null;

    const stichtagM = plain.match(/(?:Stichtag)[:\s]+(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})/i);
    return {
      wert,
      stichtag: stichtagM ? (this.convertDate(stichtagM[1]) || stichtagM[1]) : 'aktuell',
      nutzungsart: plain.match(/Nutzungsart[:\s]+([A-Za-zÄÖÜäöü]+)/i)?.[1] || 'unbekannt',
      entwicklungszustand: 'B',
      zone: '',
      gemeinde: plain.match(/(?:Gemeinde|Ort)[:\s]+([A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\s\-]+)/)?.[1]?.trim() || '',
      bundesland: 'Bayern',
      quelle: 'BORIS-Bayern (Bayerische Vermessungsverwaltung)',
      lizenz: '© Bayerische Vermessungsverwaltung, www.geodaten.bayern.de',
    };
  }

  // ─── Hilfsfunktionen ──────────────────────────────────────────────────────

  private extractNumber(xml: string, fields: string[]): number | null {
    for (const field of fields) {
      const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${field}(?:\\s[^>]*)?>([\\d.,]+)<`, 'i');
      const m = xml.match(re);
      if (m) {
        let s = m[1];
        if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
        const val = parseFloat(s);
        if (val > 0 && val <= 500_000 && isFinite(val)) return val;
      }
      const attrRe = new RegExp(`\\b${field}=["']([\\d.,]+)["']`, 'i');
      const am = xml.match(attrRe);
      if (am) {
        const val = parseFloat(am[1].replace(',', '.'));
        if (val > 0 && val <= 500_000 && isFinite(val)) return val;
      }
    }
    return null;
  }

  private extractField(xml: string, fields: string[]): string | null {
    for (const field of fields) {
      const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${field}(?:\\s[^>]*)?>([^<]+)<`, 'i');
      const m = xml.match(re);
      if (m) return m[1].trim();
      const attrRe = new RegExp(`\\b${field}=["']([^"']+)["']`, 'i');
      const am = xml.match(attrRe);
      if (am) return am[1].trim();
    }
    return null;
  }

  /** '01.01.2024' → '2024-01-01' */
  private convertDate(raw: string): string | null {
    if (!raw) return null;
    const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
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
