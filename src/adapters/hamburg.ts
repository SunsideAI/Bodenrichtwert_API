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
      // TypeName dynamisch ermitteln falls noch nicht bekannt
      const typeName = await this.getTypeName();
      if (!typeName) {
        console.error('HH WFS: Kein Feature-Type gefunden, versuche Fallbacks');
        // Try all known fallback type names directly
        for (const fallback of this.fallbackTypeNames) {
          const result = await this.tryQueryWithType(lat, lon, fallback);
          if (result) {
            this.discoveredTypeName = fallback;
            return result;
          }
        }
        return null;
      }

      return await this.tryQueryWithType(lat, lon, typeName);
    } catch (err) {
      console.error('HH adapter error:', err);
      return null;
    }
  }

  private async tryQueryWithType(lat: number, lon: number, typeName: string): Promise<NormalizedBRW | null> {
    // Erst JSON versuchen
    const result = await this.tryJsonQuery(typeName, lat, lon);
    if (result) return result;

    // Dann GML Fallback
    return await this.tryGmlQuery(typeName, lat, lon);
  }

  private async tryJsonQuery(typeName: string, lat: number, lon: number): Promise<NormalizedBRW | null> {
    const delta = 0.0005;
    const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;

    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: typeName,
      bbox: bbox,
      outputFormat: 'application/json',
      count: '5',
    });

    const url = `${this.wfsUrl}?${params}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const text = await res.text();
    if (!text.trimStart().startsWith('{')) return null;

    const json = JSON.parse(text);
    if (!json.features?.length) return null;

    // Wohnbau-BRW bevorzugen (VBORIS Feld: NUTA oder nutzungsart)
    const wohn = json.features.find(
      (f: any) => {
        const nuta = f.properties?.NUTA || f.properties?.nuta || f.properties?.nutzungsart || '';
        return nuta.startsWith('W') || nuta.toLowerCase().includes('wohn');
      }
    ) || json.features[0];

    const p = wohn.properties;

    const wertRaw = p.BRW ?? p.brw ?? p.bodenrichtwert ?? p.wert;
    const wert = parseFloat(String(wertRaw ?? 0));
    if (!wert || wert <= 0 || wert > 500000) return null;

    return {
      wert,
      stichtag: p.STAG || p.stag || p.STICHTAG || p.stichtag || 'unbekannt',
      nutzungsart: p.NUTA || p.nutzungsart || p.NUTZUNG || 'unbekannt',
      entwicklungszustand: p.ENTW || p.entwicklungszustand || 'B',
      zone: p.BRZNAME || p.WNUM || p.brw_zone || '',
      gemeinde: p.GENA || p.ORTST || 'Hamburg',
      bundesland: 'Hamburg',
      quelle: 'BORIS-HH',
      lizenz: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
    };
  }

  private async tryGmlQuery(typeName: string, lat: number, lon: number): Promise<NormalizedBRW | null> {
    const delta = 0.0005;
    const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;

    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: typeName,
      bbox: bbox,
      count: '5',
    });

    const url = `${this.wfsUrl}?${params}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const xml = await res.text();
    if (xml.includes('ExceptionReport') || xml.includes('ServiceException')) return null;
    if (xml.includes('numberOfFeatures="0"') || xml.includes('numberReturned="0"')) return null;

    const wert = this.extractGmlValue(xml, ['BRW', 'brw', 'bodenrichtwert']);
    if (!wert || wert <= 0 || wert > 500000) return null;

    return {
      wert,
      stichtag: this.extractGmlField(xml, ['STAG', 'stag', 'STICHTAG', 'stichtag']) || 'unbekannt',
      nutzungsart: this.extractGmlField(xml, ['NUTA', 'nutzungsart', 'NUTZUNG']) || 'unbekannt',
      entwicklungszustand: this.extractGmlField(xml, ['ENTW', 'entwicklungszustand']) || 'B',
      zone: this.extractGmlField(xml, ['BRZNAME', 'WNUM', 'brw_zone']) || '',
      gemeinde: this.extractGmlField(xml, ['GENA', 'ORTST', 'gemeinde']) || 'Hamburg',
      bundesland: 'Hamburg',
      quelle: 'BORIS-HH',
      lizenz: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
    };
  }

  /** Ermittelt den FeatureType-Namen via GetCapabilities */
  private async getTypeName(): Promise<string | null> {
    if (this.discoveredTypeName) return this.discoveredTypeName;

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

      if (!res.ok) return null;

      const xml = await res.text();

      // Extract <Name> from <FeatureType> blocks.
      // The WFS 2.0.0 response uses default namespace so elements are plain <Name>.
      // Use multiline ([\s\S]*?) to handle names with whitespace/newlines.
      // Also try case-insensitive to handle <name> or <NAME> variants.

      // Strategy 1: Extract full FeatureType blocks, then Name from each
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

      // Strategy 2: Global <Name> search as fallback
      if (typeMatches.length === 0) {
        const globalNames = [...xml.matchAll(
          /<(?:[a-zA-Z]*:)?Name[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]*:)?Name>/gi
        )]
          .map(m => m[1].trim())
          .filter(n =>
            n.length > 0 &&
            n.length < 120 &&
            !n.includes('WFS_Capabilities') &&
            !n.includes('OperationsMetadata')
          );
        typeMatches.push(...globalNames);
      }

      console.log(`HH WFS: Name-Suche: ${typeMatches.length} Treffer, FeatureType-Blöcke: ${ftBlocks.length}`);

      if (typeMatches.length > 0) {
        console.log(`HH WFS: Gefundene FeatureTypes: ${typeMatches.slice(0, 8).join(', ')}`);
      }

      // Priorisierte Suche
      const preferred = typeMatches.find(n =>
        n.toLowerCase().includes('bodenrichtwert') ||
        n.toLowerCase().includes('aktuell') ||
        n.toLowerCase().includes('zonal')
      );

      this.discoveredTypeName = preferred || typeMatches[0] || null;
      return this.discoveredTypeName;
    } catch {
      return null;
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
