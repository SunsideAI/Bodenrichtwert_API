/**
 * Thüringen Adapter
 *
 * Nutzt den GeoProxy Thüringen WFS Endpunkt (vBORIS_simple_wfs).
 * Daten: Bodenrichtwertzonen seit 31.12.2008
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: dl-de/by-2-0 (© GDI-Th)
 */
export class ThueringenAdapter {
    state = 'Thüringen';
    stateCode = 'TH';
    isFallback = false;
    wfsUrl = 'https://www.geoproxy.geoportal-th.de/geoproxy/services/boris/vBORIS_simple_wfs';
    async getBodenrichtwert(lat, lon) {
        try {
            const delta = 0.0005;
            const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;
            const params = new URLSearchParams({
                service: 'WFS',
                version: '1.1.0',
                request: 'GetFeature',
                typeName: 'BODENRICHTWERTZONE',
                bbox: bbox,
                outputFormat: 'application/json',
                maxFeatures: '5',
            });
            const url = `${this.wfsUrl}?${params}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) {
                console.error(`TH WFS error: ${res.status}`);
                return null;
            }
            const json = await res.json();
            if (!json.features?.length)
                return null;
            // Wohnbau-BRW bevorzugen
            const wohn = json.features.find((f) => {
                const nutzung = f.properties?.nutzungsart || f.properties?.NUTZUNG || f.properties?.ART || '';
                return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
            }) || json.features[0];
            const p = wohn.properties;
            return {
                wert: p.BRW || p.brw || p.bodenrichtwert || p.BODENRICHTWERT || p.wert || 0,
                stichtag: p.STICHTAG || p.stichtag || 'unbekannt',
                nutzungsart: p.NUTZUNG || p.nutzungsart || p.ART || 'unbekannt',
                entwicklungszustand: p.ENTW || p.entwicklungszustand || 'B',
                zone: p.ZONE || p.zone || p.BRWZONE || '',
                gemeinde: p.GEMEINDE || p.gemeinde || p.GEM || '',
                bundesland: 'Thüringen',
                quelle: 'BORIS-TH',
                lizenz: '© GDI-Th, dl-de/by-2-0',
            };
        }
        catch (err) {
            console.error('TH adapter error:', err);
            return null;
        }
    }
    async healthCheck() {
        try {
            const params = new URLSearchParams({
                service: 'WFS',
                version: '1.1.0',
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
//# sourceMappingURL=thueringen.js.map