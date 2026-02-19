import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Saarland Adapter
 *
 * Nutzt den WMS GetFeatureInfo-Endpunkt über MapServ (primär, bestätigt)
 * und Mapbender (Fallback).
 *
 * MapServ: https://geoportal.saarland.de/gdi-sl/mapserv (BORIS map files)
 *   → Bestätigt: steuer_boris_2022.map / Layer STEUER_BORIS / EPSG:25832
 * Mapbender: https://geoportal.saarland.de/mapbender/php/wms.php (layer_id=48720)
 *   → Layer BORISSL2024 (nicht queryable via GetFeatureInfo)
 *
 * HINWEIS: Der ArcGIS WFS (Boden_WFS) enthält nur Bodenkunde-Daten,
 * KEINE Bodenrichtwerte! Deshalb rein WMS-basiert.
 *
 * CRS: EPSG:25832 (UTM Zone 32N, nativ), auch EPSG:4326 versucht
 * Lizenz: © LVGL Saarland
 */
export class SaarlandAdapter implements BodenrichtwertAdapter {
  state = 'Saarland';
  stateCode = 'SL';
  isFallback = false;

  // Mapbender WMS – primärer Endpunkt (hat BORISSL2024 im Test gefunden)
  private readonly mapbenderUrl = 'https://geoportal.saarland.de/mapbender/php/wms.php';
  private readonly mapbenderParams = { inspire: '1', layer_id: '48720', withChilds: '1' };

  // MapServ WMS – Fallback-Endpunkte (verschiedene Jahrgänge)
  private readonly mapservEndpoints = [
    { map: '/mapfiles/gdisl/BORIS/steuer_boris_2024.map' },
    { map: '/mapfiles/gdisl/BORIS/steuer_boris_2022.map' },
    { map: '/mapfiles/gdisl/BORIS/boris_2024.map' },
    { map: '/mapfiles/gdisl/BORIS/boris_2022.map' },
    { map: '/mapfiles/gdisl/BORIS/boris.map' },
  ];
  private readonly mapservUrl = 'https://geoportal.saarland.de/gdi-sl/mapserv';

  // Bekannte Layer-Kandidaten (STEUER_BORIS bestätigt via Test)
  private knownLayers = ['STEUER_BORIS', 'BORISSL2024', 'BORISSL2022', 'BORIS_SL', 'Bodenrichtwerte', 'bodenrichtwerte', 'BRW'];

  private discoveredMapbenderLayers: string[] | null = null;
  private discoveredMapservLayers: Record<string, string[]> = {};

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    // 1. MapServ WMS (bestätigt: steuer_boris_2022.map / STEUER_BORIS / EPSG:25832)
    for (const ep of this.mapservEndpoints) {
      try {
        const result = await this.queryMapserv(lat, lon, ep.map);
        if (result) return result;
      } catch (err) {
        console.warn(`SL MapServ ${ep.map} error:`, err);
      }
    }

    // 2. Mapbender WMS Fallback (BORISSL2024)
    try {
      const result = await this.queryMapbender(lat, lon);
      if (result) return result;
    } catch (err) {
      console.warn('SL Mapbender error:', err);
    }

    console.error('SL adapter: Kein Treffer mit MapServ und Mapbender');
    return null;
  }

  // ─── Mapbender WMS ─────────────────────────────────────────────────────────

  private async queryMapbender(lat: number, lon: number): Promise<NormalizedBRW | null> {
    if (!this.discoveredMapbenderLayers) {
      this.discoveredMapbenderLayers = await this.discoverLayers(
        this.mapbenderUrl,
        this.mapbenderParams,
      );
      console.log('SL Mapbender layers:', this.discoveredMapbenderLayers);
    }

    const layersToTry = this.discoveredMapbenderLayers.length > 0
      ? this.discoveredMapbenderLayers
      : this.knownLayers;

    return this.queryWmsWithStrategies(lat, lon, this.mapbenderUrl, this.mapbenderParams, layersToTry);
  }

  // ─── MapServ WMS ───────────────────────────────────────────────────────────

  private async queryMapserv(lat: number, lon: number, mapFile: string): Promise<NormalizedBRW | null> {
    const extra = { map: mapFile };

    let layers = this.discoveredMapservLayers[mapFile];
    if (!layers) {
      layers = await this.discoverLayers(this.mapservUrl, extra);
      this.discoveredMapservLayers[mapFile] = layers;
      console.log(`SL MapServ ${mapFile} layers:`, layers);
    }

    const layersToTry = layers.length > 0 ? layers : this.knownLayers;
    return this.queryWmsWithStrategies(lat, lon, this.mapservUrl, extra, layersToTry);
  }

  // ─── Multi-Strategie WMS Query ─────────────────────────────────────────────

  private async queryWmsWithStrategies(
    lat: number,
    lon: number,
    baseUrl: string,
    extraParams: Record<string, string>,
    layers: string[],
  ): Promise<NormalizedBRW | null> {
    for (const layer of layers) {
      // Strategie 1: WMS 1.1.1 + EPSG:25832 (native UTM-Koordinaten)
      for (const fmt of ['text/plain', 'text/xml', 'text/html'] as const) {
        try {
          const result = await this.queryWms(lat, lon, baseUrl, extraParams, layer, fmt, 'EPSG:25832', '1.1.1');
          if (result) return result;
        } catch { /* weiter */ }
      }

      // Strategie 2: WMS 1.1.1 + EPSG:4326
      for (const fmt of ['text/plain', 'text/xml', 'text/html'] as const) {
        try {
          const result = await this.queryWms(lat, lon, baseUrl, extraParams, layer, fmt, 'EPSG:4326', '1.1.1');
          if (result) return result;
        } catch { /* weiter */ }
      }

      // Strategie 3: WMS 1.3.0 + EPSG:25832
      for (const fmt of ['text/plain', 'text/xml', 'text/html'] as const) {
        try {
          const result = await this.queryWms(lat, lon, baseUrl, extraParams, layer, fmt, 'EPSG:25832', '1.3.0');
          if (result) return result;
        } catch { /* weiter */ }
      }
    }
    return null;
  }

  // ─── WMS Query ─────────────────────────────────────────────────────────────

  private async queryWms(
    lat: number,
    lon: number,
    baseUrl: string,
    extraParams: Record<string, string>,
    layer: string,
    infoFormat: string,
    srs: string,
    version: string,
  ): Promise<NormalizedBRW | null> {
    let bbox: string;
    if (srs === 'EPSG:25832') {
      const [e, n] = this.wgs84ToUtm32(lat, lon);
      const delta = 50;
      bbox = `${e - delta},${n - delta},${e + delta},${n + delta}`;
    } else if (version === '1.3.0' && srs === 'EPSG:4326') {
      // WMS 1.3.0 + EPSG:4326: lat,lon Achsenreihenfolge
      const delta = 0.001;
      bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`;
    } else {
      // WMS 1.1.1 + EPSG:4326: lon,lat Achsenreihenfolge
      const delta = 0.001;
      bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
    }

    const isV130 = version === '1.3.0';
    const params = new URLSearchParams({
      ...extraParams,
      SERVICE: 'WMS',
      VERSION: version,
      REQUEST: 'GetFeatureInfo',
      LAYERS: layer,
      QUERY_LAYERS: layer,
      ...(isV130 ? { CRS: srs } : { SRS: srs }),
      BBOX: bbox,
      WIDTH: '101',
      HEIGHT: '101',
      ...(isV130 ? { I: '50', J: '50' } : { X: '50', Y: '50' }),
      INFO_FORMAT: infoFormat,
      FEATURE_COUNT: '5',
      STYLES: '',
      FORMAT: 'image/png',
    });

    const res = await fetch(`${baseUrl}?${params}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const text = await res.text();
    if (!text || text.length < 10) return null;
    if (text.includes('ServiceException') || text.includes('ExceptionReport')) return null;
    // MapServer-Fehlerseiten erkennen
    if (text.includes('<TITLE>MapServer Message</TITLE>')) return null;

    console.log(`SL WMS [${layer}/${infoFormat}/${srs}/${version}] (300 chars):`, text.substring(0, 300));

    if (infoFormat === 'text/plain') return this.parseTextPlain(text);
    if (infoFormat === 'text/xml') return this.parseXml(text);
    return this.parseHtml(text);
  }

  // ─── Layer Discovery ───────────────────────────────────────────────────────

  private async discoverLayers(
    baseUrl: string,
    extraParams: Record<string, string>,
  ): Promise<string[]> {
    // Versuche beide WMS-Versionen
    for (const version of ['1.1.1', '1.3.0']) {
      try {
        const params = new URLSearchParams({
          ...extraParams,
          SERVICE: 'WMS',
          VERSION: version,
          REQUEST: 'GetCapabilities',
        });

        const res = await fetch(`${baseUrl}?${params}`, {
          headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) continue;

        const xml = await res.text();
        // MapServer-Fehlerseiten überspringen
        if (xml.includes('<TITLE>MapServer Message</TITLE>')) continue;

        const layers: string[] = [];

        // Queryable Layer
        const qRe = /<Layer[^>]*queryable=["']1["'][^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
        let m;
        while ((m = qRe.exec(xml)) !== null) {
          layers.push(m[1].trim());
        }

        if (layers.length === 0) {
          const nRe = /<Layer[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
          while ((m = nRe.exec(xml)) !== null) {
            const n = m[1].trim();
            if (n && !n.toLowerCase().includes('wms') && !n.toLowerCase().includes('service')) {
              layers.push(n);
            }
          }
        }

        if (layers.length > 0) return layers;
      } catch { /* nächste Version */ }
    }
    return [];
  }

  // ─── WGS84 → UTM Zone 32N ─────────────────────────────────────────────────

  private wgs84ToUtm32(lat: number, lon: number): [number, number] {
    const a = 6378137.0;
    const f = 1 / 298.257223563;
    const k0 = 0.9996;
    const e = Math.sqrt(2 * f - f * f);
    const e2 = e * e;
    const ep2 = e2 / (1 - e2);
    const lon0 = 9;

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

  private parseTextPlain(text: string): NormalizedBRW | null {
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
      zone: get('ZONE') || get('BRWNUMMER') || get('LAGE') || '',
      gemeinde: get('GEMEINDE') || get('gemeinde') || get('GEM') || get('ORT') || '',
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
        ...this.mapbenderParams,
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetCapabilities',
      });
      const res = await fetch(`${this.mapbenderUrl}?${params}`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
