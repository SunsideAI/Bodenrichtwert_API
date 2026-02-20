import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { geocode } from './geocoder.js';
import { routeToAdapter } from './state-router.js';
import { cache, immoCache } from './cache.js';
import { buildEnrichment } from './enrichment.js';
import { buildBewertung } from './bewertung.js';
import { scrapeImmoScoutAtlas, scrapeImmoScoutDistricts, scrapeImmoScoutSearch, buildSearchKreisSlug, slugify, normalizeCityForIS24, generateCitySlugVariants } from './utils/immoscout-scraper.js';
import { fetchPreisindex } from './utils/bundesbank.js';
import { fetchImmobilienrichtwert } from './utils/nrw-irw.js';
import { fetchBaupreisindex } from './utils/destatis.js';
const app = new Hono();
// Middleware
app.use('*', logger());
app.use('*', cors());
// Auth für API-Endpunkte
const token = process.env.API_TOKEN;
if (token) {
    app.use('/api/enrich', bearerAuth({ token }));
}
// ==========================================
// ImmoScout Marktdaten abfragen + cachen
// ==========================================
/**
 * Extrahiert den eigentlichen Kreisnamen aus einem Nominatim-county-String.
 * "Landkreis Gifhorn" → "Gifhorn", "Kreis Soest" → "Soest", "München" → ""
 */
function extractKreisname(county) {
    return county.replace(/^(Landkreis|Landkr\.|Kreis|Lkr\.|Städteregion|Regionalverband|Hansestadt|Universitätsstadt|Große Kreisstadt)\s+/i, '').trim();
}
/**
 * Holt ImmoScout-Marktdaten für eine Stadt (mit Cache).
 * Fallback-Kette: Stadt-Atlas → Landkreis-Atlas → IS24-Suche → null
 * Gibt null zurück bei Fehlern – blockiert nie die Haupt-Response.
 */
async function fetchMarktdaten(state, city, county) {
    if (!city)
        return null;
    // Offizielle Präfixe entfernen: "Hansestadt Lübeck" → "Lübeck"
    const normalizedCity = normalizeCityForIS24(city);
    const bundeslandSlug = slugify(state);
    const stadtSlug = slugify(normalizedCity);
    const cacheKey = `${bundeslandSlug}:${stadtSlug}`;
    // 1. Cache prüfen
    const cached = immoCache.get(cacheKey);
    if (cached) {
        console.log(`ImmoScout-Cache hit: ${cacheKey}`);
        return cached;
    }
    // 2. Stadt-Level Atlas
    console.log(`ImmoScout: Marktdaten für ${normalizedCity} (${state}) abrufen...`);
    const prices = await scrapeImmoScoutAtlas(bundeslandSlug, stadtSlug);
    if (prices) {
        immoCache.set(cacheKey, prices);
        return prices;
    }
    // 2b. Slug-Varianten für zusammengesetzte Ortsnamen (vor Landkreis-Fallback)
    const variants = generateCitySlugVariants(normalizedCity);
    for (const variant of variants) {
        if (variant === stadtSlug)
            continue; // bereits versucht
        console.log(`ImmoScout: Versuche Slug-Variante "${variant}" für ${normalizedCity}...`);
        const variantPrices = await scrapeImmoScoutAtlas(bundeslandSlug, variant);
        if (variantPrices) {
            immoCache.set(cacheKey, variantPrices);
            return variantPrices;
        }
    }
    // 3. Landkreis-Atlas als Fallback (für Kleinstädte ohne eigene Atlas-Seite)
    if (county) {
        const kreisname = extractKreisname(county);
        if (kreisname && kreisname.toLowerCase() !== city.toLowerCase()) {
            const kreisSlug = slugify(kreisname);
            const kreisCacheKey = `${bundeslandSlug}:kreis:${kreisSlug}`;
            const kreisCache = immoCache.get(kreisCacheKey);
            if (kreisCache) {
                console.log(`ImmoScout-Cache hit (Landkreis): ${kreisCacheKey}`);
                return kreisCache;
            }
            console.log(`ImmoScout: Kein Stadtpreis für ${city}, versuche Landkreis "${kreisname}"...`);
            const kreisPrices = await scrapeImmoScoutAtlas(bundeslandSlug, kreisSlug);
            if (kreisPrices) {
                immoCache.set(kreisCacheKey, kreisPrices);
                return kreisPrices;
            }
            // "landkreis-{name}" Format versuchen (einige Atlas-Seiten nutzen dieses Format)
            const landkreisSlug = `landkreis-${kreisSlug}`;
            console.log(`ImmoScout: Landkreis "${kreisname}" nicht gefunden, versuche "${landkreisSlug}"...`);
            const landkreisPrices = await scrapeImmoScoutAtlas(bundeslandSlug, landkreisSlug);
            if (landkreisPrices) {
                immoCache.set(kreisCacheKey, landkreisPrices);
                return landkreisPrices;
            }
        }
    }
    // 4. IS24-Suche als letzter Fallback (individuelle Listings parsen)
    try {
        const searchKreisSlug = county ? buildSearchKreisSlug(county) : undefined;
        const searchCacheKey = `${bundeslandSlug}:suche:${stadtSlug}`;
        const searchCache = immoCache.get(searchCacheKey);
        if (searchCache) {
            console.log(`ImmoScout-Cache hit (Suche): ${searchCacheKey}`);
            return searchCache;
        }
        console.log(`ImmoScout: Atlas leer für ${city}, versuche IS24-Suche...`);
        const searchPrices = await scrapeImmoScoutSearch(bundeslandSlug, searchKreisSlug, stadtSlug, city);
        if (searchPrices) {
            immoCache.set(searchCacheKey, searchPrices);
            return searchPrices;
        }
    }
    catch (err) {
        console.warn(`ImmoScout Suche Fehler für ${city}:`, err);
    }
    return null;
}
/**
 * Holt Stadtteil-genaue ImmoScout-Daten und matcht gegen den Geocoder-District.
 * Gibt das beste Match zurück (Stadtteil > City-Level).
 */
async function fetchDistrictMarktdaten(state, city, district, cityPrices) {
    if (!district || !city)
        return cityPrices;
    try {
        const bundeslandSlug = slugify(state);
        const stadtSlug = slugify(normalizeCityForIS24(city));
        const districts = await scrapeImmoScoutDistricts(bundeslandSlug, stadtSlug);
        if (districts.length === 0)
            return cityPrices;
        // Matching: exact → contains → fallback auf city-level
        const target = district.toLowerCase().trim();
        const exact = districts.find((d) => d.stadtteil?.toLowerCase().trim() === target);
        if (exact) {
            console.log(`ImmoScout: Stadtteil-Match (exakt): ${exact.stadtteil}`);
            return exact;
        }
        const partial = districts.find((d) => d.stadtteil?.toLowerCase().includes(target) ||
            target.includes(d.stadtteil?.toLowerCase() ?? ''));
        if (partial) {
            console.log(`ImmoScout: Stadtteil-Match (partial): ${partial.stadtteil}`);
            return partial;
        }
        console.log(`ImmoScout: Kein Stadtteil-Match für "${district}" in ${city}`);
        return cityPrices;
    }
    catch (err) {
        console.warn('ImmoScout Stadtteil-Abfrage Fehler:', err);
        return cityPrices;
    }
}
// ─── Bundesbank Preisindex (gecacht) ─────────────────────────────────────────
let _preisindexCache = null;
const PREISINDEX_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
async function getPreisindex() {
    if (_preisindexCache && Date.now() - _preisindexCache.fetchedAt < PREISINDEX_TTL_MS) {
        return _preisindexCache.data;
    }
    try {
        const data = await fetchPreisindex();
        if (data.length > 0) {
            _preisindexCache = { data, fetchedAt: Date.now() };
            console.log(`Bundesbank Preisindex: ${data.length} Quartalswerte geladen`);
            return data;
        }
    }
    catch (err) {
        console.warn('Bundesbank Preisindex Fehler:', err);
    }
    return _preisindexCache?.data ?? null;
}
// ─── Destatis Baupreisindex (gecacht) ────────────────────────────────────────
let _baupreisindexCache = null;
const BAUPREISINDEX_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 Tage (quartalsweise aktualisiert)
async function getBaupreisindex() {
    if (_baupreisindexCache && Date.now() - _baupreisindexCache.fetchedAt < BAUPREISINDEX_TTL_MS) {
        return _baupreisindexCache.data;
    }
    try {
        const data = await fetchBaupreisindex();
        _baupreisindexCache = { data, fetchedAt: Date.now() };
        console.log(`Destatis Baupreisindex: ${data.stand}, Faktor ${data.faktor} (${data.quelle})`);
        return data;
    }
    catch (err) {
        console.warn('Destatis Baupreisindex Fehler:', err);
    }
    return _baupreisindexCache?.data ?? null;
}
/**
 * Konvertiert ImmoScoutPrices in das kompakte API-Response-Format.
 */
function formatMarktdaten(prices) {
    const fmt = (preis, min, max) => preis != null ? { preis, min, max } : null;
    return {
        haus_kauf: fmt(prices.haus_kauf_preis, prices.haus_kauf_min, prices.haus_kauf_max),
        haus_miete: fmt(prices.haus_miete_preis, prices.haus_miete_min, prices.haus_miete_max),
        wohnung_kauf: fmt(prices.wohnung_kauf_preis, prices.wohnung_kauf_min, prices.wohnung_kauf_max),
        wohnung_miete: fmt(prices.wohnung_miete_preis, prices.wohnung_miete_min, prices.wohnung_miete_max),
        stadt: prices.stadt,
        stadtteil: prices.stadtteil || undefined,
        datenstand: `${prices.jahr}-Q${prices.quartal}`,
        quelle: (prices.haus_miete_preis == null && prices.wohnung_miete_preis == null
            && (prices.haus_kauf_preis != null || prices.wohnung_kauf_preis != null))
            ? 'ImmoScout24 Suche (Listing-Auswertung)'
            : 'ImmoScout24 Atlas',
    };
}
// ==========================================
// Bewertung aus Request-Kontext erstellen
// ==========================================
/**
 * Parst einen Zahlenwert aus beliebigem Input (Zahl, deutscher String, etc.)
 * "138,68" → 138.68 | "1.200,50" → 1200.50 | 42 → 42 | null → null
 */
function parseNum(val) {
    if (typeof val === 'number')
        return isNaN(val) ? null : val;
    if (typeof val !== 'string' || val.trim() === '')
        return null;
    // Deutsches Format: "1.200,50" → "1200.50"
    const cleaned = val.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
}
/**
 * Mappt die Immobilienart auf einen NRW-IRW-Teilmarkt-Filter.
 */
function mapArtToTeilmarkt(art) {
    if (!art)
        return undefined;
    const a = art.toLowerCase();
    if (a.includes('wohnung') || a.includes('etw') || a.includes('eigentum'))
        return 'ETW';
    if (a.includes('mehrfamilien') || a.includes('mfh'))
        return 'MFH';
    if (a.includes('reihen') || a.includes('doppel') || a.includes('rdh'))
        return 'RDH';
    // Default für Einfamilienhaus, Zweifamilienhaus etc.
    return 'EFH';
}
function buildBewertungFromContext(body, brw, marktdaten, preisindex, irw, baupreisindex, bundesland) {
    return buildBewertung({
        art: body.art || null,
        grundstuecksflaeche: parseNum(body.grundstuecksflaeche),
        wohnflaeche: parseNum(body.wohnflaeche),
        baujahr: parseNum(body.baujahr),
        objektunterart: body.objektunterart || null,
        modernisierung: body.modernisierung || null,
        energie: body.energie || null,
        ausstattung: body.ausstattung || null,
    }, brw, marktdaten, preisindex, irw, baupreisindex, bundesland);
}
// ==========================================
// POST /api/enrich — Hauptendpunkt für Zapier
// ==========================================
app.post('/api/enrich', async (c) => {
    const body = await c.req.json();
    const { plz, ort, strasse, art, grundstuecksflaeche, wohnflaeche, baujahr, objektunterart, modernisierung, energie, ausstattung } = body;
    if (!plz && !strasse) {
        return c.json({
            status: 'error',
            error: 'PLZ oder Straße+Ort erforderlich.',
        }, 400);
    }
    try {
        const start = Date.now();
        // 1. Geocoding
        const adressString = [strasse, plz, ort].filter(Boolean).join(', ');
        const geo = await geocode(strasse || '', plz || '', ort || '');
        if (!geo) {
            return c.json({
                status: 'error',
                error: `Adresse konnte nicht geocodiert werden: ${adressString}`,
            }, 400);
        }
        // Input-Echo: alle Bewertungsparameter zurückgeben (Debugging)
        const inputEcho = {
            adresse: adressString,
            koordinaten: { lat: geo.lat, lon: geo.lon },
            bundesland: geo.state,
            bewertungsparameter: {
                art: body.art || null,
                baujahr: parseNum(body.baujahr),
                wohnflaeche: parseNum(body.wohnflaeche),
                grundstuecksflaeche: parseNum(body.grundstuecksflaeche),
                objektunterart: body.objektunterart || null,
                modernisierung: body.modernisierung || null,
                energie: body.energie || null,
                ausstattung: body.ausstattung || null,
            },
        };
        // 2. Alle externen Datenquellen parallel starten (blockiert nie)
        const marktdatenPromise = fetchMarktdaten(geo.state, geo.city, geo.county)
            .then((cityPrices) => fetchDistrictMarktdaten(geo.state, geo.city, geo.district, cityPrices))
            .catch((err) => {
            console.warn('ImmoScout Marktdaten Fehler:', err);
            return null;
        });
        const preisindexPromise = getPreisindex().catch(() => null);
        const baupreisindexPromise = getBaupreisindex().catch(() => null);
        // NRW-IRW nur für Nordrhein-Westfalen abrufen (Teilmarkt aus art ableiten)
        const irwPromise = geo.state === 'Nordrhein-Westfalen'
            ? fetchImmobilienrichtwert(geo.lat, geo.lon, mapArtToTeilmarkt(art)).catch((err) => {
                console.warn('NRW IRW Fehler:', err);
                return null;
            })
            : Promise.resolve(null);
        // 3. BRW-Cache prüfen
        const cacheKey = `${geo.lat.toFixed(5)}:${geo.lon.toFixed(5)}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            const [marktdaten, preisindex, irw, bpi] = await Promise.all([
                marktdatenPromise, preisindexPromise, irwPromise, baupreisindexPromise,
            ]);
            const elapsed = Date.now() - start;
            return c.json({
                status: 'success',
                input_echo: inputEcho,
                bodenrichtwert: { ...cached, confidence: (cached.schaetzung ? 'estimated' : 'high') },
                marktdaten: marktdaten ? formatMarktdaten(marktdaten) : null,
                erstindikation: buildEnrichment(cached.wert, art, grundstuecksflaeche),
                bewertung: buildBewertungFromContext(body, cached, marktdaten, preisindex, irw, bpi, geo.state),
                meta: { cached: true, response_time_ms: elapsed },
            });
        }
        // 4. Adapter wählen und abfragen
        const adapter = routeToAdapter(geo.state);
        if (adapter.isFallback) {
            const [marktdaten, preisindex, irw, bpi] = await Promise.all([
                marktdatenPromise, preisindexPromise, irwPromise, baupreisindexPromise,
            ]);
            const elapsed = Date.now() - start;
            return c.json({
                status: 'manual_required',
                input_echo: inputEcho,
                bodenrichtwert: {
                    wert: null,
                    bundesland: geo.state,
                    confidence: 'none',
                    grund: adapter.fallbackReason,
                    boris_url: adapter.borisUrl,
                    anleitung: 'Bitte Bodenrichtwert manuell einsehen und eingeben.',
                },
                marktdaten: marktdaten ? formatMarktdaten(marktdaten) : null,
                erstindikation: buildEnrichment(null, art, grundstuecksflaeche),
                bewertung: buildBewertungFromContext(body, null, marktdaten, preisindex, irw, bpi, geo.state),
                meta: { cached: false, response_time_ms: elapsed },
            });
        }
        // 5. BRW + alle Datenquellen parallel abfragen
        const [brw, marktdaten, preisindex, irw, bpi] = await Promise.all([
            adapter.getBodenrichtwert(geo.lat, geo.lon),
            marktdatenPromise,
            preisindexPromise,
            irwPromise,
            baupreisindexPromise,
        ]);
        const elapsed = Date.now() - start;
        if (!brw) {
            return c.json({
                status: 'not_found',
                input_echo: inputEcho,
                bodenrichtwert: {
                    wert: null,
                    bundesland: geo.state,
                    confidence: 'none',
                    grund: 'Kein Bodenrichtwert für diese Koordinaten gefunden.',
                },
                marktdaten: marktdaten ? formatMarktdaten(marktdaten) : null,
                erstindikation: buildEnrichment(null, art, grundstuecksflaeche),
                bewertung: buildBewertungFromContext(body, null, marktdaten, preisindex, irw, bpi, geo.state),
                meta: { cached: false, response_time_ms: elapsed },
            });
        }
        // 6. Nur cachen wenn wert > 0 (verhindert gecachte Fehlresultate)
        if (brw.wert > 0) {
            cache.set(cacheKey, brw);
        }
        // 7. Response
        return c.json({
            status: 'success',
            input_echo: inputEcho,
            bodenrichtwert: { ...brw, confidence: (brw.schaetzung ? 'estimated' : 'high') },
            marktdaten: marktdaten ? formatMarktdaten(marktdaten) : null,
            erstindikation: buildEnrichment(brw.wert, art, grundstuecksflaeche),
            bewertung: buildBewertungFromContext(body, brw, marktdaten, preisindex, irw, bpi, geo.state),
            meta: { cached: false, response_time_ms: elapsed },
        });
    }
    catch (err) {
        console.error('Enrich error:', err);
        return c.json({
            status: 'error',
            error: 'Interner Fehler. Bitte später erneut versuchen.',
            detail: process.env.NODE_ENV !== 'production' ? String(err) : undefined,
        }, 500);
    }
});
// ==========================================
// DELETE /api/cache — Cache leeren
// ==========================================
app.delete('/api/cache', (c) => {
    const brwRemoved = cache.clear();
    const immoRemoved = immoCache.clear();
    return c.json({ status: 'ok', removed: { brw: brwRemoved, immoscout: immoRemoved } });
});
// ==========================================
// GET /api/health — Statuscheck
// ==========================================
app.get('/api/health', (c) => {
    return c.json({
        status: 'ok',
        uptime: process.uptime(),
        cache: {
            brw: cache.stats(),
            immoscout: immoCache.stats(),
        },
        timestamp: new Date().toISOString(),
    });
});
// ==========================================
// GET /api/optionen — Gültige Feldwerte
// ==========================================
app.get('/api/optionen', (c) => {
    return c.json({
        hinweis: 'Für modernisierung, energie, ausstattung können alternativ numerische Scores 1–5 gesendet werden.',
        modernisierung: [
            { wert: 'Kernsanierung / Neuwertig', score: 5 },
            { wert: 'Umfassend modernisiert', score: 4 },
            { wert: 'Teilweise modernisiert', score: 3 },
            { wert: 'Nur einzelne Maßnahmen', score: 2 },
            { wert: 'Keine Modernisierungen', score: 1 },
        ],
        energie: [
            { wert: 'Sehr gut', score: 5, beispiel: 'A+, A' },
            { wert: 'Gut', score: 4, beispiel: 'B' },
            { wert: 'Durchschnittlich', score: 3, beispiel: 'C, D' },
            { wert: 'Eher schlecht', score: 2, beispiel: 'E, F' },
            { wert: 'Sehr schlecht', score: 1, beispiel: 'G, H' },
        ],
        ausstattung: [
            { wert: 'Stark gehoben', score: 5 },
            { wert: 'Gehoben', score: 4 },
            { wert: 'Mittel', score: 3 },
            { wert: 'Einfach', score: 2 },
            { wert: 'Schlecht', score: 1 },
        ],
        objektunterart: [
            'Freistehendes Einfamilienhaus',
            'Doppelhaushälfte',
            'Reihenmittelhaus',
            'Reihenendhaus',
            'Zweifamilienhaus',
            'Mehrfamilienhaus',
            'Bungalow',
            'Stadthaus',
            'Bauernhaus / Resthof',
        ],
    });
});
// ==========================================
// GET / — Einfache Startseite
// ==========================================
app.get('/', (c) => {
    return c.json({
        name: 'BRW Enrichment API',
        version: '2.0.0',
        endpoints: {
            enrich: 'POST /api/enrich',
            optionen: 'GET /api/optionen',
            health: 'GET /api/health',
        },
    });
});
// Server starten
const port = parseInt(process.env.PORT || '3000', 10);
console.log(`BRW API running on port ${port}`);
serve({ fetch: app.fetch, port });
//# sourceMappingURL=index.js.map