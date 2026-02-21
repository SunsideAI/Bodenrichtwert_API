# BRW Enrichment API

Bodenrichtwert-Abfrage und Erbbaurecht-Erstindikation für Lebenswert.

Fragt die Bodenrichtwert-WFS-Dienste der Bundesländer ab und liefert normalisierte Daten + Erbbauzins-Berechnung zurück. Optimiert für Zapier-Webhook-Integration.

## Quick Start (lokal)

```bash
npm install
cp .env.example .env     # API_TOKEN setzen
npm run dev               # Startet auf http://localhost:3000
```

## Deploy auf Railway

### Option A: GitHub (empfohlen)

1. Repo auf GitHub pushen
2. railway.com → New Project → Deploy from GitHub Repo
3. Repository auswählen
4. Environment Variables setzen (siehe unten)
5. Settings → Networking → Generate Domain
6. Fertig! Railway deployed automatisch bei jedem `git push`

### Option B: CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway domain
```

## Environment Variables

| Variable | Wert | Beschreibung |
|---|---|---|
| `API_TOKEN` | `openssl rand -hex 32` | Bearer Token für Auth |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Geocoding-Service |
| `NODE_ENV` | `production` | Umgebung |
| `PORT` | `3000` | Server-Port (Railway setzt das automatisch) |
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` | **Optional** — Aktiviert KI-Validierung + KI-Recherche (Claude). Ohne Key läuft die API normal, Validierung/Recherche deaktiviert. |
| `LLM_MODEL` | `claude-sonnet-4-5-20250929` | Modell für KI-Validierung (Default: Sonnet 4.5) |
| `LLM_TIMEOUT_MS` | `8000` | Timeout in ms für LLM-Validierung (Default: 8000) |
| `RESEARCH_MODEL` | `claude-sonnet-4-5-20250929` | Modell für KI-Recherche (Default: Sonnet 4.5) |
| `RESEARCH_TIMEOUT_MS` | `20000` | Timeout in ms für KI-Recherche (Default: 20000) |

### API-Key hinterlegen

**Lokal** — in `.env` Datei:
```bash
cp .env.example .env
# Dann ANTHROPIC_API_KEY= eintragen
```

**Railway (Produktion)** — Railway Dashboard → Projekt → **Variables** → `+ New Variable` → `ANTHROPIC_API_KEY`

## API

### POST /api/enrich

```bash
curl -X POST https://your-app.up.railway.app/api/enrich \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "plz": "55469",
    "ort": "Simmern",
    "strasse": "Poststraße 4",
    "art": "Einfamilienhaus",
    "grundstuecksflaeche": 500,
    "wohnflaeche": 140,
    "baujahr": 1985,
    "objektunterart": "Freistehendes Einfamilienhaus",
    "modernisierung": "3",
    "energie": "4",
    "ausstattung": "3"
  }'
```

### Response-Struktur

Die Response enthält alle Zwischen-Ergebnisse **und** ein flaches `bericht`-Objekt mit den finalen Werten für den PDF-Report:

```json
{
  "status": "success",
  "input_echo": { ... },
  "bodenrichtwert": { "wert": 85, "stichtag": "2024-01-01", "confidence": "high", ... },
  "marktdaten": { "haus_kauf": { "preis": 2100, "min": 1800, "max": 2500 }, ... },
  "erstindikation": { ... },
  "bewertung": { "realistischer_immobilienwert": 275000, "konfidenz": "hoch", ... },
  "validation": { "status": "plausibel", "confidence": 0.92, ... },
  "bericht": {
    "Strasse": "Poststraße 4",
    "PLZ": "55469",
    "Ort": "Simmern",
    "Bundesland": "Rheinland-Pfalz",
    "Stadtteil": "",
    "Standortbeschreibung": "Simmern, Rhein-Hunsrück-Kreis, Rheinland-Pfalz. Marktdaten: ...",
    "Immobilienart": "Einfamilienhaus",
    "Objektunterart": "Freistehendes Einfamilienhaus",
    "Baujahr": 1985,
    "Wohnflaeche": 140,
    "Grundstuecksflaeche": 500,
    "Modernisierung": "Teilweise modernisiert",
    "Energie": "Gut",
    "Ausstattung": "Mittel",
    "Preis_qm": 1964,
    "QMSpanne_Untergrenze": 1768,
    "QMSpanne_Mittelwert": 1964,
    "QMSpanne_Obergrenze": 2160,
    "Preis": 275000,
    "Spanne_Untergrenze": 247500,
    "Spanne_Mittelwert": 275000,
    "Spanne_Obergrenze": 302500,
    "Bodenwert": 42500,
    "Gebaeudewert": 232500,
    "Ertragswert": null,
    "Bodenrichtwert": 85,
    "Bodenrichtwert_Stichtag": "2024-01-01",
    "Bodenrichtwert_Zone": "Simmern Kernstadt",
    "Bodenrichtwert_Nutzungsart": "Wohnbaufläche",
    "Bodenrichtwert_Quelle": "BORIS-RP",
    "Bodenrichtwert_Confidence": "Offiziell (BORIS)",
    "BKI_Ampelklasse": "gruen",
    "Konfidenz": "hoch",
    "Bewertungsmethode": "sachwert-lite"
  },
  "research": null,
  "meta": { "cached": false, "response_time_ms": 3200 }
}
```

Das `bericht`-Objekt ist **immer** vorhanden und enthält die finalen Werte **nach allen Korrekturschleifen** (Plausibilität + KI-Validierung). Scores (1-5) werden automatisch in lesbare Texte umgewandelt. Alle Felder haben Fallback-Werte — Zapier kann direkt mappen, ohne Null-Checks.

### GET /api/health

```bash
curl https://your-app.up.railway.app/api/health
```

## Bundesland-Abdeckung

| Status | Bundesländer |
|---|---|
| ✅ Implementiert | Hamburg, NRW, Rheinland-Pfalz, Brandenburg, Berlin, Hessen, Niedersachsen, Schleswig-Holstein, Sachsen, Thüringen, Sachsen-Anhalt, Mecklenburg-Vorpommern, Saarland |
| ⚠️ Fallback (KI-Recherche) | Bayern, Baden-Württemberg, Bremen |

Für Bundesländer ohne BORIS-WFS-Zugang wird automatisch eine **KI-Recherche** (Claude mit Web-Search) gestartet, die Bodenrichtwerte und Marktdaten aus öffentlichen Quellen recherchiert.

## Architektur

```
Zapier Webhook → POST /api/enrich
                  → Geocoding (Nominatim)
                  → PLZ → Bundesland
                  → State Router → Adapter
                  │
                  ├─ Parallel:
                  │   ├─ WFS-Abfrage (Bodenrichtwert)
                  │   ├─ IS24-Marktdaten (Atlas + Listing-Scraper)
                  │   ├─ Bundesbank Preisindex
                  │   ├─ Destatis Baupreisindex
                  │   └─ NRW IRW (nur Nordrhein-Westfalen)
                  │
                  ├─ KI-Recherche (bei fehlenden Daten)
                  │   └─ Claude + Web-Search → BRW + Marktdaten
                  │
                  ├─ Lage-Cluster (A/B/C) + Methodenwahl
                  ├─ NHK-Berechnung + IS24-Blend
                  ├─ Ertragswertverfahren
                  ├─ 4-Signal-Plausibilitätsprüfung + Invariante
                  ├─ KI-Validierung (Claude Sonnet)
                  │
                  ├─ buildBericht() → flaches PDFMonkey-Objekt
                  └─ JSON Response → Zapier → PDFMonkey Onepager
```

Vollständige Bewertungslogik: siehe [docs/bewertung.md](docs/bewertung.md)
