import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Rheinland-Pfalz Adapter
 *
 * Nutzt den WMS "Generalisierte Bodenrichtwerte" GetFeatureInfo-Endpunkt.
 *
 * Hintergrund:
 *   - /spatial-objects/548 (OGC API) = Premiumdienst → 401 Unauthorized
 *   - /spatial-objects/299 (OGC API) = Basisdienst → nur Zonengeometrie, keine Werte
 *   - geo5.service24.rlp.de WMS GetFeatureInfo = liefert generalisierte BRW-Werte
 *
 * WMS: https://geo5.service24.rlp.de/wms/genbori_rp.fcgi
 * Layer: Wohnbauflaechen, Gemischte_Bauflaechen, Gewerbeflaechen, etc.
 */
export class RheinlandPfalzAdapter implements BodenrichtwertAdapter {
  state = 'Rheinland-Pfalz';
  stateCode = 'RP';
  isFallback = false;

  private wmsUrl = 'https://geo5.service24.rlp.de/wms/genbori_rp.fcgi';

  // Layer-Priorität: Wohnbau zuerst, dann gemischt
  private layers = ['Wohnbauflaechen', 'Gemischte_Bauflaechen'];

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    for (const layer of this.layers) {
      try {
        const result = await this.queryWmsLayer(lat, lon, layer);
        if (result) return result;
      } catch (err) {
        console.warn(`RLP WMS ${layer} error:`, err);
      }
    }

    console.error('RLP adapter: Kein Treffer in allen WMS-Layern');
    return null;
  }

  private async queryWmsLayer(
    lat: number,
    lon: number,
    layer: string,
  ): Promise<NormalizedBRW | null> {
    // Kleines Fenster um den Punkt (EPSG:4326, lon/lat Achsenreihenfolge für WMS 1.1.1)
    const delta = 0.001;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

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
      INFO_FORMAT: 'text/xml',
      FEATURE_COUNT: '5',
      STYLES: '',
      FORMAT: 'image/png',
      TRANSPARENT: 'TRUE',
      EXCEPTIONS: 'application/vnd.ogc.se_xml',
    });

    const url = `${this.wmsUrl}?${params}`;
    console.log(`RLP WMS GetFeatureInfo: ${layer} → ${url}`);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`RLP WMS ${layer}: HTTP ${res.status}`);
      // Bei text/xml-Fehler: versuche text/html
      return this.queryWmsHtml(lat, lon, layer);
    }

    const text = await res.text();
    console.log(`RLP WMS ${layer} XML Response (first 500):`, text.substring(0, 500));

    // XML-Response parsen
    const wert = this.extractValueFromXml(text);
    if (wert && wert > 0) {
      return {
        wert,
        stichtag: this.extractFieldFromXml(text, 'stichtag') || 'aktuell',
        nutzungsart: layer === 'Wohnbauflaechen' ? 'W' : 'M',
        entwicklungszustand: 'B',
        zone: this.extractFieldFromXml(text, 'zone') || this.extractFieldFromXml(text, 'gemeinde') || '',
        gemeinde: this.extractFieldFromXml(text, 'gemeinde') || this.extractFieldFromXml(text, 'name') || '',
        bundesland: 'Rheinland-Pfalz',
        quelle: `Generalisierte BRW RLP (${layer})`,
        lizenz: '© LVermGeo RLP',
      };
    }

    // Fallback: HTML-Format versuchen
    return this.queryWmsHtml(lat, lon, layer);
  }

  private async queryWmsHtml(
    lat: number,
    lon: number,
    layer: string,
  ): Promise<NormalizedBRW | null> {
    const delta = 0.001;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

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
      INFO_FORMAT: 'text/html',
      FEATURE_COUNT: '5',
      STYLES: '',
      FORMAT: 'image/png',
      TRANSPARENT: 'TRUE',
      EXCEPTIONS: 'application/vnd.ogc.se_xml',
    });

    const url = `${this.wmsUrl}?${params}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`RLP WMS HTML ${layer}: HTTP ${res.status}`);
      return null;
    }

    const html = await res.text();
    console.log(`RLP WMS ${layer} HTML Response (first 500):`, html.substring(0, 500));

    // EUR/m²-Wert aus HTML extrahieren (z.B. "100 EUR/m²" oder "85 €/m²")
    const wert = this.extractValueFromHtml(html);
    if (wert && wert > 0) {
      const gemeinde = this.extractGemeindeFromHtml(html);
      return {
        wert,
        stichtag: 'aktuell',
        nutzungsart: layer === 'Wohnbauflaechen' ? 'W' : 'M',
        entwicklungszustand: 'B',
        zone: gemeinde,
        gemeinde,
        bundesland: 'Rheinland-Pfalz',
        quelle: `Generalisierte BRW RLP (${layer})`,
        lizenz: '© LVermGeo RLP',
      };
    }

    return null;
  }

  /** Bodenrichtwert aus XML-GetFeatureInfo extrahieren */
  private extractValueFromXml(xml: string): number | null {
    // Verschiedene XML-Formate: <brw>85</brw>, <wert>85.0</wert>, <Bodenrichtwert>85</Bodenrichtwert>
    const patterns = [
      /<(?:brw|wert|bodenrichtwert|richtwert|value|BRW|Wert|Bodenrichtwert)>([\d.,]+)<\//i,
      /(?:brw|wert|bodenrichtwert)["']\s*(?:value)?[=:]\s*["']?([\d.,]+)/i,
      /([\d]+)\s*(?:EUR\/m|€\/m)/i,
    ];
    for (const pattern of patterns) {
      const match = xml.match(pattern);
      if (match) {
        const val = parseFloat(match[1].replace(',', '.'));
        if (val > 0) return val;
      }
    }
    return null;
  }

  /** Feldwert aus XML extrahieren */
  private extractFieldFromXml(xml: string, field: string): string | null {
    const re = new RegExp(`<${field}[^>]*>([^<]+)</${field}>`, 'i');
    const match = xml.match(re);
    return match ? match[1].trim() : null;
  }

  /** BRW-Wert aus HTML-GetFeatureInfo extrahieren */
  private extractValueFromHtml(html: string): number | null {
    // Typische Muster: "100 EUR/m²", "85 €/m²", "120 EUR/qm"
    const patterns = [
      /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m²|€\/m²|EUR\/qm|€\/qm|EUR\/m&sup2;)/i,
      /(?:Bodenrichtwert|BRW|Wert|Richtwert)[:\s]*(\d+(?:[.,]\d+)?)/i,
      /(\d+(?:[.,]\d+)?)\s*(?:EUR|€)/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const val = parseFloat(match[1].replace(',', '.'));
        if (val > 0) return val;
      }
    }
    return null;
  }

  /** Gemeindename aus HTML-GetFeatureInfo extrahieren */
  private extractGemeindeFromHtml(html: string): string {
    const patterns = [
      /(?:Gemeinde|Ort|Stadt|Ortsgemeinde|Verbandsgemeinde)\s+([A-ZÄÖÜa-zäöüß\-\s]+?)(?:\s*<|\s*\d)/,
      /(?:Gemeinde|Stadt|Ortsgemeinde)[:\s]*([^<\n,]+)/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return match[1].trim();
    }
    return '';
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
