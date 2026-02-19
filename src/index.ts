import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { geocode } from './geocoder.js';
import { routeToAdapter } from './state-router.js';
import { cache } from './cache.js';
import { buildEnrichment } from './enrichment.js';

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
// POST /api/enrich — Hauptendpunkt für Zapier
// ==========================================
app.post('/api/enrich', async (c) => {
  const body = await c.req.json();
  const { plz, ort, strasse, art, grundstuecksflaeche } = body;

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

    // 2. Cache prüfen
    const cacheKey = `${geo.lat.toFixed(5)}:${geo.lon.toFixed(5)}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      const elapsed = Date.now() - start;
      return c.json({
        status: 'success',
        input_echo: {
          adresse: adressString,
          koordinaten: { lat: geo.lat, lon: geo.lon },
          bundesland: geo.state,
        },
        bodenrichtwert: { ...cached, confidence: (cached.schaetzung ? 'estimated' : 'high') as string },
        erstindikation: buildEnrichment(cached.wert, art, grundstuecksflaeche),
        meta: { cached: true, response_time_ms: elapsed },
      });
    }

    // 3. Adapter wählen und abfragen
    const adapter = routeToAdapter(geo.state);

    if (adapter.isFallback) {
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
        erstindikation: buildEnrichment(null, art, grundstuecksflaeche),
        meta: { cached: false, response_time_ms: elapsed },
      });
    }

    // 4. WFS abfragen
    const brw = await adapter.getBodenrichtwert(geo.lat, geo.lon);
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
        erstindikation: buildEnrichment(null, art, grundstuecksflaeche),
        meta: { cached: false, response_time_ms: elapsed },
      });
    }

    // 5. Nur cachen wenn wert > 0 (verhindert gecachte Fehlresultate)
    if (brw.wert > 0) {
      cache.set(cacheKey, brw);
    }

    // 6. Response
    return c.json({
      status: 'success',
      input_echo: {
        adresse: adressString,
        koordinaten: { lat: geo.lat, lon: geo.lon },
        bundesland: geo.state,
      },
      bodenrichtwert: { ...brw, confidence: (brw.schaetzung ? 'estimated' : 'high') as string },
      erstindikation: buildEnrichment(brw.wert, art, grundstuecksflaeche),
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
  const removed = cache.clear();
  return c.json({ status: 'ok', removed });
});

// ==========================================
// GET /api/health — Statuscheck
// ==========================================
app.get('/api/health', (c) => {
  const stats = cache.stats();
  return c.json({
    status: 'ok',
    uptime: process.uptime(),
    cache: stats,
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// GET / — Einfache Startseite
// ==========================================
app.get('/', (c) => {
  return c.json({
    name: 'BRW Enrichment API',
    version: '1.0.0',
    endpoints: {
      enrich: 'POST /api/enrich',
      health: 'GET /api/health',
    },
  });
});

// Server starten
const port = parseInt(process.env.PORT || '3000', 10);
console.log(`🚀 BRW API running on port ${port}`);

serve({ fetch: app.fetch, port });
