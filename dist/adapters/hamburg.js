/**
 * Hamburg Adapter
 *
 * Nutzt geodienste.hamburg.de WFS.
 * Normierte BRW auf 1000m²/GFZ 1.0 – perfekt für Erstindikation.
 * CRS: EPSG:25832, Lizenz: dl-de/by-2-0
 */
export class HamburgAdapter {
    state = 'Hamburg';
    stateCode = 'HH';
    isFallback = false;
    wfsUrl = 'https://geodienste.hamburg.de/HH_WFS_Bodenrichtwerte';
    async getBodenrichtwert(lat, lon) {
        try {
            const delta = 0.0005;
            const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;
            const params = new URLSearchParams({
                service: 'WFS',
                version: '2.0.0',
                request: 'GetFeature',
                typeNames: 'de.hh.up:bodenrichtwerte_aktuell',
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
                console.error(`HH WFS error: ${res.status}`);
                return null;
            }
            const json = await res.json();
            if (!json.features?.length)
                return null;
            const wohn = json.features.find((f) => (f.properties?.nutzungsart || '').startsWith('W')) || json.features[0];
            const p = wohn.properties;
            return {
                wert: p.brw_euro_m2 || p.brw || p.bodenrichtwert || 0,
                stichtag: p.stichtag || 'unbekannt',
                nutzungsart: p.nutzungsart || 'unbekannt',
                entwicklungszustand: p.entwicklungszustand || 'B',
                zone: p.brw_zone || p.zone || '',
                gemeinde: 'Hamburg',
                bundesland: 'Hamburg',
                quelle: 'BORIS-HH',
                lizenz: '© FHH, LGV, dl-de/by-2-0',
            };
        }
        catch (err) {
            console.error('HH adapter error:', err);
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
//# sourceMappingURL=hamburg.js.map