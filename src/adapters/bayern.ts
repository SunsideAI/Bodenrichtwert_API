import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Bayern Adapter
 *
 * Nutzt den offiziellen Bayern-Geoportal WMS GetFeatureInfo Endpunkt.
 * URL: https://geoservices.bayern.de/wms/v1/ogc_bodenrichtwerte.cgi
 *
 * Layer-Discovery per GetCapabilities beim ersten Aufruf.
 * Probiert info_format text/plain, text/xml und text/html.
 *
 * CRS: EPSG:25832 (UTM Zone 32N, nativ), EPSG:4326 für BBOX
 * Lizenz: © Bayerische Vermessungsverwaltung (www.geodaten.bayern.de)
 */
export class BayernAdapter implements BodenrichtwertAdapter {
  state = 'Bayern';
  stateCode = 'BY';
  isFallback = false;

  private readonly wmsUrl = 'https://geoservices.bayern.de/wms/v1/ogc_bodenrichtwerte.cgi';

  // Bekannte Layer-Kandidaten (werden via GetCapabilities ergänzt)
  private layerCandidates = [
    'bodenrichtwerte_aktuell',
    'bodenrichtwerte_2024',
    'bodenrichtwerte_2023',
    'brw_aktuell',
    'BRW',
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

    for (const layer of layersToTry) {
      for (const fmt of ['text/plain', 'text/xml', 'application/json', 'text/html'] as const) {
        try {
          const result = await this.queryWms(lat, lon, layer, fmt);
          if (result) return result;
        } catch {
          // nächste Kombination
        }
      }
    }

    console.error('BY adapter: Kein Treffer mit allen Layer/Format-Kombinationen');
    return null;
  }

  private async discoverLayers(): Promise<string[]> {
    try {
      const params = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.3.0',
        REQUEST: 'GetCapabilities',
      });

      const res = await fetch(`${this.wmsUrl}?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return [];

      const xml = await res.text();
      const layers: string[] = [];

      // Queryable Layer bevorzugen
      const queryableRegex = /<Layer[^>]*queryable=["']1["'][^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
      let match;
      while ((match = queryableRegex.exec(xml)) !== null) {
        layers.push(match[1].trim());
      }

      if (layers.length === 0) {
        const nameRegex = /<Name>([^<]+)<\/Name>/g;
        while ((match = nameRegex.exec(xml)) !== null) {
          const name = match[1].trim();
          if (name && !name.toLowerCase().includes('wms') && !name.toLowerCase().includes('service')) {
            layers.push(name);
          }
        }
      }

      return layers;
    } catch (err) {
      console.warn('BY GetCapabilities error:', err);
      return [];
    }
  }

  private async queryWms(
    lat: number,
    lon: number,
    layer: string,
    infoFormat: string,
  ): Promise<NormalizedBRW | null> {
    // WMS 1.3.0: CRS=EPSG:4326 → Achsenreihenfolge lat,lon in BBOX
    const delta = 0.001;
    const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`;

    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.3.0',
      REQUEST: 'GetFeatureInfo',
      LAYERS: layer,
      QUERY_LAYERS: layer,
      CRS: 'EPSG:4326',
      BBOX: bbox,
      WIDTH: '101',
      HEIGHT: '101',
      I: '50',
      J: '50',
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

    console.log(`BY WMS [${layer}/${infoFormat}] response (300 chars):`, text.substring(0, 300));

    if (infoFormat === 'application/json') return this.parseJson(text);
    if (infoFormat === 'text/plain') return this.parseTextPlain(text);
    if (infoFormat === 'text/xml') return this.parseXml(text);
    return this.parseHtml(text);
  }

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
    // Format: "KEY = 'VALUE'" oder "KEY = VALUE"
    if (!text.includes('=')) return null;

    const get = (key: string): string => {
      const re = new RegExp(`^\\s*${key}\\s*=\\s*'?([^'\\n]*)'?`, 'im');
      const m = text.match(re);
      return m ? m[1].trim() : '';
    };

    const brwRaw = get('BODENRICHTWERT') || get('BRW') || get('bodenrichtwert') || get('RICHTWERT');
    if (!brwRaw) return null;

    const wert = parseFloat(brwRaw.replace(',', '.'));
    if (!wert || wert <= 0 || !isFinite(wert)) return null;

    const stichtagRaw = get('STICHTAG') || get('DAT') || get('DATUM');
    return {
      wert,
      stichtag: this.convertDate(stichtagRaw) || 'aktuell',
      nutzungsart: get('NUTZUNGSART') || get('NUTZUNG') || get('ART') || 'unbekannt',
      entwicklungszustand: get('ENTWICKLUNGSZUSTAND') || get('ENTW') || 'B',
      zone: get('BRWNUMMER') || get('ZONE') || get('BRZ') || '',
      gemeinde: get('GEMEINDE') || get('GEM') || get('ORT') || '',
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
      // Auch als Attribut: field="value"
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
        VERSION: '1.3.0',
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
