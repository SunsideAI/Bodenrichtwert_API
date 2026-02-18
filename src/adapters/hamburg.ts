import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Hamburg Adapter
 *
 * Nutzt geodienste.hamburg.de WFS 2.0.
 * VBORIS-Feldnamen (Kurzform): BRW, STAG, NUTA, ENTW, BRZNAME, WNUM, GENA
 * CRS: EPSG:25832, Lizenz: dl-de/by-2-0
 */
export class HamburgAdapter implements BodenrichtwertAdapter {
  state = 'Hamburg';
  stateCode = 'HH';
  isFallback = false;

  private wfsUrl = 'https://geodienste.hamburg.de/HH_WFS_Bodenrichtwerte';
  private discoveredTypeName: string | null = null;

  // Known type names for Hamburg VBORIS WFS (tried in order if discovery fails).
  // Hamburg's Urban Data Platform uses the "de.hh.up:" namespace prefix.
  private readonly fallbackTypeNames = [
    // Hamburg Urban Data Platform prefix (most likely)
    'de.hh.up:Bodenrichtwert_Zonal',
    'de.hh.up:Bodenrichtwert_Lagetypisch',
    'de.hh.up:Bodenrichtwert_aktuell',
    'de.hh.up:bodenrichtwert',
    'de.hh.up:bodenrichtwerte',
    // Generic app: prefix
    'app:Bodenrichtwert_Zonal',
    'app:bodenrichtwert_zonal',
    'app:Bodenrichtwert',
    'app:bodenrichtwert',
    // Service-namespaced
    'HH_WFS_Bodenrichtwerte:Bodenrichtwert_Zonal',
    'brw:Bodenrichtwert',
    'Bodenrichtwert_Zonal',
    'Bodenrichtwert',
  ];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    try {
      // Discover WFS type names
      const typeNames = await this.getTypeNames();

      // Try WFS with multiple bbox strategies (axis order varies between deegree implementations)
      for (const typeName of typeNames) {
        for (const bboxStrategy of this.buildBboxStrategies(lat, lon)) {
          const result = await this.tryWfsGml(typeName, bboxStrategy);
          if (result) return result;
        }
      }

      // WMS GetFeatureInfo fallback – the WMS has different layer names
      return await this.tryWmsQuery(lat, lon);
    } catch (err) {
      console.error('HH adapter error:', err);
      return null;
    }
  }

  /**
   * Build multiple bbox strings to work around CRS and axis order issues.
   * Hamburg's deegree WFS uses EPSG:25832 (UTM Zone 32N) natively.
   * EPSG:4326 queries return 0 features, so we convert to UTM first.
   */
  private buildBboxStrategies(lat: number, lon: number): { bbox: string; version: string; typeParam: string }[] {
    const { easting, northing } = this.wgs84ToUtm32(lat, lon);
    const utmDelta = 100; // ~100m radius in UTM meters
    const delta = 0.001;

    return [
      // EPSG:25832 (native CRS) – most likely to work
      {
        bbox: `${easting - utmDelta},${northing - utmDelta},${easting + utmDelta},${northing + utmDelta},urn:ogc:def:crs:EPSG::25832`,
        version: '2.0.0',
        typeParam: 'typeNames',
      },
      // WFS 2.0.0: lat,lon order with EPSG:4326
      {
        bbox: `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`,
        version: '2.0.0',
        typeParam: 'typeNames',
      },
      // WFS 2.0.0: lon,lat order (common deegree bug)
      {
        bbox: `${lon - delta},${lat - delta},${lon + delta},${lat + delta},urn:ogc:def:crs:EPSG::4326`,
        version: '2.0.0',
        typeParam: 'typeNames',
      },
    ];
  }

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

  private async tryWfsGml(
    typeName: string,
    strategy: { bbox: string; version: string; typeParam: string }
  ): Promise<NormalizedBRW | null> {
    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: strategy.version,
        request: 'GetFeature',
        [strategy.typeParam]: typeName,
        bbox: strategy.bbox,
        count: '5',
        maxFeatures: '5',
      });

      const url = `${this.wfsUrl}?${params}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return null;

      const xml = await res.text();
      if (xml.includes('ExceptionReport') || xml.includes('ServiceException')) return null;
      if (xml.includes('numberOfFeatures="0"') || xml.includes('numberReturned="0"')) return null;

      const wert = this.extractGmlValue(xml, ['BRW', 'brw', 'bodenrichtwert', 'brwkon']);
      if (!wert || wert <= 0 || wert > 500000) return null;

      return {
        wert,
        stichtag: this.extractGmlField(xml, ['STAG', 'stag', 'STICHTAG', 'stichtag']) || 'unbekannt',
        nutzungsart: this.extractGmlField(xml, ['NUTA', 'nutzungsart', 'NUTZUNG', 'nuta']) || 'unbekannt',
        entwicklungszustand: this.extractGmlField(xml, ['ENTW', 'entwicklungszustand', 'entw']) || 'B',
        zone: this.extractGmlField(xml, ['BRZNAME', 'WNUM', 'brw_zone', 'wnum']) || '',
        gemeinde: this.extractGmlField(xml, ['GENA', 'ORTST', 'gemeinde', 'gena', 'ortst']) || 'Hamburg',
        bundesland: 'Hamburg',
        quelle: 'BORIS-HH',
        lizenz: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
      };
    } catch {
      return null;
    }
  }

  /**
   * WMS GetFeatureInfo fallback.
   * Hamburg also has a WMS endpoint with different layer names.
   */
  private async tryWmsQuery(lat: number, lon: number): Promise<NormalizedBRW | null> {
    const wmsUrl = this.wfsUrl.replace('WFS', 'WMS');
    const delta = 0.001;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

    // Discover WMS layers
    let wmsLayers: string[] = [];
    try {
      const capParams = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetCapabilities',
      });
      const capRes = await fetch(`${wmsUrl}?${capParams}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(8000),
      });
      if (capRes.ok) {
        const capXml = await capRes.text();
        const allLayers = [...capXml.matchAll(/<Name>([^<]+)<\/Name>/gi)]
          .map(m => m[1].trim())
          .filter(n => n.length > 0 && n.length < 120);
        // Prefer brw_zoniert layers, then any brw_ layer
        wmsLayers = allLayers.filter(n =>
          n.includes('brw_zoniert') || n.includes('brw_zonal')
        );
        if (!wmsLayers.length) {
          wmsLayers = allLayers.filter(n =>
            n.includes('brw') && !n.includes('referenz') && !n.includes('beschriftung')
          );
        }
        if (wmsLayers.length > 0) {
          console.log(`HH WMS: Discovered layers: ${wmsLayers.slice(0, 5).join(', ')}`);
        }
      }
    } catch {
      // proceed with fallback layers
    }

    // Fallback layer candidates
    if (!wmsLayers.length) {
      wmsLayers = ['lgv_brw_zoniert_alle', 'Bodenrichtwert', '0'];
    }

    for (const layer of wmsLayers) {
      for (const fmt of ['text/xml', 'application/json', 'text/plain']) {
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
            INFO_FORMAT: fmt,
            FEATURE_COUNT: '5',
            STYLES: '',
            FORMAT: 'image/png',
          });

          const res = await fetch(`${wmsUrl}?${params}`, {
            headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
            signal: AbortSignal.timeout(8000),
          });

          if (!res.ok) continue;

          const text = await res.text();
          if (text.includes('ServiceException') || text.includes('ExceptionReport')) continue;
          if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) continue;
          if (text.trim().length < 30) continue;

          // Try JSON parse
          if (text.trimStart().startsWith('{')) {
            try {
              const json = JSON.parse(text);
              if (json.features?.length) {
                const f = json.features[0];
                const p = f.properties || {};
                const wertRaw = p.BRW ?? p.brw ?? p.bodenrichtwert ?? p.brwkon ?? 0;
                const wert = parseFloat(String(wertRaw));
                if (wert > 0 && wert <= 500_000) {
                  return {
                    wert,
                    stichtag: p.STAG || p.stag || p.stichtag || 'unbekannt',
                    nutzungsart: p.NUTA || p.nuta || p.nutzungsart || 'unbekannt',
                    entwicklungszustand: p.ENTW || p.entw || 'B',
                    zone: p.BRZNAME || p.WNUM || p.wnum || '',
                    gemeinde: p.GENA || p.ORTST || p.gena || p.ortst || 'Hamburg',
                    bundesland: 'Hamburg',
                    quelle: 'BORIS-HH (WMS)',
                    lizenz: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
                  };
                }
              }
            } catch {
              // not valid JSON, try XML/plain extraction
            }
          }

          // XML/plain extraction
          const wert = this.extractGmlValue(text, ['BRW', 'brw', 'bodenrichtwert', 'brwkon']);
          if (wert && wert > 0 && wert <= 500_000) {
            return {
              wert,
              stichtag: this.extractGmlField(text, ['STAG', 'stag', 'stichtag']) || 'unbekannt',
              nutzungsart: this.extractGmlField(text, ['NUTA', 'nuta', 'nutzungsart']) || 'unbekannt',
              entwicklungszustand: this.extractGmlField(text, ['ENTW', 'entw']) || 'B',
              zone: this.extractGmlField(text, ['BRZNAME', 'WNUM', 'wnum']) || '',
              gemeinde: this.extractGmlField(text, ['GENA', 'ORTST', 'gena', 'ortst']) || 'Hamburg',
              bundesland: 'Hamburg',
              quelle: 'BORIS-HH (WMS)',
              lizenz: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
            };
          }
        } catch {
          // try next format
        }
      }
    }
    return null;
  }

  /** Ermittelt alle FeatureType-Namen via GetCapabilities, priorisiert */
  private async getTypeNames(): Promise<string[]> {
    if (this.discoveredTypeName) return [this.discoveredTypeName];

    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetCapabilities',
      });

      const res = await fetch(`${this.wfsUrl}?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return this.fallbackTypeNames;

      const xml = await res.text();

      // Extract <Name> from <FeatureType> blocks
      const ftBlocks = [...xml.matchAll(
        /<(?:[a-zA-Z]*:)?FeatureType[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]*:)?FeatureType>/gi
      )];

      const typeMatches: string[] = [];
      for (const block of ftBlocks) {
        const nameMatch = block[1].match(
          /<(?:[a-zA-Z]*:)?Name[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]*:)?Name>/i
        );
        if (nameMatch) {
          const name = nameMatch[1].trim();
          if (name.length > 0 && name.length < 120) typeMatches.push(name);
        }
      }

      console.log(`HH WFS: Name-Suche: ${typeMatches.length} Treffer, FeatureType-Blöcke: ${ftBlocks.length}`);
      if (typeMatches.length > 0) {
        console.log(`HH WFS: Gefundene FeatureTypes: ${typeMatches.slice(0, 8).join(', ')}`);
      }

      if (typeMatches.length === 0) return this.fallbackTypeNames;

      // Prioritize: _zoniert_alle first, then _zoniert_ by year desc, then _zonen_
      const sorted: string[] = [];
      const alle = typeMatches.filter(n => n.includes('_alle'));
      const zoniert = typeMatches
        .filter(n => n.includes('_zoniert_') && !n.includes('_alle'))
        .sort((a, b) => b.localeCompare(a)); // descending year
      const zonen = typeMatches
        .filter(n => n.includes('_zonen_'))
        .sort((a, b) => b.localeCompare(a));
      const rest = typeMatches.filter(n =>
        !n.includes('_alle') && !n.includes('_zoniert_') && !n.includes('_zonen_')
      );
      sorted.push(...alle, ...zoniert, ...zonen, ...rest);

      // Only try first few to avoid excessive requests
      return sorted.slice(0, 5);
    } catch {
      return this.fallbackTypeNames.slice(0, 5);
    }
  }

  private extractGmlValue(xml: string, fields: string[]): number | null {
    for (const field of fields) {
      const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}>([\\d.,]+)<`, 'i');
      const match = xml.match(re);
      if (match) {
        let numStr = match[1];
        if (numStr.includes(',')) {
          numStr = numStr.replace(/\./g, '').replace(',', '.');
        }
        const val = parseFloat(numStr);
        if (val > 0 && isFinite(val)) return val;
      }
    }
    return null;
  }

  private extractGmlField(xml: string, fields: string[]): string | null {
    for (const field of fields) {
      const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}>([^<]+)<`, 'i');
      const match = xml.match(re);
      if (match) return match[1].trim();
    }
    return null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetCapabilities',
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
