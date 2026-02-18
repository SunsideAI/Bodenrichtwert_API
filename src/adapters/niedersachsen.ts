import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Niedersachsen Adapter
 *
 * Nutzt den LGLN OpenData WFS Endpunkt (doorman/noauth).
 * Auto-Discovery: Holt TypeNames aus GetCapabilities beim ersten Aufruf.
 * Versucht auch jahresspezifische Endpunkte (boris_2024_wfs, boris_2023_wfs).
 * Schema: VBORIS 2.0 / BRM 3.0 (boris namespace)
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: dl-de/by-2-0 (Namensnennung)
 */
export class NiedersachsenAdapter implements BodenrichtwertAdapter {
  state = 'Niedersachsen';
  stateCode = 'NI';
  isFallback = false;

  private baseUrl = 'https://opendata.lgln.niedersachsen.de/doorman/noauth';

  // Endpunkte in Prioritätsreihenfolge
  private endpoints = [
    'boris_wfs',
    'boris_2024_wfs',
    'boris_2023_wfs',
  ];

  // Cache für entdeckte TypeNames pro Endpunkt
  private discoveredTypeNames: Record<string, string[]> = {};

  // Nur BRW-relevante TypeNames (Zonal bevorzugt)
  private relevantTypePatterns = ['BodenrichtwertZonal', 'BodenrichtwertLagetypisch'];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    for (const endpoint of this.endpoints) {
      try {
        const result = await this.queryEndpoint(lat, lon, endpoint);
        if (result) return result;
      } catch (err) {
        console.warn(`NI ${endpoint} error:`, err);
      }
    }

    console.error('NI adapter: Kein Treffer mit allen Endpunkten');
    return null;
  }

  private async queryEndpoint(lat: number, lon: number, endpoint: string): Promise<NormalizedBRW | null> {
    const wfsUrl = `${this.baseUrl}/${endpoint}`;

    // TypeNames für diesen Endpunkt entdecken (nur beim ersten Mal)
    let typeNames = this.discoveredTypeNames[endpoint];
    if (!typeNames) {
      const allTypes = await this.discoverTypeNames(wfsUrl);
      // Nur BRW-relevante TypeNames filtern
      typeNames = allTypes.filter(t =>
        this.relevantTypePatterns.some(p => t.includes(p))
      );
      this.discoveredTypeNames[endpoint] = typeNames;
      console.log(`NI ${endpoint}: Using typeNames:`, typeNames);
    }

    if (typeNames.length === 0) return null;

    // Jeden TypeName versuchen (GML zuerst, da XtraServer kein JSON unterstützt)
    for (const typeName of typeNames) {
      try {
        const result = await this.fetchGml(wfsUrl, lat, lon, typeName);
        if (result) return result;
      } catch { /* next */ }
    }

    return null;
  }

  /** GetCapabilities abfragen und FeatureType-Namen extrahieren */
  private async discoverTypeNames(wfsUrl: string): Promise<string[]> {
    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetCapabilities',
      });

      const res = await fetch(`${wfsUrl}?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return [];

      const xml = await res.text();

      const typeNames: string[] = [];
      const nameRegex = /<(?:wfs:)?Name>([^<]+)<\/(?:wfs:)?Name>/g;
      let match;
      while ((match = nameRegex.exec(xml)) !== null) {
        const name = match[1].trim();
        if (name && !name.includes('WFS') && !name.includes('Service')) {
          typeNames.push(name);
        }
      }

      return typeNames;
    } catch (err) {
      console.warn('NI GetCapabilities error:', err);
      return [];
    }
  }

  /** GML GetFeature Abfrage mit VBORIS 2.0 Parsing */
  private async fetchGml(wfsUrl: string, lat: number, lon: number, typeName: string): Promise<NormalizedBRW | null> {
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

    const res = await fetch(`${wfsUrl}?${params}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const xml = await res.text();

    if (xml.includes('ExceptionReport') || xml.includes('ServiceException')) return null;
    if (xml.includes('numberOfFeatures="0"') || xml.includes('numberReturned="0"')) return null;

    // Parse alle Features und wähle den besten
    return this.parseBestFeature(xml);
  }

  /** Bestes Feature aus GML-Response wählen (Wohnbau bevorzugt) */
  private parseBestFeature(xml: string): NormalizedBRW | null {
    // Einzelne BodenrichtwertZonal/Lagetypisch Features extrahieren
    const featureRegex = /<boris:BR_Bodenrichtwert(?:Zonal|Lagetypisch)[^>]*>([\s\S]*?)<\/boris:BR_Bodenrichtwert(?:Zonal|Lagetypisch)>/g;
    const features: string[] = [];
    let match;
    while ((match = featureRegex.exec(xml)) !== null) {
      features.push(match[1]);
    }

    if (features.length === 0) {
      // Fallback: gesamtes XML als ein Feature behandeln
      features.push(xml);
    }

    // Wohnbau-Feature bevorzugen
    let bestFeature = features[0];
    for (const feature of features) {
      const nutzung = this.extractExactField(feature, 'art') ||
                       this.extractExactField(feature, 'nutzungsartBodenrichtwert') || '';
      if (nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn')) {
        bestFeature = feature;
        break;
      }
    }

    // VBORIS 2.0 Feldnamen (exakte Matches, keine Substrings!)
    const wert = this.extractExactNumber(bestFeature, 'bodenrichtwert');
    if (!wert || wert <= 0) {
      console.warn('NI: bodenrichtwert field not found or zero');
      return null;
    }

    const stichtag = this.extractExactField(bestFeature, 'stichtag') || 'unbekannt';

    // Nutzungsart: verschachtelt in boris:nutzung → boris:BR_Nutzung → boris:art
    const nutzungsart = this.extractExactField(bestFeature, 'art') ||
                         this.extractExactField(bestFeature, 'nutzungsartBodenrichtwert') ||
                         'unbekannt';

    const entwicklungszustand = this.extractExactField(bestFeature, 'entwicklungszustand') || 'B';
    const ortsteil = this.extractExactField(bestFeature, 'ortsteil') || '';

    const result: NormalizedBRW = {
      wert,
      stichtag,
      nutzungsart,
      entwicklungszustand,
      zone: '', // zone ist Geometrie in VBORIS 2.0, kein Textfeld
      gemeinde: ortsteil,
      bundesland: 'Niedersachsen',
      quelle: 'BORIS-NI (LGLN)',
      lizenz: '© LGLN, dl-de/by-2-0',
    };

    return result;
  }

  /**
   * Exakten Feldnamen aus GML extrahieren (numerisch).
   * Matched nur den exakten lokalen Elementnamen, nicht Substrings.
   * z.B. "bodenrichtwert" matched <boris:bodenrichtwert> aber NICHT <boris:bodenrichtwertklassifikation>
   */
  private extractExactNumber(xml: string, field: string): number | null {
    // Match: <ns:field> or <ns:field attr="..."> but NOT <ns:fieldSuffix>
    const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${field}(?:\\s[^>]*)?>([\\d.,]+)<`, 'i');
    const match = xml.match(re);
    if (match) {
      // Deutsche Zahlenformate: "100,50" → 100.50, "1.234,50" → 1234.50
      let numStr = match[1];
      if (numStr.includes(',')) {
        // Tausendertrennzeichen (Punkt) entfernen, Komma → Punkt
        numStr = numStr.replace(/\./g, '').replace(',', '.');
      }
      const val = parseFloat(numStr);
      if (val > 0 && isFinite(val)) return val;
    }
    return null;
  }

  /**
   * Exakten Feldnamen aus GML extrahieren (Text).
   * Matched nur den exakten lokalen Elementnamen, nicht Substrings.
   */
  private extractExactField(xml: string, field: string): string | null {
    const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${field}(?:\\s[^>]*)?>([^<]+)<`, 'i');
    const match = xml.match(re);
    if (match) return match[1].trim();
    return null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetCapabilities',
      });
      const res = await fetch(`${this.baseUrl}/boris_wfs?${params}`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
