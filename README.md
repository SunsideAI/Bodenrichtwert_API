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
    "grundstuecksflaeche": 500
  }'
```

### GET /api/health

```bash
curl https://your-app.up.railway.app/api/health
```

## Bundesland-Abdeckung

| Status | Bundesländer |
|---|---|
| ✅ Implementiert | Hamburg, NRW, Rheinland-Pfalz, Brandenburg |
| 🔜 Geplant | Berlin, Hessen, Mecklenburg-Vorpommern |
| ⚠️ Fallback | Bayern, Baden-Württemberg, Bremen |

## Architektur

```
Zapier Webhook → POST /api/enrich
                  → Geocoding (Nominatim)
                  → PLZ → Bundesland
                  → State Router → Adapter
                  → Cache Check (SQLite, 6 Mo. TTL)
                  → WFS-Abfrage
                  → Normalisierung
                  → Erstindikation berechnen
                  → JSON Response zurück an Zapier
```
