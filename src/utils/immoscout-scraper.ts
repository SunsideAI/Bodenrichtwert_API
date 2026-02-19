/**
 * ImmoScout24 Atlas Scraper (TypeScript)
 *
 * Portiert die Kernlogik des Python-Scrapers (SunsideAI/Bodenrichtwer_Scraper)
 * nach TypeScript. Extrahiert _atlas_initialState JSON aus ImmoScout Atlas-Seiten
 * und gibt strukturierte Preisdaten zurück.
 *
 * Quelle: atlas.immobilienscout24.de/orte/deutschland/{bundesland}/{stadt}
 */

export const ATLAS_BASE = 'https://atlas.immobilienscout24.de';

// ─── Rotierende User-Agents (aus Python-Scraper) ──────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
];

function getRandomHeaders(): Record<string, string> {
  return {
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'DNT': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
  };
}

// ─── Interfaces ────────────────────────────────────────────────────────────

export interface ImmoScoutPrices {
  stadt: string;
  stadtteil: string;
  bundesland: string;
  haus_kauf_preis: number | null;
  haus_kauf_min: number | null;
  haus_kauf_max: number | null;
  wohnung_kauf_preis: number | null;
  wohnung_kauf_min: number | null;
  wohnung_kauf_max: number | null;
  jahr: number;
  quartal: number;
  lat: number;
  lng: number;
}

// ─── URL-Slugifizierung ────────────────────────────────────────────────────

/**
 * Konvertiert einen deutschen Ortsnamen in einen ImmoScout-URL-Slug.
 * ImmoScout nutzt echte Unicode-Zeichen (ü, ö, ä, ß) in URLs:
 *   "München" → "münchen"  (NICHT "muenchen"!)
 *   "Baden-Württemberg" → "baden-württemberg"
 * fetch() URL-encodiert automatisch: "münchen" → "m%C3%BCnchen"
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')              // Leerzeichen → Bindestriche
    .replace(/[^a-zäöüß0-9-]/g, '')   // Sonderzeichen entfernen, Umlaute behalten
    .replace(/-+/g, '-')              // Doppelte Bindestriche
    .replace(/^-|-$/g, '');           // Führende/nachfolgende Bindestriche
}

// ─── _atlas_initialState Extraktion ────────────────────────────────────────

/**
 * Extrahiert das _atlas_initialState JSON-Objekt aus dem HTML.
 * Verwendet die gleiche Brace-Depth-Logik wie der Python-Scraper.
 */
function extractInitialState(html: string): Record<string, any> | null {
  const marker = /var\s+_atlas_initialState\s*=\s*/;
  const match = marker.exec(html);
  if (!match) return null;

  const start = match.index + match[0].length;
  let depth = 0;
  let i = start;

  while (i < html.length) {
    const ch = html[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.substring(start, i + 1));
        } catch {
          return null;
        }
      }
    } else if (ch === '"') {
      // String überspringen (escaped quotes beachten)
      i++;
      while (i < html.length && html[i] !== '"') {
        if (html[i] === '\\') i++; // escaped character
        i++;
      }
    }
    i++;
  }

  return null;
}

// ─── Preisdaten-Extraktion ─────────────────────────────────────────────────

interface PriceEntry {
  price: number | null;
  min: number | null;
  max: number | null;
  year: number;
  quarter: number;
}

function extractPriceForType(
  pricesDict: Record<string, any>,
  propertyType: string,
): PriceEntry {
  const typeData = pricesDict?.[propertyType] || {};
  const prices = typeData?.prices || {};
  return {
    price: typeof prices.price === 'number' ? prices.price : null,
    min: typeof prices.leastExpensive === 'number' ? prices.leastExpensive : null,
    max: typeof prices.mostExpensive === 'number' ? prices.mostExpensive : null,
    year: prices.year || new Date().getFullYear(),
    quarter: prices.quarter || Math.ceil((new Date().getMonth() + 1) / 3),
  };
}

/**
 * Extrahiert die Preise auf Stadt-Ebene aus dem initialState.
 * Die "eigenen" Preise stehen in state.ownPrices oder ähnlich.
 */
function extractOwnPrices(state: Record<string, any>): {
  haus: PriceEntry;
  wohnung: PriceEntry;
} | null {
  // Variante 1: ownPrices
  const ownPrices = state.ownPrices || state.prices;
  if (ownPrices) {
    return {
      haus: extractPriceForType(ownPrices, 'HOUSE_BUY'),
      wohnung: extractPriceForType(ownPrices, 'APARTMENT_BUY'),
    };
  }

  // Variante 2: priceTableData.data[0] (erstes Element = Stadt-Durchschnitt)
  const tableData = state.priceTableData?.data;
  if (tableData && tableData.length > 0) {
    const first = tableData[0].prices || {};
    return {
      haus: extractPriceForType(first, 'HOUSE_BUY'),
      wohnung: extractPriceForType(first, 'APARTMENT_BUY'),
    };
  }

  return null;
}

/**
 * Extrahiert die Geo-Hierarchie (Bundesland, Stadt, Stadtteil)
 */
function extractGeoHierarchy(state: Record<string, any>): {
  bundesland: string;
  stadt: string;
  stadtteil: string;
  lat: number;
  lng: number;
} {
  const geo = state.geoHierarchy || {};
  const loc = state.location || {};

  return {
    bundesland: geo.federalState || geo.bundesland || '',
    stadt: geo.city || geo.stadt || loc.city || '',
    stadtteil: geo.district || geo.stadtteil || loc.district || '',
    lat: loc.latitude || loc.lat || 0,
    lng: loc.longitude || loc.lng || 0,
  };
}

// ─── Haupt-Scraping-Funktion ──────────────────────────────────────────────

/**
 * Scrapt ImmoScout Atlas für eine Stadt und gibt Preisdaten zurück.
 *
 * @param bundeslandSlug - z.B. "bayern", "baden-wuerttemberg"
 * @param stadtSlug - z.B. "muenchen", "stuttgart"
 * @param stadtteilSlug - optional: z.B. "schwabing"
 */
export async function scrapeImmoScoutAtlas(
  bundeslandSlug: string,
  stadtSlug: string,
  stadtteilSlug?: string,
): Promise<ImmoScoutPrices | null> {
  let url = `${ATLAS_BASE}/orte/deutschland/${bundeslandSlug}/${stadtSlug}`;
  if (stadtteilSlug) url += `/${stadtteilSlug}`;

  console.log(`ImmoScout: Fetching ${url}`);

  try {
    const res = await fetch(url, {
      headers: getRandomHeaders(),
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!res.ok) {
      console.warn(`ImmoScout: HTTP ${res.status} for ${url}`);
      return null;
    }

    const html = await res.text();
    if (html.length < 1000) {
      console.warn('ImmoScout: Response too short, likely blocked');
      return null;
    }

    // _atlas_initialState extrahieren
    const state = extractInitialState(html);
    if (!state) {
      console.warn('ImmoScout: _atlas_initialState not found in HTML');
      return null;
    }

    // Geo-Hierarchie
    const geo = extractGeoHierarchy(state);

    // Eigene Preise (Stadt-Ebene)
    const prices = extractOwnPrices(state);
    if (!prices) {
      console.warn('ImmoScout: No price data found in state');
      return null;
    }

    const haus = prices.haus;
    const wohnung = prices.wohnung;

    return {
      stadt: geo.stadt || stadtSlug,
      stadtteil: geo.stadtteil || stadtteilSlug || '',
      bundesland: geo.bundesland || bundeslandSlug,
      haus_kauf_preis: haus.price,
      haus_kauf_min: haus.min,
      haus_kauf_max: haus.max,
      wohnung_kauf_preis: wohnung.price,
      wohnung_kauf_min: wohnung.min,
      wohnung_kauf_max: wohnung.max,
      jahr: haus.year || wohnung.year,
      quartal: haus.quarter || wohnung.quarter,
      lat: geo.lat,
      lng: geo.lng,
    };
  } catch (err) {
    console.error(`ImmoScout: Fetch error for ${url}:`, err);
    return null;
  }
}

/**
 * Scrapt die Stadtteile einer Stadt und gibt eine Liste zurück.
 * Nützlich um den nächsten Stadtteil per Koordinaten zu finden.
 */
export async function scrapeImmoScoutDistricts(
  bundeslandSlug: string,
  stadtSlug: string,
): Promise<ImmoScoutPrices[]> {
  const url = `${ATLAS_BASE}/orte/deutschland/${bundeslandSlug}/${stadtSlug}`;
  console.log(`ImmoScout: Fetching districts from ${url}`);

  try {
    const res = await fetch(url, {
      headers: getRandomHeaders(),
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!res.ok) return [];

    const html = await res.text();
    const state = extractInitialState(html);
    if (!state) return [];

    const geo = extractGeoHierarchy(state);
    const tableData: any[] = state.priceTableData?.data || [];
    const results: ImmoScoutPrices[] = [];

    for (const district of tableData) {
      const name = district.name || '';
      const pricesRaw = district.prices || {};

      const haus = extractPriceForType(pricesRaw, 'HOUSE_BUY');
      const wohnung = extractPriceForType(pricesRaw, 'APARTMENT_BUY');

      if (!haus.price && !wohnung.price) continue;

      results.push({
        stadt: geo.stadt || stadtSlug,
        stadtteil: name,
        bundesland: geo.bundesland || bundeslandSlug,
        haus_kauf_preis: haus.price,
        haus_kauf_min: haus.min,
        haus_kauf_max: haus.max,
        wohnung_kauf_preis: wohnung.price,
        wohnung_kauf_min: wohnung.min,
        wohnung_kauf_max: wohnung.max,
        jahr: haus.year || wohnung.year,
        quartal: haus.quarter || wohnung.quarter,
        lat: 0, // District-Level coordinates not available in table
        lng: 0,
      });
    }

    return results;
  } catch (err) {
    console.error(`ImmoScout: District fetch error:`, err);
    return [];
  }
}
