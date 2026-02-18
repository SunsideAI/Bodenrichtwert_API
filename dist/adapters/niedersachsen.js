/**
 * Niedersachsen Adapter
 *
 * Nutzt den LGLN OpenData WFS Endpunkt (doorman/noauth).
 * Daten: Bodenrichtwerte (alle Jahrgänge verfügbar)
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: dl-de/by-2-0 (Namensnennung)
 */
export class NiedersachsenAdapter {
    state = 'Niedersachsen';
    stateCode = 'NI';
    isFallback = false;
    wfsUrl = 'https://opendata.lgln.niedersachsen.de/doorman/noauth/boris_wfs';
    async getBodenrichtwert(lat, lon) {
        try {
            const delta = 0.0005;
            const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;
            const params = new URLSearchParams({
                service: 'WFS',
                version: '2.0.0',
                request: 'GetFeature',
                typeNames: 'boris:bodenrichtwert',
                bbox: bbox,
                outputFormat: 'application/json',
                count: '5',
            });
            const url = `${this.wfsUrl}?${params}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) {
                console.error(`NI WFS error: ${res.status}`);
                return null;
            }
            const json = await res.json();
            if (!json.features?.length)
                return null;
            // Wohnbau-BRW bevorzugen
            const wohn = json.features.find((f) => {
                const nutzung = f.properties?.nutzungsart || f.properties?.NUTZUNG || '';
                return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
            }) || json.features[0];
            const p = wohn.properties;
            return {
                wert: p.bodenrichtwert || p.brw || p.BRW || p.wert || 0,
                stichtag: p.stichtag || p.STICHTAG || 'unbekannt',
                nutzungsart: p.nutzungsart || p.NUTZUNG || 'unbekannt',
                entwicklungszustand: p.entwicklungszustand || p.ENTW || 'B',
                zone: p.zone || p.brw_zone || p.ZONE || '',
                gemeinde: p.gemeinde || p.GEMEINDE || p.gemeinde_name || '',
                bundesland: 'Niedersachsen',
                quelle: 'BORIS-NI (LGLN)',
                lizenz: '© LGLN, dl-de/by-2-0',
            };
        }
        catch (err) {
            console.error('NI adapter error:', err);
            return null;
        }
    }
    async healthCheck() {
        try {
            const params = new URLSearchParams({
                service: 'WFS',
                version: '2.0.0',
                request: 'GetCapabilities',
            });
            const res = await fetch(`${this.wfsUrl}?${params}`, {
                signal: AbortSignal.timeout(5000),
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=niedersachsen.js.map