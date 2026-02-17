/**
 * Nordrhein-Westfalen Adapter
 *
 * Nutzt den boris.nrw.de WFS 2.0 Endpunkt.
 * Älteste und umfangreichste offene BRW-Daten (seit 2011).
 * CRS: EPSG:25832 (UTM Zone 32N)
 */
export class NRWAdapter {
    state = 'Nordrhein-Westfalen';
    stateCode = 'NW';
    isFallback = false;
    wfsUrl = 'https://www.boris.nrw.de/cgi-bin/nrwboriswms';
    async getBodenrichtwert(lat, lon) {
        try {
            // NRW WFS erwartet EPSG:4326 als bbox bei WFS 2.0
            const delta = 0.0005;
            const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;
            const params = new URLSearchParams({
                service: 'WFS',
                version: '2.0.0',
                request: 'GetFeature',
                typeNames: 'bodenrichtwerte',
                bbox: bbox,
                outputFormat: 'application/json',
                count: '5',
            });
            const url = `${this.wfsUrl}?${params}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) {
                console.error(`NRW WFS error: ${res.status}`);
                return null;
            }
            const json = await res.json();
            if (!json.features?.length)
                return null;
            // Wohnbau-BRW bevorzugen
            const wohn = json.features.find((f) => (f.properties?.nutzungsart || '').startsWith('W')) || json.features[0];
            const p = wohn.properties;
            return {
                wert: p.brw || p.bodenrichtwert || p.brw_euro_m2 || 0,
                stichtag: p.stichtag || 'unbekannt',
                nutzungsart: p.nutzungsart || 'unbekannt',
                entwicklungszustand: p.entwicklungszustand || 'B',
                zone: p.brw_zone || p.zone || p.lage || '',
                gemeinde: p.gemeinde || p.gemeinde_name || '',
                bundesland: 'Nordrhein-Westfalen',
                quelle: 'BORIS-NRW',
                lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
            };
        }
        catch (err) {
            console.error('NRW adapter error:', err);
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
//# sourceMappingURL=nrw.js.map