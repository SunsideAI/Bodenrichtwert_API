/**
 * Hessen Adapter
 *
 * Nutzt den GDS Hessen WFS 2.0 Endpunkt (BORIS Hessen).
 * Daten: Bodenrichtwerte zonal + lagetypisch
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export class HessenAdapter {
    state = 'Hessen';
    stateCode = 'HE';
    isFallback = false;
    wfsUrl = 'https://www.gds.hessen.de/wfs2/boris/cgi-bin/brw/2024/wfs';
    async getBodenrichtwert(lat, lon) {
        try {
            const delta = 0.0005;
            const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;
            const params = new URLSearchParams({
                service: 'WFS',
                version: '2.0.0',
                request: 'GetFeature',
                typeNames: 'boris:BR_BodenrichtwertZonal',
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
                console.error(`HE WFS error: ${res.status}`);
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
                stichtag: p.stichtag || p.STICHTAG || '2024-01-01',
                nutzungsart: p.nutzungsart || p.NUTZUNG || 'unbekannt',
                entwicklungszustand: p.entwicklungszustand || p.ENTW || 'B',
                zone: p.zone || p.brw_zone || p.ZONE || '',
                gemeinde: p.gemeinde || p.GEMEINDE || p.gemeinde_name || '',
                bundesland: 'Hessen',
                quelle: 'BORIS-Hessen',
                lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
            };
        }
        catch (err) {
            console.error('HE adapter error:', err);
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
//# sourceMappingURL=hessen.js.map