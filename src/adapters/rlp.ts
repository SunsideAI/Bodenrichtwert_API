import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Rheinland-Pfalz Adapter
 *
 * Nutzt den kostenlosen Basisdienst (OGC API Features) unter
 * /spatial-objects/299 mit der Collection "Bodenrichtwertzone_poly".
 *
 * WICHTIG: /spatial-objects/548 ist der Premiumdienst (401 Unauthorized).
 *          /spatial-objects/299 ist der Basisdienst (kostenlos, Open Data).
 *
 * Basisdienst liefert: bodenrichtwert (€/m²), nutzungsart, stichtag, zonennummer
 * CRS: EPSG:25832, bbox-Filter in WGS84 (EPSG:4326)
 *
 * Doku: https://geoportal.rlp.de/spatial-objects/299
 */
export class RheinlandPfalzAdapter implements BodenrichtwertAdapter {
  state = 'Rheinland-Pfalz';
  stateCode = 'RP';
  isFallback = false;

  private itemsUrl =
    'https://www.geoportal.rlp.de/spatial-objects/299/collections/Bodenrichtwertzone_poly/items';

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    try {
      // bbox-Filter: ~100m Rechteck um den Punkt (WGS84)
      const delta = 0.001;
      const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

      const url = `${this.itemsUrl}?bbox=${bbox}&f=json&limit=10`;
      console.log(`RLP Basisdienst: ${url}`);

      const res = await fetch(url, {
        headers: {
          'Accept': 'application/geo+json',
          'User-Agent': 'BRW-API/1.0 (lebenswert.de)',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.error(`RLP Basisdienst error: ${res.status} ${res.statusText}`);
        return null;
      }

      const json = await res.json() as any;
      console.log(`RLP: ${json.features?.length || 0} Bodenrichtwertzonen gefunden`);

      if (!json.features?.length) {
        return null;
      }

      // Wohnbau-BRW bevorzugen (VBORIS: "art" Feld, z.B. "W" oder "WR")
      const wohn = json.features.find(
        (f: any) => {
          const p = f.properties || {};
          const nutzung = p.art || p.nutzungsart || p.ART || '';
          return String(nutzung).startsWith('W') || String(nutzung).toLowerCase().includes('wohn');
        }
      ) || json.features[0];

      const p = wohn.properties;

      // DEBUG: Alle Properties loggen, um exakte Feldnamen zu ermitteln
      console.log('RLP Properties Keys:', Object.keys(p).join(', '));
      console.log('RLP Properties:', JSON.stringify(p, null, 2));

      // VBORIS-Feldnamen: wert, art, stichtag, entwicklungszustand, zonennummer
      // Fallback auf alternative Namen falls abweichend
      const brwValue = p.wert ?? p.bodenrichtwert ?? p.brw ?? p.BRW ?? p.richtwert ?? 0;
      const stichtag = p.stichtag ?? p.STICHTAG ?? p.datum ?? 'unbekannt';
      const nutzung = p.art ?? p.nutzungsart ?? p.ART ?? p.nutzung ?? 'unbekannt';
      const entw = p.entwicklungszustand ?? p.entw ?? p.ENTW ?? 'B';
      const zone = p.zonennummer ?? p.zone ?? p.ZONE ?? '';
      const gemeinde = p.gemeinde ?? p.ort ?? p.ortsteilName ?? '';

      return {
        wert: typeof brwValue === 'number' ? brwValue : parseFloat(brwValue) || 0,
        stichtag: String(stichtag),
        nutzungsart: String(nutzung),
        entwicklungszustand: String(entw),
        zone: String(zone),
        gemeinde: String(gemeinde),
        bundesland: 'Rheinland-Pfalz',
        quelle: 'BORIS-RLP Basisdienst',
        lizenz: '© LVermGeo RLP, dl-de/by-2-0',
      };
    } catch (err) {
      console.error('RLP adapter error:', err);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.itemsUrl}?limit=1&f=json`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
