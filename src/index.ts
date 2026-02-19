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
import type { Bewertung } from './bewertung.js';
import { scrapeImmoScoutAtlas, slugify } from './utils/immoscout-scraper.js';
import type { ImmoScoutPrices } from './utils/immoscout-scraper.js';
import type { NormalizedBRW } from './adapters/base.js';

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
 * Holt ImmoScout-Marktdaten für eine Stadt (mit Cache).
 * Gibt null zurück bei Fehlern – blockiert nie die Haupt-Response.
 */
async function fetchMarktdaten(
  state: string,
  city: string,
): Promise<ImmoScoutPrices | null> {
  if (!city) return null;

  const bundeslandSlug = slugify(state);
  const stadtSlug = slugify(city);
  const cacheKey = `${bundeslandSlug}:${stadtSlug}`;

  // 1. Cache prüfen
  const cached = immoCache.get(cacheKey);
  if (cached) {
    console.log(`ImmoScout-Cache hit: ${cacheKey}`);
    return cached;
  }

  // 2. Live scrapen
  console.log(`ImmoScout: Marktdaten für ${city} (${state}) abrufen...`);
  const prices = await scrapeImmoScoutAtlas(bundeslandSlug, stadtSlug);

  if (prices) {
    immoCache.set(cacheKey, prices);
  }

  return prices;
}

/**
 * Konvertiert ImmoScoutPrices in das kompakte API-Response-Format.
 */
function formatMarktdaten(prices: ImmoScoutPrices) {
  const fmt = (preis: number | null, min: number | null, max: number | null) =>
    preis != null ? { preis, min, max } : null;

  return {
    haus_kauf: fmt(prices.haus_kauf_preis, prices.haus_kauf_min, prices.haus_kauf_max),
    haus_miete: fmt(prices.haus_miete_preis, prices.haus_miete_min, prices.haus_miete_max),
    wohnung_kauf: fmt(prices.wohnung_kauf_preis, prices.wohnung_kauf_min, prices.wohnung_kauf_max),
    wohnung_miete: fmt(prices.wohnung_miete_preis, prices.wohnung_miete_min, prices.wohnung_miete_max),
    stadt: prices.stadt,
    stadtteil: prices.stadtteil || undefined,
    datenstand: `${prices.jahr}-Q${prices.quartal}`,
    quelle: 'ImmoScout24 Atlas',
  };
}

// ==========================================
// Bewertung aus Request-Kontext erstellen
// ==========================================

/**
 * Parst einen Zahlenwert aus beliebigem Input (Zahl, deutscher String, etc.)
 * "138,68" → 138.68 | "1.200,50" → 1200.50 | 42 → 42 | null → null
 */
function parseNum(val: any): number | null {
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val !== 'string' || val.trim() === '') return null;
  // Deutsches Format: "1.200,50" → "1200.50"
  const cleaned = val.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function buildBewertungFromContext(
  body: Record<string, any>,
  brw: NormalizedBRW | null,
  marktdaten: ImmoScoutPrices | null,
): Bewertung | null {
  return buildBewertung(
    {
      art: body.art || null,
      grundstuecksflaeche: parseNum(body.grundstuecksflaeche),
      wohnflaeche: parseNum(body.wohnflaeche),
      baujahr: parseNum(body.baujahr),
      objektunterart: body.objektunterart || null,
      modernisierung: body.modernisierung || null,
      energie: body.energie || null,
      ausstattung: body.ausstattung || null,
    },
    brw,
    marktdaten,
  );
}

// ==========================================
// POST /api/enrich — Hauptendpunkt für Zapier
// ==========================================
app.post('/api/enrich', async (c) => {
  const body = await c.req.json();
  const { plz, ort, strasse, art, grundstuecksflaeche,
          wohnflaeche, baujahr, objektunterart, modernisierung, energie, ausstattung } = body;

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

    // 2. ImmoScout-Marktdaten parallel starten (blockiert nie)
    const marktdatenPromise = fetchMarktdaten(geo.state, geo.city)
      .catch((err) => {
        console.warn('ImmoScout Marktdaten Fehler:', err);
        return null;
      });

    // 3. BRW-Cache prüfen
    const cacheKey = `${geo.lat.toFixed(5)}:${geo.lon.toFixed(5)}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      const marktdaten = await marktdatenPromise;
      const elapsed = Date.now() - start;
      return c.json({
        status: 'success',
        input_echo: {
          adresse: adressString,
          koordinaten: { lat: geo.lat, lon: geo.lon },
          bundesland: geo.state,
        },
        bodenrichtwert: { ...cached, confidence: (cached.schaetzung ? 'estimated' : 'high') as string },
        marktdaten: marktdaten ? formatMarktdaten(marktdaten) : null,
        erstindikation: buildEnrichment(cached.wert, art, grundstuecksflaeche),
        bewertung: buildBewertungFromContext(body, cached, marktdaten),
        meta: { cached: true, response_time_ms: elapsed },
      });
    }

    // 4. Adapter wählen und abfragen
    const adapter = routeToAdapter(geo.state);

    if (adapter.isFallback) {
      const marktdaten = await marktdatenPromise;
      const elapsed = Date.now() - start;
      return c.json({
        status: 'manual_required',
        input_echo: {
          adresse: adressString,
          koordinaten: { lat: geo.lat, lon: geo.lon },
          bundesland: geo.state,
        },
        bodenrichtwert: {
          wert: null,
          bundesland: geo.state,
          confidence: 'none' as const,
          grund: adapter.fallbackReason,
          boris_url: adapter.borisUrl,
          anleitung: 'Bitte Bodenrichtwert manuell einsehen und eingeben.',
        },
        marktdaten: marktdaten ? formatMarktdaten(marktdaten) : null,
        erstindikation: buildEnrichment(null, art, grundstuecksflaeche),
        bewertung: buildBewertungFromContext(body, null, marktdaten),
        meta: { cached: false, response_time_ms: elapsed },
      });
    }

    // 5. BRW + Marktdaten parallel abfragen
    const brw = await adapter.getBodenrichtwert(geo.lat, geo.lon);
    const marktdaten = await marktdatenPromise;
    const elapsed = Date.now() - start;

    if (!brw) {
      return c.json({
        status: 'not_found',
        input_echo: {
          adresse: adressString,
          koordinaten: { lat: geo.lat, lon: geo.lon },
          bundesland: geo.state,
        },
        bodenrichtwert: {
          wert: null,
          bundesland: geo.state,
          confidence: 'none' as const,
          grund: 'Kein Bodenrichtwert für diese Koordinaten gefunden.',
        },
        marktdaten: marktdaten ? formatMarktdaten(marktdaten) : null,
        erstindikation: buildEnrichment(null, art, grundstuecksflaeche),
        bewertung: buildBewertungFromContext(body, null, marktdaten),
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
      input_echo: {
        adresse: adressString,
        koordinaten: { lat: geo.lat, lon: geo.lon },
        bundesland: geo.state,
      },
      bodenrichtwert: { ...brw, confidence: (brw.schaetzung ? 'estimated' : 'high') as string },
      marktdaten: marktdaten ? formatMarktdaten(marktdaten) : null,
      erstindikation: buildEnrichment(brw.wert, art, grundstuecksflaeche),
      bewertung: buildBewertungFromContext(body, brw, marktdaten),
      meta: { cached: false, response_time_ms: elapsed },
    });

  } catch (err) {
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
// GET / — Einfache Startseite
// ==========================================
app.get('/', (c) => {
  return c.json({
    name: 'BRW Enrichment API',
    version: '1.1.0',
    endpoints: {
      enrich: 'POST /api/enrich',
      health: 'GET /api/health',
    },
  });
});

// Server starten
const port = parseInt(process.env.PORT || '3000', 10);
console.log(`BRW API running on port ${port}`);

serve({ fetch: app.fetch, port });
