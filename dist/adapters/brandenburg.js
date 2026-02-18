/**
 * Brandenburg Adapter
 *
 * Nutzt die OGC API Features von geobasis-bb.de.
 * Collection: br_bodenrichtwert (BRM 3.0.1 Datenmodell)
 * Felder sind teilweise verschachtelt (nutzung.art, gemeinde.bezeichnung).
 */
export class BrandenburgAdapter {
    state = 'Brandenburg';
    stateCode = 'BB';
    isFallback = false;
    baseUrl = 'https://ogc-api.geobasis-bb.de/boris/collections/br_bodenrichtwert/items';
    async getBodenrichtwert(lat, lon) {
        try {
            const delta = 0.0005;
            const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
            const url = `${this.baseUrl}?bbox=${bbox}&f=json&limit=5`;
            const res = await fetch(url, {
                headers: {
                    'Accept': 'application/geo+json',
                    'User-Agent': 'BRW-API/1.0 (lebenswert.de)',
                },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) {
                console.error(`BB OGC API error: ${res.status}`);
                return null;
            }
            const json = await res.json();
            if (!json.features?.length)
                return null;
            // Wohnbau-BRW bevorzugen (BRM 3.0.1: nutzung.art enthält z.B. "Wohnbaufläche (W)")
            const wohn = json.features.find((f) => {
                const art = f.properties?.nutzung?.art || f.properties?.nutzungsart || '';
                return art.includes('Wohn') || art.includes('(W)') || art.includes('(WA)') || art.includes('(WR)') || art.startsWith('W');
            }) || json.features[0];
            const p = wohn.properties;
            const wert = p.bodenrichtwert || p.brw || 0;
            if (!wert || wert <= 0)
                return null;
            // BRM 3.0.1: entwicklungszustand kann "Baureifes Land (B)" sein → Kurzcode extrahieren
            const entwRaw = p.entwicklungszustand || 'B';
            const entwMatch = entwRaw.match(/\(([A-Z]+)\)/);
            const entwicklungszustand = entwMatch ? entwMatch[1] : entwRaw;
            // Nutzungsart aus verschachteltem Feld
            const nutzungsart = p.nutzung?.art || p.nutzungsart || 'unbekannt';
            return {
                wert,
                stichtag: p.stichtag || 'unbekannt',
                nutzungsart,
                entwicklungszustand,
                zone: p.bodenrichtwertzoneName || p.zone || '',
                gemeinde: p.gemeinde?.bezeichnung || p.gemeinde || '',
                bundesland: 'Brandenburg',
                quelle: 'BORIS-BB',
                lizenz: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
            };
        }
        catch (err) {
            console.error('BB adapter error:', err);
            return null;
        }
    }
    async healthCheck() {
        try {
            const res = await fetch(`${this.baseUrl}?limit=1&f=json`, {
                signal: AbortSignal.timeout(5000),
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=brandenburg.js.map