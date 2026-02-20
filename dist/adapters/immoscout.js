import { scrapeImmoScoutAtlas, scrapeImmoScoutSearch, buildSearchKreisSlug, slugify, normalizeCityForIS24, ATLAS_BASE } from '../utils/immoscout-scraper.js';
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
/**
 * ImmoScout Atlas Adapter
 *
 * Schätzt Bodenrichtwerte basierend auf ImmoScout24 Atlas-Marktpreisen.
 * KEIN offizieller BRW – nur eine Indikation basierend auf Immobilienpreisen.
 *
 * Ablauf:
 * 1. Reverse-Geocode lat/lon → Stadt + Bundesland
 * 2. ImmoScout Atlas URL bauen + fetchen
 * 3. _atlas_initialState JSON parsen → haus_kauf_preis
 * 4. Preisabhängigen Faktor anwenden → BRW-Schätzwert
 *
 * Die Umrechnung nutzt eine stetige logarithmische Funktion:
 *   faktor = 0.165 × ln(preis) − 0.935, begrenzt auf [0.15, 0.60]
 * Beispiele: 1000 €/m² → ~22%, 3000 €/m² → ~38%, 7000 €/m² → ~53%
 */
export class ImmoScoutAdapter {
    state;
    stateCode;
    isFallback = false;
    bundeslandSlug;
    constructor(state) {
        this.state = state;
        this.stateCode = state === 'Bayern' ? 'BY' : 'BW';
        this.bundeslandSlug = slugify(state);
    }
    async getBodenrichtwert(lat, lon) {
        // 1. Reverse-Geocode: lat/lon → Stadt + Landkreis
        const location = await this.reverseGeocode(lat, lon);
        if (!location) {
            console.warn(`${this.stateCode} ImmoScout: Reverse-Geocode failed for ${lat},${lon}`);
            return null;
        }
        console.log(`${this.stateCode} ImmoScout: Reverse-Geocode → ${location.stadt} (${location.bundeslandSlug}/${location.stadtSlug}), Landkreis: ${location.county || '-'}`);
        // 2. ImmoScout Atlas scrapen — 3-stufiger Fallback
        let prices = await scrapeImmoScoutAtlas(location.bundeslandSlug, location.stadtSlug);
        let datenquelle = location.stadt;
        // Fallback 1: Landkreis-Name als Stadt (Kreisstadt = Landkreis-Name, z.B. "Konstanz")
        if (!prices && location.countySlug && location.countySlug !== location.stadtSlug) {
            console.log(`${this.stateCode} ImmoScout: Kein Atlas für ${location.stadt}, versuche Landkreis "${location.county}" (${location.countySlug})...`);
            prices = await scrapeImmoScoutAtlas(location.bundeslandSlug, location.countySlug);
            if (prices) {
                datenquelle = `${location.county} (Landkreis-Durchschnitt)`;
            }
        }
        // Fallback 2: "landkreis-{name}" Format (einige Atlas-Seiten nutzen dieses Format)
        if (!prices && location.countySlug) {
            const landkreisSlug = `landkreis-${location.countySlug}`;
            console.log(`${this.stateCode} ImmoScout: Versuche Atlas-Format "landkreis-${location.countySlug}"...`);
            prices = await scrapeImmoScoutAtlas(location.bundeslandSlug, landkreisSlug);
            if (prices) {
                datenquelle = `${location.county} (Landkreis-Atlas)`;
            }
        }
        // Fallback 3: IS24 Mobile Search (breitere Suche über Landkreis)
        if (!prices) {
            console.log(`${this.stateCode} ImmoScout: Atlas erschöpft, versuche IS24 Mobile Search für ${location.stadt}...`);
            const kreisSlug = location.county ? buildSearchKreisSlug(location.county) : undefined;
            const searchPrices = await scrapeImmoScoutSearch(location.bundeslandSlug, kreisSlug, location.stadtSlug, location.stadt);
            if (searchPrices) {
                prices = searchPrices;
                datenquelle = `${searchPrices.stadt || location.stadt} (IS24-Suche)`;
            }
        }
        if (!prices) {
            console.warn(`${this.stateCode} ImmoScout: Keine Preisdaten für ${location.stadt} (alle Fallbacks erschöpft)`);
            return null;
        }
        // 3. Basispreis bestimmen (haus_kauf bevorzugt, wohnung_kauf als Fallback)
        const basisPreis = prices.haus_kauf_preis
            ?? (prices.wohnung_kauf_preis ? Math.round(prices.wohnung_kauf_preis * 0.9) : null);
        if (!basisPreis || basisPreis <= 0) {
            console.warn(`${this.stateCode} ImmoScout: Kein Hauspreis für ${datenquelle}`);
            return null;
        }
        // 4. BRW schätzen
        const { wert, factor } = this.estimateBRW(basisPreis);
        const datenstand = `${prices.jahr}-Q${prices.quartal}`;
        console.log(`${this.stateCode} ImmoScout: ${datenquelle} → Hauspreis ${basisPreis} €/m² × ${factor} = ${wert} €/m² (geschätzt)`);
        return {
            wert,
            stichtag: `${prices.jahr}-01-01`,
            nutzungsart: 'Wohnbaufläche (geschätzt)',
            entwicklungszustand: 'B',
            zone: prices.stadtteil || prices.stadt || location.stadt,
            gemeinde: prices.stadt || location.stadt,
            bundesland: this.state,
            quelle: 'ImmoScout24 Atlas (Schätzwert)',
            lizenz: 'Schätzung basierend auf Marktdaten. Kein offizieller Bodenrichtwert.',
            schaetzung: {
                methode: `ImmoScout Atlas Marktpreise × preisabhängiger Faktor (${datenquelle})`,
                basis_preis: basisPreis,
                faktor: factor,
                datenstand,
                hinweis: `Schätzwert basierend auf ${datenquelle} Immobilienmarktdaten. Kein offizieller Bodenrichtwert. Abweichungen von ±30-50% zum tatsächlichen BRW sind möglich.`,
            },
        };
    }
    /**
     * Reverse-Geocode via Nominatim: lat/lon → Stadt + Landkreis + Slugs
     */
    async reverseGeocode(lat, lon) {
        try {
            const url = `${NOMINATIM_URL}/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`;
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'BRW-API/1.0 (lebenswert.de)',
                    'Accept-Language': 'de',
                },
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok)
                return null;
            const data = await res.json();
            const address = data.address || {};
            // Stadt: city > town > municipality > county
            const stadt = address.city || address.town || address.municipality || address.county || '';
            if (!stadt)
                return null;
            // Offizielle Präfixe entfernen: "Hansestadt Lübeck" → "Lübeck"
            const normalizedStadt = normalizeCityForIS24(stadt);
            // Landkreis: z.B. "Landkreis Konstanz" → "Konstanz"
            const county = address.county || '';
            const countyName = county.replace(/^(Landkreis|Landkr\.|Kreis|Lkr\.|Städteregion|Regionalverband)\s+/i, '').trim();
            // Bundesland-Slug: aus dem Adapter-State ableiten (nicht aus Nominatim)
            return {
                stadt: normalizedStadt,
                stadtSlug: slugify(normalizedStadt),
                county,
                countySlug: countyName ? slugify(countyName) : '',
                bundeslandSlug: this.bundeslandSlug,
            };
        }
        catch (err) {
            console.error(`${this.stateCode} ImmoScout: Reverse-Geocode error:`, err);
            return null;
        }
    }
    /**
     * Schätzt den Bodenrichtwert basierend auf dem Hauspreis.
     * Höhere Immobilienpreise → höherer Bodenanteil.
     *
     * Stetige logarithmische Funktion statt harter Stufen.
     * Kalibriert an empirischen Stützpunkten:
     *   1000 €/m² → ~22% Bodenanteil (ländlich)
     *   2000 €/m² → ~30% (Kleinstadt)
     *   3250 €/m² → ~38% (Suburban)
     *   5000 €/m² → ~46% (Urban)
     *   7000 €/m² → ~53% (Premium)
     *
     * Formel: faktor = 0.165 × ln(preis) − 0.935
     * Grenzen: [0.15, 0.60] — ländlicher Mindestwert / Luxus-Obergrenze
     */
    estimateBRW(hausKaufPreis) {
        const rawFactor = 0.165 * Math.log(hausKaufPreis) - 0.935;
        const factor = Math.round(Math.max(0.15, Math.min(0.60, rawFactor)) * 1000) / 1000;
        return { wert: Math.round(hausKaufPreis * factor), factor };
    }
    async healthCheck() {
        try {
            // Prüfe ob ImmoScout Atlas erreichbar ist
            const res = await fetch(`${ATLAS_BASE}/orte/deutschland/${this.bundeslandSlug}`, {
                method: 'HEAD',
                signal: AbortSignal.timeout(5000),
            });
            return res.ok || res.status === 403; // 403 = erreichbar aber blockiert
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=immoscout.js.map