/**
 * ImmoScout24 Atlas + Suche Scraper (TypeScript)
 *
 * Portiert die Kernlogik des Python-Scrapers (SunsideAI/Bodenrichtwer_Scraper)
 * nach TypeScript. Extrahiert _atlas_initialState JSON aus ImmoScout Atlas-Seiten
 * und gibt strukturierte Preisdaten zurück.
 *
 * Quelle: atlas.immobilienscout24.de/orte/deutschland/{bundesland}/{stadt}
 * Fallback: immobilienscout24.de/Suche/de/{bundesland}/{kreis}/{ort}/haus-kaufen
 */
export const ATLAS_BASE = 'https://atlas.immobilienscout24.de';
const SEARCH_BASE = 'https://www.immobilienscout24.de';
// ─── Rotierende User-Agents (aus Python-Scraper) ──────────────────────────
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
];
function getRandomHeaders() {
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
// ─── URL-Slugifizierung ────────────────────────────────────────────────────
/**
 * Konvertiert einen deutschen Ortsnamen in einen ImmoScout-URL-Slug.
 * ImmoScout nutzt echte Unicode-Zeichen (ü, ö, ä, ß) in URLs:
 *   "München" → "münchen"  (NICHT "muenchen"!)
 *   "Baden-Württemberg" → "baden-württemberg"
 * fetch() URL-encodiert automatisch: "münchen" → "m%C3%BCnchen"
 */
export function slugify(name) {
    return name
        .toLowerCase()
        .replace(/\s+/g, '-') // Leerzeichen → Bindestriche
        .replace(/[^a-zäöüß0-9-]/g, '') // Sonderzeichen entfernen, Umlaute behalten
        .replace(/-+/g, '-') // Doppelte Bindestriche
        .replace(/^-|-$/g, ''); // Führende/nachfolgende Bindestriche
}
// ─── _atlas_initialState Extraktion ────────────────────────────────────────
/**
 * Extrahiert das _atlas_initialState JSON-Objekt aus dem HTML.
 * Verwendet die gleiche Brace-Depth-Logik wie der Python-Scraper.
 */
function extractInitialState(html) {
    const marker = /var\s+_atlas_initialState\s*=\s*/;
    const match = marker.exec(html);
    if (!match)
        return null;
    const start = match.index + match[0].length;
    let depth = 0;
    let i = start;
    while (i < html.length) {
        const ch = html[i];
        if (ch === '{') {
            depth++;
        }
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(html.substring(start, i + 1));
                }
                catch {
                    return null;
                }
            }
        }
        else if (ch === '"') {
            // String überspringen (escaped quotes beachten)
            i++;
            while (i < html.length && html[i] !== '"') {
                if (html[i] === '\\')
                    i++; // escaped character
                i++;
            }
        }
        i++;
    }
    return null;
}
function extractPriceForType(pricesDict, propertyType) {
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
function extractOwnPrices(state) {
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
function extractGeoHierarchy(state) {
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
export async function scrapeImmoScoutAtlas(bundeslandSlug, stadtSlug, stadtteilSlug) {
    let url = `${ATLAS_BASE}/orte/deutschland/${bundeslandSlug}/${stadtSlug}`;
    if (stadtteilSlug)
        url += `/${stadtteilSlug}`;
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
    }
    catch (err) {
        console.error(`ImmoScout: Fetch error for ${url}:`, err);
        return null;
    }
}
/**
 * Baut den IS24-Suche-URL-Slug für einen Landkreis.
 * "Landkreis Gifhorn" → "gifhorn-kreis"
 * "Kreis Soest" → "soest-kreis"
 * "Region Hannover" → "region-hannover"
 * "" (kreisfrei) → ""
 */
export function buildSearchKreisSlug(county) {
    if (!county)
        return '';
    const isLandkreis = /^(Landkreis|Landkr\.|Kreis|Lkr\.)\s+/i.test(county);
    const isRegion = /^Region\s+/i.test(county);
    if (isRegion) {
        return slugify(county); // "Region Hannover" → "region-hannover"
    }
    const kreisname = county.replace(/^(Landkreis|Landkr\.|Kreis|Lkr\.)\s+/i, '').trim();
    if (!kreisname)
        return '';
    const slug = slugify(kreisname);
    return isLandkreis ? `${slug}-kreis` : slug;
}
/**
 * Extrahiert Listing-Daten aus IS24-Suche-HTML.
 * Strategie 1: JSON-LD (application/ld+json)
 * Strategie 2: Regex-Extraktion aus Listing-Karten
 */
function extractSearchListings(html) {
    const listings = [];
    // ── Strategie 1: JSON-LD ──
    const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = jsonLdRegex.exec(html)) !== null) {
        try {
            const data = JSON.parse(m[1].trim());
            // IS24 kann ItemList oder einzelne Objekte liefern
            const items = data['@type'] === 'ItemList'
                ? (data.itemListElement || []).map((el) => el.item || el)
                : [data];
            for (const entry of items) {
                const priceStr = String(entry?.offers?.price ?? entry?.offers?.lowPrice ?? '0');
                const price = parseFloat(priceStr.replace(/[^\d.]/g, ''));
                const sizeStr = String(entry?.floorSize?.value ?? '0');
                const size = parseFloat(sizeStr.replace(/[^\d.]/g, ''));
                if (price > 10000 && size > 10) {
                    listings.push({
                        price,
                        livingSpace: size,
                        pricePerSqm: Math.round(price / size),
                    });
                }
            }
        }
        catch { /* skip malformed JSON-LD */ }
    }
    if (listings.length >= 3)
        return listings;
    // ── Strategie 2: __NEXT_DATA__ (Next.js SSR) ──
    const nextDataMatch = html.match(/<script[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
        try {
            const nextData = JSON.parse(nextDataMatch[1].trim());
            const results = nextData?.props?.pageProps?.searchResponseModel?.resultlistEntries?.[0]?.resultlistEntry
                || nextData?.props?.pageProps?.resultList?.resultlistEntries?.[0]?.resultlistEntry
                || [];
            for (const entry of results) {
                const attrs = entry?.resultlist?.resultlistEntry?.[0]?.attributes?.[0]?.attribute
                    || entry?.attributes?.[0]?.attribute
                    || [];
                let price = 0;
                let area = 0;
                for (const attr of attrs) {
                    const label = String(attr.label || '').toLowerCase();
                    const value = String(attr.value || '');
                    if (label.includes('kaufpreis') || label.includes('preis')) {
                        price = parseFloat(value.replace(/[^\d,]/g, '').replace(',', '.'));
                    }
                    if (label.includes('fläche') || label.includes('flaeche') || label.includes('wohnfläche')) {
                        area = parseFloat(value.replace(/[^\d,]/g, '').replace(',', '.'));
                    }
                }
                if (price > 10000 && area > 10) {
                    listings.push({ price, livingSpace: area, pricePerSqm: Math.round(price / area) });
                }
            }
        }
        catch { /* skip */ }
    }
    if (listings.length >= 3)
        return listings;
    // ── Strategie 3: HTML-Regex ──
    // IS24 Listing-Karten enthalten typisch: "125.000 €" und "54 m²"
    // Suche <article> oder <li> Blöcke mit beiden Patterns
    const blockRegex = /<(?:article|li)[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/(?:article|li)>/gi;
    let blockMatch;
    while ((blockMatch = blockRegex.exec(html)) !== null) {
        const block = blockMatch[1];
        const priceM = block.match(/([\d.]+(?:,\d+)?)\s*€/);
        const areaM = block.match(/([\d.,]+)\s*m²/);
        if (priceM && areaM) {
            const price = parseFloat(priceM[1].replace(/\./g, '').replace(',', '.'));
            const area = parseFloat(areaM[1].replace(/\./g, '').replace(',', '.'));
            if (price > 10000 && area > 10 &&
                !listings.some(l => l.price === price && l.livingSpace === area)) {
                listings.push({ price, livingSpace: area, pricePerSqm: Math.round(price / area) });
            }
        }
    }
    // ── Strategie 4: Breitere Regex (wenn keine Listing-Blöcke gefunden) ──
    if (listings.length === 0) {
        // Suche alle Preis+Fläche Paare die innerhalb von 500 Zeichen vorkommen
        const allPrices = [...html.matchAll(/([\d.]{3,10}(?:,\d+)?)\s*€/g)];
        const allAreas = [...html.matchAll(/([\d.,]{1,8})\s*m²/g)];
        for (const pMatch of allPrices) {
            const pIdx = pMatch.index;
            const price = parseFloat(pMatch[1].replace(/\./g, '').replace(',', '.'));
            if (price < 20000 || price > 5000000)
                continue; // unrealistische Preise filtern
            // Nächste Fläche innerhalb von 500 Zeichen finden
            const nearArea = allAreas.find(a => Math.abs(a.index - pIdx) < 500);
            if (nearArea) {
                const area = parseFloat(nearArea[1].replace(/\./g, '').replace(',', '.'));
                if (area > 10 && area < 1000 &&
                    !listings.some(l => l.price === price && l.livingSpace === area)) {
                    listings.push({ price, livingSpace: area, pricePerSqm: Math.round(price / area) });
                }
            }
        }
    }
    return listings;
}
function median(arr) {
    if (arr.length === 0)
        return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
/**
 * Scrapt IS24 Suchseite und aggregiert Listing-Preise zu Marktdaten.
 * Fallback für Orte ohne Atlas-Daten (z.B. Meine, Gifhorn-Kreis).
 *
 * URL-Format: /Suche/de/{bundesland}/{kreis}/{ort}/haus-kaufen
 */
export async function scrapeImmoScoutSearch(bundeslandSlug, kreisSlug, ortSlug, ortName) {
    const hausListings = [];
    const wohnungListings = [];
    for (const [type, target] of [
        ['haus-kaufen', hausListings],
        ['wohnung-kaufen', wohnungListings],
    ]) {
        // URL bauen: mit oder ohne Kreis
        const pathParts = ['Suche', 'de', bundeslandSlug];
        if (kreisSlug)
            pathParts.push(kreisSlug);
        pathParts.push(ortSlug, type);
        const url = `${SEARCH_BASE}/${pathParts.join('/')}`;
        console.log(`ImmoScout Suche: Fetching ${url}`);
        try {
            const res = await fetch(url, {
                headers: {
                    ...getRandomHeaders(),
                    'Referer': 'https://www.immobilienscout24.de/',
                },
                signal: AbortSignal.timeout(15000),
                redirect: 'follow',
            });
            if (!res.ok) {
                console.warn(`ImmoScout Suche: HTTP ${res.status} for ${url}`);
                continue;
            }
            const html = await res.text();
            if (html.length < 2000) {
                console.warn(`ImmoScout Suche: Response zu kurz (${html.length} bytes)`);
                continue;
            }
            const found = extractSearchListings(html);
            console.log(`ImmoScout Suche: ${found.length} Listings für ${type} in ${ortName}`);
            target.push(...found);
        }
        catch (err) {
            console.warn(`ImmoScout Suche: Fetch error for ${url}:`, err);
        }
    }
    const total = hausListings.length + wohnungListings.length;
    if (total === 0) {
        console.warn(`ImmoScout Suche: Keine Listings für ${ortName}`);
        return null;
    }
    const now = new Date();
    const hausPreise = hausListings.map(l => l.pricePerSqm);
    const wohnungPreise = wohnungListings.map(l => l.pricePerSqm);
    console.log(`ImmoScout Suche: ${ortName} → ${hausListings.length} Häuser (Median ${median(hausPreise)} €/m²), ${wohnungListings.length} Wohnungen (Median ${median(wohnungPreise)} €/m²)`);
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
export async function scrapeImmoScoutDistricts(bundeslandSlug, stadtSlug) {
    const url = `${ATLAS_BASE}/orte/deutschland/${bundeslandSlug}/${stadtSlug}`;
    console.log(`ImmoScout: Fetching districts from ${url}`);
    try {
        const res = await fetch(url, {
            headers: getRandomHeaders(),
            signal: AbortSignal.timeout(15000),
            redirect: 'follow',
        });
        if (!res.ok)
            return [];
        const html = await res.text();
        const state = extractInitialState(html);
        if (!state)
            return [];
        const geo = extractGeoHierarchy(state);
        const tableData = state.priceTableData?.data || [];
        const results = [];
        for (const district of tableData) {
            const name = district.name || '';
            const pricesRaw = district.prices || {};
            const haus_kauf = extractPriceForType(pricesRaw, 'HOUSE_BUY');
            const wohnung_kauf = extractPriceForType(pricesRaw, 'APARTMENT_BUY');
            const haus_miete = extractPriceForType(pricesRaw, 'HOUSE_RENT');
            const wohnung_miete = extractPriceForType(pricesRaw, 'APARTMENT_RENT');
            if (!haus_kauf.price && !wohnung_kauf.price)
                continue;
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
    }
    catch (err) {
        console.error(`ImmoScout: District fetch error:`, err);
        return [];
    }
}
//# sourceMappingURL=immoscout-scraper.js.map