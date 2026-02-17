/**
 * Brandenburg Adapter
 *
 * Nutzt die moderne OGC API Features (OpenAPI 3.0) von geobasis-bb.de.
 * Best Practice Referenz – neues Datenmodell seit 2025.
 */
export class BrandenburgAdapter {
    state = 'Brandenburg';
    stateCode = 'BB';
    isFallback = false;
    baseUrl = 'https://ogc-api.geobasis-bb.de/boris/v1/collections/bodenrichtwert/items';
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
            const wohn = json.features.find((f) => {
                const nutzung = f.properties?.nutzungsart || '';
                return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
            }) || json.features[0];
            const p = wohn.properties;
            return {
                wert: p.bodenrichtwert || p.brw || 0,
                stichtag: p.stichtag || 'unbekannt',
                nutzungsart: p.nutzungsart || 'unbekannt',
                entwicklungszustand: p.entwicklungszustand || 'B',
                zone: p.zone || p.brw_zone || '',
                gemeinde: p.gemeinde || p.ort || '',
                bundesland: 'Brandenburg',
                quelle: 'BORIS-BB',
                lizenz: '© LGB Brandenburg',
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