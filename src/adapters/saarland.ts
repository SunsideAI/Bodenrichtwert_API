import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Saarland Adapter
 *
 * Nutzt primär den ArcGIS WFS des Saarland Geoportals sowie als Fallback
 * den WMS GetFeatureInfo-Endpunkt (Mapbender/MapServ).
 *
 * WFS: https://geoportal.saarland.de/arcgis/services/Internet/Boden_WFS/MapServer/WFSServer
 * WMS Mapbender: https://geoportal.saarland.de/mapbender/php/wms.php (layer_id=48720)
 * WMS MapServ: https://geoportal.saarland.de/gdi-sl/mapserv (map=steuer_boris_2024.map)
 *
 * CRS: EPSG:25832 (UTM Zone 32N, nativ), EPSG:4326 für BBOX
 * Lizenz: © Landesamt für Vermessung, Geoinformation und Landentwicklung (LVGL) Saarland
 */
export class SaarlandAdapter implements BodenrichtwertAdapter {
  state = 'Saarland';
  stateCode = 'SL';
  isFallback = false;

  // WFS Endpunkt (ArcGIS)
  private readonly wfsUrl = 'https://geoportal.saarland.de/arcgis/services/Internet/Boden_WFS/MapServer/WFSServer';

  // WMS Endpunkte (Fallback, neuestes Jahr zuerst)
  private readonly wmsEndpoints = [
    {
      url: 'https://geoportal.saarland.de/gdi-sl/mapserv',
      extraParams: { map: '/mapfiles/gdisl/BORIS/steuer_boris_2024.map' },
    },
    {
      url: 'https://geoportal.saarland.de/gdi-sl/mapserv',
      extraParams: { map: '/mapfiles/gdisl/BORIS/steuer_boris_2022.map' },
    },
    {
      url: 'https://geoportal.saarland.de/mapbender/php/wms.php',
      extraParams: { inspire: '1', layer_id: '48720', withChilds: '1' },
    },
  ];

  // WFS TypeName-Kandidaten
  private readonly wfsTypeNames = [
    'Boden_WFS:Bodenrichtwerte',
    'Bodenrichtwerte',
    'bodenrichtwerte',
    'Boden_WFS:BRW',
    'brw',
    'BRW',
  ];

  private discoveredWfsTypes: string[] | null = null;
  private discoveredWmsLayers: Record<string, string[]> = {};

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    // 1. WFS versuchen (strukturierter, verlässlicher)
    try {
      const wfsResult = await this.queryWfs(lat, lon);
      if (wfsResult) return wfsResult;
    } catch (err) {
      console.warn('SL WFS error:', err);
    }

    // 2. WMS Fallback
    for (const endpoint of this.wmsEndpoints) {
      try {
        const wmsResult = await this.queryWmsEndpoint(lat, lon, endpoint);
        if (wmsResult) return wmsResult;
      } catch (err) {
        console.warn(`SL WMS ${endpoint.url} error:`, err);
      }
    }

    console.error('SL adapter: Kein Treffer mit WFS und allen WMS-Endpunkten');
    return null;
  }

  // ─── WFS ───────────────────────────────────────────────────────────────────

  private async queryWfs(lat: number, lon: number): Promise<NormalizedBRW | null> {
    if (!this.discoveredWfsTypes) {
      this.discoveredWfsTypes = await this.discoverWfsTypes();
      console.log('SL WFS: Discovered types:', this.discoveredWfsTypes);
    }

    const typesToTry = this.discoveredWfsTypes.length > 0
      ? this.discoveredWfsTypes
      : this.wfsTypeNames;

    for (const typeName of typesToTry) {
      try {
        const result = await this.fetchWfs(lat, lon, typeName);
        if (result) return result;
      } catch { /* nächster */ }
    }

    return null;
  }

  private async discoverWfsTypes(): Promise<string[]> {
    try {
      const params = new URLSearchParams({
        SERVICE: 'WFS',
        VERSION: '2.0.0',
        REQUEST: 'GetCapabilities',
      });

      const res = await fetch(`${this.wfsUrl}?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return [];

      const xml = await res.text();
      const types: string[] = [];
      const re = /<(?:wfs:)?FeatureType>[\s\S]*?<(?:wfs:)?Name>([^<]+)<\/(?:wfs:)?Name>/g;
      let m;
      while ((m = re.exec(xml)) !== null) {
        types.push(m[1].trim());
      }
      return types;
    } catch {
      return [];
    }
  }

  private async fetchWfs(lat: number, lon: number, typeName: string): Promise<NormalizedBRW | null> {
    const delta = 0.001;
    const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;

    const params = new URLSearchParams({
      SERVICE: 'WFS',
      VERSION: '2.0.0',
      REQUEST: 'GetFeature',
      TYPENAMES: typeName,
      BBOX: bbox,
      COUNT: '5',
    });

    const res = await fetch(`${this.wfsUrl}?${params}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const text = await res.text();
    if (text.includes('ExceptionReport') || text.includes('ServiceException')) return null;
    if (text.includes('numberReturned="0"') || text.includes('numberOfFeatures="0"')) return null;

    return this.parseWfsFeature(text);
  }

  private parseWfsFeature(xml: string): NormalizedBRW | null {
    const wert = this.extractNumber(xml, [
      'bodenrichtwert', 'BODENRICHTWERT', 'brw', 'BRW', 'wert', 'richtwert',
    ]);
    if (!wert || wert <= 0) return null;

    const stichtagRaw = this.extractField(xml, ['stichtag', 'STICHTAG', 'dat', 'datum']) || '';
    return {
      wert,
      stichtag: this.convertDate(stichtagRaw) || stichtagRaw || 'aktuell',
      nutzungsart: this.extractField(xml, ['nutzungsart', 'NUTZUNGSART', 'nutzung', 'art']) || 'unbekannt',
      entwicklungszustand: this.extractField(xml, ['entwicklungszustand', 'ENTWICKLUNGSZUSTAND', 'entw']) || 'B',
      zone: this.extractField(xml, ['zone', 'brwnummer', 'lage']) || '',
      gemeinde: this.extractField(xml, ['gemeinde', 'GEMEINDE', 'gem', 'ort', 'name']) || '',
      bundesland: 'Saarland',
      quelle: 'BORIS-SL (LVGL Saarland)',
      lizenz: '© Landesamt für Vermessung, Geoinformation und Landentwicklung (LVGL) Saarland',
    };
  }

  // ─── WMS ───────────────────────────────────────────────────────────────────

  private async queryWmsEndpoint(
    lat: number,
    lon: number,
    endpoint: { url: string; extraParams: Record<string, string> },
  ): Promise<NormalizedBRW | null> {
    let layers = this.discoveredWmsLayers[endpoint.url];
    if (!layers) {
      layers = await this.discoverWmsLayers(endpoint.url, endpoint.extraParams);
      this.discoveredWmsLayers[endpoint.url] = layers;
      console.log(`SL WMS layers for ${endpoint.url}:`, layers);
    }

    // Fallback-Layer falls keine entdeckt
    const layersToTry = layers.length > 0
      ? layers
      : ['Bodenrichtwerte', 'bodenrichtwerte', 'BRW', 'brw', '0'];

    for (const layer of layersToTry) {
      for (const fmt of ['text/plain', 'text/xml', 'application/json', 'text/html'] as const) {
        try {
          const result = await this.queryWmsLayer(lat, lon, endpoint, layer, fmt);
          if (result) return result;
        } catch { /* nächste Kombination */ }
      }
    }
    return null;
  }

  private async discoverWmsLayers(
    wmsUrl: string,
    extraParams: Record<string, string>,
  ): Promise<string[]> {
    try {
      const params = new URLSearchParams({
        ...extraParams,
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetCapabilities',
      });

      const res = await fetch(`${wmsUrl}?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return [];

      const xml = await res.text();
      const layers: string[] = [];

      const qRe = /<Layer[^>]*queryable=["']1["'][^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
      let m;
      while ((m = qRe.exec(xml)) !== null) {
        layers.push(m[1].trim());
      }

      if (layers.length === 0) {
        const nRe = /<Layer[^>]*>\s*<Name>([^<]+)<\/Name>/g;
        while ((m = nRe.exec(xml)) !== null) {
          const n = m[1].trim();
          if (n && !n.toLowerCase().includes('wms') && !n.toLowerCase().includes('service')) {
            layers.push(n);
          }
        }
      }
      return layers;
    } catch {
      return [];
    }
  }

  private async queryWmsLayer(
    lat: number,
    lon: number,
    endpoint: { url: string; extraParams: Record<string, string> },
    layer: string,
    infoFormat: string,
  ): Promise<NormalizedBRW | null> {
    // WMS 1.1.1: SRS=EPSG:4326 → Achsenreihenfolge lon,lat in BBOX
    const delta = 0.001;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

    const params = new URLSearchParams({
      ...endpoint.extraParams,
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

    const res = await fetch(`${endpoint.url}?${params}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const text = await res.text();
    if (!text || text.length < 10) return null;
    if (text.includes('ServiceException') || text.includes('ExceptionReport')) return null;

    console.log(`SL WMS [${layer}/${infoFormat}] response (300 chars):`, text.substring(0, 300));

    if (infoFormat === 'application/json') return this.parseJson(text);
    if (infoFormat === 'text/plain') return this.parseTextPlain(text);
    if (infoFormat === 'text/xml') return this.parseXml(text);
    return this.parseHtml(text);
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

      const stichtagRaw = p.stichtag || p.STICHTAG || p.dat || '';
      return {
        wert: Number(wert),
        stichtag: this.convertDate(stichtagRaw) || stichtagRaw || 'aktuell',
        nutzungsart: p.nutzungsart || p.NUTZUNGSART || p.nutzung || 'unbekannt',
        entwicklungszustand: p.entwicklungszustand || p.ENTWICKLUNGSZUSTAND || p.entw || 'B',
        zone: p.zone || p.lage || p.brwnummer || '',
        gemeinde: p.gemeinde || p.GEMEINDE || p.ort || '',
        bundesland: 'Saarland',
        quelle: 'BORIS-SL (LVGL Saarland)',
        lizenz: '© Landesamt für Vermessung, Geoinformation und Landentwicklung (LVGL) Saarland',
      };
    } catch {
      return null;
    }
  }

  private parseTextPlain(text: string): NormalizedBRW | null {
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
      zone: get('ZONE') || get('BRWNUMMER') || get('LAGE') || '',
      gemeinde: get('GEMEINDE') || get('GEM') || get('ORT') || '',
      bundesland: 'Saarland',
      quelle: 'BORIS-SL (LVGL Saarland)',
      lizenz: '© Landesamt für Vermessung, Geoinformation und Landentwicklung (LVGL) Saarland',
    };
  }

  private parseXml(xml: string): NormalizedBRW | null {
    const wert = this.extractNumber(xml, [
      'bodenrichtwert', 'BODENRICHTWERT', 'brw', 'BRW', 'wert', 'richtwert',
    ]);
    if (!wert || wert <= 0) return null;

    const stichtagRaw = this.extractField(xml, ['stichtag', 'STICHTAG', 'dat', 'datum']) || '';
    return {
      wert,
      stichtag: this.convertDate(stichtagRaw) || stichtagRaw || 'aktuell',
      nutzungsart: this.extractField(xml, ['nutzungsart', 'NUTZUNGSART', 'nutzung', 'art']) || 'unbekannt',
      entwicklungszustand: this.extractField(xml, ['entwicklungszustand', 'ENTWICKLUNGSZUSTAND', 'entw']) || 'B',
      zone: this.extractField(xml, ['zone', 'brwnummer', 'lage']) || '',
      gemeinde: this.extractField(xml, ['gemeinde', 'GEMEINDE', 'gem', 'ort']) || '',
      bundesland: 'Saarland',
      quelle: 'BORIS-SL (LVGL Saarland)',
      lizenz: '© Landesamt für Vermessung, Geoinformation und Landentwicklung (LVGL) Saarland',
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
      bundesland: 'Saarland',
      quelle: 'BORIS-SL (LVGL Saarland)',
      lizenz: '© Landesamt für Vermessung, Geoinformation und Landentwicklung (LVGL) Saarland',
    };
  }

  // ─── Hilfsfunktionen ───────────────────────────────────────────────────────

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
        SERVICE: 'WFS',
        VERSION: '2.0.0',
        REQUEST: 'GetCapabilities',
      });
      const res = await fetch(`${this.wfsUrl}?${params}`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
