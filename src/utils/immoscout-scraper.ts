/**
 * ImmoScout24 Atlas + Suche Scraper (TypeScript)
 *
 * Portiert die Kernlogik des Python-Scrapers (SunsideAI/Bodenrichtwer_Scraper)
 * nach TypeScript. Extrahiert _atlas_initialState JSON aus ImmoScout Atlas-Seiten
 * und gibt strukturierte Preisdaten zurück.
 *
 * Quelle: atlas.immobilienscout24.de/orte/deutschland/{bundesland}/{stadt}
 * Fallback: IS24 Mobile API (api.mobile.immobilienscout24.de/search/list)
 */

export const ATLAS_BASE = 'https://atlas.immobilienscout24.de';
const MOBILE_API = 'https://api.mobile.immobilienscout24.de';
const MOBILE_UA = 'ImmoScout_27.12_26.2_._';

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
  // Kaufpreise (€/m²)
  haus_kauf_preis: number | null;
  haus_kauf_min: number | null;
  haus_kauf_max: number | null;
  wohnung_kauf_preis: number | null;
  wohnung_kauf_min: number | null;
  wohnung_kauf_max: number | null;
  // Mietpreise (€/m²/Monat)
  haus_miete_preis: number | null;
  haus_miete_min: number | null;
  haus_miete_max: number | null;
  wohnung_miete_preis: number | null;
  wohnung_miete_min: number | null;
  wohnung_miete_max: number | null;
  // Temporal
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
  haus_kauf: PriceEntry;
  wohnung_kauf: PriceEntry;
  haus_miete: PriceEntry;
  wohnung_miete: PriceEntry;
} | null {
  // Variante 1: ownPrices
  const ownPrices = state.ownPrices || state.prices;
  if (ownPrices) {
    return {
      haus_kauf: extractPriceForType(ownPrices, 'HOUSE_BUY'),
      wohnung_kauf: extractPriceForType(ownPrices, 'APARTMENT_BUY'),
      haus_miete: extractPriceForType(ownPrices, 'HOUSE_RENT'),
      wohnung_miete: extractPriceForType(ownPrices, 'APARTMENT_RENT'),
    };
  }

  // Variante 2: priceTableData.data[0] (erstes Element = Stadt-Durchschnitt)
  const tableData = state.priceTableData?.data;
  if (tableData && tableData.length > 0) {
    const first = tableData[0].prices || {};
    return {
      haus_kauf: extractPriceForType(first, 'HOUSE_BUY'),
      wohnung_kauf: extractPriceForType(first, 'APARTMENT_BUY'),
      haus_miete: extractPriceForType(first, 'HOUSE_RENT'),
      wohnung_miete: extractPriceForType(first, 'APARTMENT_RENT'),
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

    return {
      stadt: geo.stadt || stadtSlug,
      stadtteil: geo.stadtteil || stadtteilSlug || '',
      bundesland: geo.bundesland || bundeslandSlug,
      haus_kauf_preis: prices.haus_kauf.price,
      haus_kauf_min: prices.haus_kauf.min,
      haus_kauf_max: prices.haus_kauf.max,
      wohnung_kauf_preis: prices.wohnung_kauf.price,
      wohnung_kauf_min: prices.wohnung_kauf.min,
      wohnung_kauf_max: prices.wohnung_kauf.max,
      haus_miete_preis: prices.haus_miete.price,
      haus_miete_min: prices.haus_miete.min,
      haus_miete_max: prices.haus_miete.max,
      wohnung_miete_preis: prices.wohnung_miete.price,
      wohnung_miete_min: prices.wohnung_miete.min,
      wohnung_miete_max: prices.wohnung_miete.max,
      jahr: prices.haus_kauf.year || prices.wohnung_kauf.year,
      quartal: prices.haus_kauf.quarter || prices.wohnung_kauf.quarter,
      lat: geo.lat,
      lng: geo.lng,
    };
  } catch (err) {
    console.error(`ImmoScout: Fetch error for ${url}:`, err);
    return null;
  }
}

// ─── IS24 Mobile API Suche (Fallback für Atlas-Lücken) ──────────────────
// Reverse-engineered Mobile API (Quellen: orangecoding/fredy, SunsideAI/Mutzel_Scraper)
// Benötigt KEIN OAuth/Session — nur den Mobile-User-Agent.

interface SearchListing {
  price: number;       // Gesamtpreis in €
  livingSpace: number; // Wohnfläche in m²
  pricePerSqm: number; // €/m²
}

/**
 * Baut den IS24-Geocode-Pfad-Slug für einen Landkreis.
 * "Landkreis Gifhorn" → "gifhorn-kreis"
 * "Kreis Soest" → "soest-kreis"
 * "Region Hannover" → "region-hannover"
 * "" (kreisfrei) → ""
 */
export function buildSearchKreisSlug(county: string): string {
  if (!county) return '';

  const isLandkreis = /^(Landkreis|Landkr\.|Kreis|Lkr\.)\s+/i.test(county);
  const isRegion = /^Region\s+/i.test(county);

  if (isRegion) {
    return slugify(county); // "Region Hannover" → "region-hannover"
  }

  const kreisname = county.replace(/^(Landkreis|Landkr\.|Kreis|Lkr\.)\s+/i, '').trim();
  if (!kreisname) return '';

  const slug = slugify(kreisname);
  return isLandkreis ? `${slug}-kreis` : slug;
}

/**
 * Einzelne Mobile-API-Suche für einen Immobilientyp.
 * POST /search/list?searchType=region&realestatetype={type}&geocodes={geo}
 */
async function mobileSearch(geocode: string, realestatetype: string): Promise<SearchListing[]> {
  const params = new URLSearchParams({
    searchType: 'region',
    realestatetype,
    geocodes: geocode,
    pagenumber: '1',
  });
  const url = `${MOBILE_API}/search/list?${params}`;

  console.log(`ImmoScout Mobile: POST ${realestatetype} geocode=${geocode}`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': MOBILE_UA,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Connection': 'keep-alive',
      },
      body: JSON.stringify({
        supportedResultListTypes: [],
        userData: {},
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`ImmoScout Mobile: HTTP ${res.status} for ${realestatetype}`);
      return [];
    }

    const data = await res.json() as any;
    const listings: SearchListing[] = [];

    // Response: items[] filtern nach type === 'EXPOSE_RESULT'
    const items: any[] = data?.items || data?.resultlistEntries?.[0]?.resultlistEntry || [];

    for (const item of items) {
      // fredy-Format: item.type === 'EXPOSE_RESULT' → item.expose.item
      const expose = item?.type === 'EXPOSE_RESULT'
        ? item?.expose?.item
        : item;

      if (!expose) continue;

      let price = 0;
      let area = 0;

      // Attributes-Array durchsuchen (Mobile-API-Format)
      const attrSections: any[] = expose?.attributes || expose?.sections || [];
      for (const section of attrSections) {
        const attrs: any[] = section?.attributes || (Array.isArray(section) ? section : [section]);
        for (const attr of attrs) {
          const label = String(attr?.label || '').toLowerCase();
          const text = String(attr?.text || attr?.value || '');

          if (label.includes('kaufpreis') || label.includes('preis')) {
            price = parseFloat(text.replace(/[^\d,]/g, '').replace(',', '.'));
          }
          if (label.includes('wohnfläche') || label.includes('fläche ca')) {
            area = parseFloat(text.replace(/[^\d,]/g, '').replace(',', '.'));
          }
        }
      }

      // Alternativ: direkte Felder (Mutzel_Scraper-Format)
      if (!price && expose?.price) {
        price = typeof expose.price === 'number' ? expose.price : parseFloat(String(expose.price).replace(/[^\d,]/g, '').replace(',', '.'));
      }
      if (!area && expose?.livingSpace) {
        area = typeof expose.livingSpace === 'number' ? expose.livingSpace : parseFloat(String(expose.livingSpace).replace(/[^\d,]/g, '').replace(',', '.'));
      }

      if (price > 10000 && area > 10) {
        listings.push({
          price,
          livingSpace: area,
          pricePerSqm: Math.round(price / area),
        });
      }
    }

    console.log(`ImmoScout Mobile: ${listings.length} Listings (${realestatetype})`);
    return listings;
  } catch (err) {
    console.warn(`ImmoScout Mobile: Fetch error (${realestatetype}):`, err);
    return [];
  }
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * IS24 Mobile API Suche: Aggregiert Listing-Preise zu Marktdaten.
 * Fallback für Orte ohne Atlas-Daten (z.B. Meine, Gifhorn-Kreis).
 *
 * Geocode-Pfad: /de/{bundesland}/{kreis}/{ort}
 */
export async function scrapeImmoScoutSearch(
  bundeslandSlug: string,
  kreisSlug: string | undefined,
  ortSlug: string,
  ortName: string,
): Promise<ImmoScoutPrices | null> {
  // Geocode-Pfad bauen: /de/{bundesland}/{kreis}/{ort}
  const geoParts = ['/de', bundeslandSlug];
  if (kreisSlug) geoParts.push(kreisSlug);
  geoParts.push(ortSlug);
  const geocode = geoParts.join('/');

  // Haus + Wohnung parallel suchen
  const [hausListings, wohnungListings] = await Promise.all([
    mobileSearch(geocode, 'housebuy'),
    mobileSearch(geocode, 'apartmentbuy'),
  ]);

  const total = hausListings.length + wohnungListings.length;
  if (total === 0) {
    console.warn(`ImmoScout Mobile: Keine Listings für ${ortName} (${geocode})`);
    return null;
  }

  const now = new Date();
  const hausPreise = hausListings.map(l => l.pricePerSqm);
  const wohnungPreise = wohnungListings.map(l => l.pricePerSqm);

  console.log(`ImmoScout Mobile: ${ortName} → ${hausListings.length} Häuser (Median ${hausPreise.length ? median(hausPreise) : '-'} €/m²), ${wohnungListings.length} Wohnungen (Median ${wohnungPreise.length ? median(wohnungPreise) : '-'} €/m²)`);

  return {
    stadt: ortName,
    stadtteil: '',
    bundesland: bundeslandSlug,
    haus_kauf_preis: hausPreise.length >= 2 ? median(hausPreise) : (hausPreise[0] ?? null),
    haus_kauf_min: hausPreise.length >= 1 ? Math.min(...hausPreise) : null,
    haus_kauf_max: hausPreise.length >= 1 ? Math.max(...hausPreise) : null,
    wohnung_kauf_preis: wohnungPreise.length >= 2 ? median(wohnungPreise) : (wohnungPreise[0] ?? null),
    wohnung_kauf_min: wohnungPreise.length >= 1 ? Math.min(...wohnungPreise) : null,
    wohnung_kauf_max: wohnungPreise.length >= 1 ? Math.max(...wohnungPreise) : null,
    haus_miete_preis: null,
    haus_miete_min: null,
    haus_miete_max: null,
    wohnung_miete_preis: null,
    wohnung_miete_min: null,
    wohnung_miete_max: null,
    jahr: now.getFullYear(),
    quartal: Math.ceil((now.getMonth() + 1) / 3),
    lat: 0,
    lng: 0,
  };
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

      const haus_kauf = extractPriceForType(pricesRaw, 'HOUSE_BUY');
      const wohnung_kauf = extractPriceForType(pricesRaw, 'APARTMENT_BUY');
      const haus_miete = extractPriceForType(pricesRaw, 'HOUSE_RENT');
      const wohnung_miete = extractPriceForType(pricesRaw, 'APARTMENT_RENT');

      if (!haus_kauf.price && !wohnung_kauf.price) continue;

      results.push({
        stadt: geo.stadt || stadtSlug,
        stadtteil: name,
        bundesland: geo.bundesland || bundeslandSlug,
        haus_kauf_preis: haus_kauf.price,
        haus_kauf_min: haus_kauf.min,
        haus_kauf_max: haus_kauf.max,
        wohnung_kauf_preis: wohnung_kauf.price,
        wohnung_kauf_min: wohnung_kauf.min,
        wohnung_kauf_max: wohnung_kauf.max,
        haus_miete_preis: haus_miete.price,
        haus_miete_min: haus_miete.min,
        haus_miete_max: haus_miete.max,
        wohnung_miete_preis: wohnung_miete.price,
        wohnung_miete_min: wohnung_miete.min,
        wohnung_miete_max: wohnung_miete.max,
        jahr: haus_kauf.year || wohnung_kauf.year,
        quartal: haus_kauf.quarter || wohnung_kauf.quarter,
        lat: 0,
        lng: 0,
      });
    }

    return results;
  } catch (err) {
    console.error(`ImmoScout: District fetch error:`, err);
    return [];
  }
}
