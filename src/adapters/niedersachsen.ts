import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Niedersachsen Adapter
 *
 * Nutzt den LGLN OpenData WFS Endpunkt (doorman/noauth).
 * Server: XtraServer – unterstützt vermutlich kein JSON, daher GML-Parsing.
 * Daten: Bodenrichtwerte nach VBORIS-Kurzform (brw, stag, nuta, entw, gena, wnum)
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: dl-de/by-2-0 (Namensnennung)
 */
export class NiedersachsenAdapter implements BodenrichtwertAdapter {
  state = 'Niedersachsen';
  stateCode = 'NI';
  isFallback = false;

  private wfsUrl = 'https://opendata.lgln.niedersachsen.de/doorman/noauth/boris_wfs';

  // Mögliche TypeNames – XtraServer-Konvention variiert
  private typeNameCandidates = [
    'Bodenrichtwerte',
    'bodenrichtwerte',
    'BRW',
    'Bauland',
    'boris:bodenrichtwert',
  ];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    // Versuche zuerst JSON, dann GML für jeden TypeName-Kandidaten
    for (const typeName of this.typeNameCandidates) {
      try {
        const result = await this.tryJsonQuery(lat, lon, typeName);
        if (result) return result;
      } catch {
        // JSON fehlgeschlagen, versuche nächsten
      }

      try {
        const result = await this.tryGmlQuery(lat, lon, typeName);
        if (result) return result;
      } catch {
        // GML fehlgeschlagen, versuche nächsten TypeName
      }
    }

    console.error('NI adapter: Kein Treffer mit allen TypeName-Kandidaten');
    return null;
  }

  private async tryJsonQuery(lat: number, lon: number, typeName: string): Promise<NormalizedBRW | null> {
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
    // Prüfe ob es tatsächlich JSON ist
    if (!text.trimStart().startsWith('{') && !text.trimStart().startsWith('[')) return null;

    const json = JSON.parse(text);
    if (!json.features?.length) return null;

    // Wohnbau-BRW bevorzugen (VBORIS Kurzform: nuta, oder Langform: nutzungsart)
    const wohn = json.features.find(
      (f: any) => {
        const nutzung = f.properties?.nuta || f.properties?.NUTA || f.properties?.nutzungsart || f.properties?.NUTZUNG || '';
        return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
      }
    ) || json.features[0];

    const p = wohn.properties;
    return this.mapProperties(p);
  }

  private async tryGmlQuery(lat: number, lon: number, typeName: string): Promise<NormalizedBRW | null> {
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

    // Prüfe ob Fehler/Exception zurückkam
    if (xml.includes('ExceptionReport') || xml.includes('ServiceException')) return null;

    // Prüfe ob Features vorhanden
    if (xml.includes('numberOfFeatures="0"') || xml.includes('numberReturned="0"')) return null;

    // BRW-Wert aus GML extrahieren
    const wert = this.extractGmlValue(xml, ['brw', 'BRW', 'bodenrichtwert', 'Bodenrichtwert', 'wert']);
    if (!wert || wert <= 0) return null;

    return {
      wert,
      stichtag: this.extractGmlField(xml, ['stag', 'STAG', 'stichtag', 'STICHTAG']) || 'unbekannt',
      nutzungsart: this.extractGmlField(xml, ['nuta', 'NUTA', 'nutzungsart', 'NUTZUNG']) || 'unbekannt',
      entwicklungszustand: this.extractGmlField(xml, ['entw', 'ENTW', 'entwicklungszustand']) || 'B',
      zone: this.extractGmlField(xml, ['wnum', 'WNUM', 'zone', 'ZONE', 'brw_zone']) || '',
      gemeinde: this.extractGmlField(xml, ['gena', 'GENA', 'gemeinde', 'GEMEINDE']) || '',
      bundesland: 'Niedersachsen',
      quelle: 'BORIS-NI (LGLN)',
      lizenz: '© LGLN, dl-de/by-2-0',
    };
  }

  /** Properties aus JSON-Response mappen (VBORIS Kurz- und Langform) */
  private mapProperties(p: any): NormalizedBRW {
    return {
      wert: p.brw || p.BRW || p.bodenrichtwert || p.wert || 0,
      stichtag: p.stag || p.STAG || p.stichtag || p.STICHTAG || 'unbekannt',
      nutzungsart: p.nuta || p.NUTA || p.nutzungsart || p.NUTZUNG || 'unbekannt',
      entwicklungszustand: p.entw || p.ENTW || p.entwicklungszustand || 'B',
      zone: p.wnum || p.WNUM || p.zone || p.brw_zone || p.ZONE || '',
      gemeinde: p.gena || p.GENA || p.gemeinde || p.GEMEINDE || p.gemeinde_name || '',
      bundesland: 'Niedersachsen',
      quelle: 'BORIS-NI (LGLN)',
      lizenz: '© LGLN, dl-de/by-2-0',
    };
  }

  /** Numerischen Wert aus GML-XML extrahieren (erster Treffer aus Kandidaten-Liste) */
  private extractGmlValue(xml: string, fields: string[]): number | null {
    for (const field of fields) {
      const re = new RegExp(`<[^>]*:?${field}[^>]*>([\\d.,]+)<`, 'i');
      const match = xml.match(re);
      if (match) {
        const val = parseFloat(match[1].replace(',', '.'));
        if (val > 0) return val;
      }
    }
    return null;
  }

  /** Text-Wert aus GML-XML extrahieren (erster Treffer aus Kandidaten-Liste) */
  private extractGmlField(xml: string, fields: string[]): string | null {
    for (const field of fields) {
      const re = new RegExp(`<[^>]*:?${field}[^>]*>([^<]+)<`, 'i');
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
