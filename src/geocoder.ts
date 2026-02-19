import { plzToState } from './utils/plz-map.js';

export interface GeoResult {
  lat: number;
  lon: number;
  state: string;
  city: string;           // Stadt/Gemeinde (z.B. "München", "Stuttgart")
  displayName: string;
}

const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';

/**
 * Geocode eine Adresse zu Koordinaten + Bundesland.
 * Strategie: Nominatim als Primary, PLZ-Tabelle als Bundesland-Fallback.
 */
export async function geocode(
  strasse: string,
  plz: string,
  ort: string
): Promise<GeoResult | null> {
  // Versuch 1: Nominatim mit voller Adresse
  const query = [strasse, plz, ort].filter(Boolean).join(', ');

  try {
    const url = new URL('/search', NOMINATIM_URL);
    url.searchParams.set('q', query + ', Deutschland');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('countrycodes', 'de');

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'BRW-API/1.0 (lebenswert.de)',
        'Accept-Language': 'de',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = await res.json() as any[];

      if (data.length > 0) {
        const result = data[0];
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        // Bundesland aus Nominatim oder PLZ-Fallback
        const state = result.address?.state
          || plzToState(plz)
          || 'Unbekannt';

        // Stadt: city > town > municipality > county
        const city = result.address?.city
          || result.address?.town
          || result.address?.municipality
          || result.address?.county
          || ort
          || '';

        return {
          lat,
          lon,
          state: normalizeStateName(state),
          city,
          displayName: result.display_name || query,
        };
      }
    }
  } catch (err) {
    console.warn('Nominatim error, trying PLZ fallback:', err);
  }

  // Versuch 2: PLZ-Fallback (gibt zumindest Bundesland zurück)
  // Ohne Koordinaten können wir keinen WFS-Call machen → null
  if (plz) {
    const state = plzToState(plz);
    if (state) {
      console.warn(`Nominatim failed, PLZ ${plz} → ${state} (keine Koordinaten)`);
    }
  }

  return null;
}

/**
 * Normalisiert Bundesland-Namen (Nominatim gibt teils verschiedene Schreibweisen)
 */
function normalizeStateName(name: string): string {
  const mapping: Record<string, string> = {
    'baden-württemberg': 'Baden-Württemberg',
    'bayern': 'Bayern',
    'berlin': 'Berlin',
    'brandenburg': 'Brandenburg',
    'bremen': 'Bremen',
    'hamburg': 'Hamburg',
    'hessen': 'Hessen',
    'mecklenburg-vorpommern': 'Mecklenburg-Vorpommern',
    'niedersachsen': 'Niedersachsen',
    'nordrhein-westfalen': 'Nordrhein-Westfalen',
    'rheinland-pfalz': 'Rheinland-Pfalz',
    'saarland': 'Saarland',
    'sachsen': 'Sachsen',
    'sachsen-anhalt': 'Sachsen-Anhalt',
    'schleswig-holstein': 'Schleswig-Holstein',
    'thüringen': 'Thüringen',
  };

  return mapping[name.toLowerCase()] || name;
}
