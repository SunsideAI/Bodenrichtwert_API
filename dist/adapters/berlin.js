/**
 * Berlin Adapter
 *
 * Nutzt den neuen Geoportal Berlin WFS 2.0 (GeoServer) unter gdi.berlin.de.
 * Der alte FIS-Broker (fbinter.stadt-berlin.de) wurde Ende 2025 abgeschaltet.
 * Feature-Type: brw2025:brw_2025_vector
 * CRS: EPSG:4326 (WGS84) für bbox-Abfragen
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export class BerlinAdapter {
    state = 'Berlin';
    stateCode = 'BE';
    isFallback = false;
    // Neuer Geoportal Berlin WFS (GeoServer)
    wfsUrl = 'https://gdi.berlin.de/services/wfs/brw2025';
    async getBodenrichtwert(lat, lon) {
        try {
            const delta = 0.0005;
            const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta},EPSG:4326`;
            const params = new URLSearchParams({
                service: 'WFS',
                version: '2.0.0',
                request: 'GetFeature',
                typeNames: 'brw2025:brw_2025_vector',
                bbox: bbox,
                srsName: 'EPSG:4326',
                outputFormat: 'application/json',
                count: '5',
            });
            const url = `${this.wfsUrl}?${params}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) {
                console.error(`BE WFS error: ${res.status}`);
                return null;
            }
            const text = await res.text();
            if (!text.trimStart().startsWith('{')) {
                console.error('BE WFS: unexpected non-JSON response');
                return null;
            }
            const json = JSON.parse(text);
            if (!json.features?.length)
                return null;
            // Wohnbau-BRW bevorzugen
            const wohn = json.features.find((f) => {
                const nutzung = f.properties?.NUTZUNG || f.properties?.nutzungsart || '';
                return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
            }) || json.features[0];
            const p = wohn.properties;
            const wert = parseFloat(String(p.BRW || p.brw || p.bodenrichtwert || p.BODENRICHTWERT || 0));
            if (!wert || wert <= 0)
                return null;
            const stichtag = p.STICHTAG || p.stichtag || '2025-01-01';
            // Normalize stichtag: strip time component if present (e.g. "2025-01-01T00:00:00")
            const stichtagClean = String(stichtag).split('T')[0];
            return {
                wert,
                stichtag: stichtagClean,
                nutzungsart: p.NUTZUNG || p.nutzungsart || 'unbekannt',
                entwicklungszustand: p.ENTW || p.entwicklungszustand || p.BEITRAGSZUSTAND || 'B',
                zone: p.BRW_ZONE || p.brw_zone || p.ZONE || '',
                gemeinde: p.BEZIRK || p.bezirk || 'Berlin',
                bundesland: 'Berlin',
                quelle: 'BORIS-Berlin (Geoportal Berlin)',
                lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
            };
        }
        catch (err) {
            console.error('BE adapter error:', err);
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
//# sourceMappingURL=berlin.js.map