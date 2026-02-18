/**
 * Berlin Adapter
 *
 * Nutzt den FIS-Broker WFS 2.0 – Geometrie-Endpunkt (re_brw_2024).
 * Der Sachdaten-Endpunkt (s_brw) unterstützt kein GeoJSON,
 * daher nutzen wir den Geometrie-Endpunkt mit application/geo+json.
 * CRS: EPSG:25833 (UTM Zone 33N)
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export class BerlinAdapter {
    state = 'Berlin';
    stateCode = 'BE';
    isFallback = false;
    // Geometrie-Endpunkt unterstützt GeoJSON
    wfsUrl = 'https://fbinter.stadt-berlin.de/fb/wfs/geometry/senstadt/re_brw_2024';
    async getBodenrichtwert(lat, lon) {
        try {
            const delta = 0.0005;
            const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;
            const params = new URLSearchParams({
                service: 'WFS',
                version: '2.0.0',
                request: 'GetFeature',
                typeNames: 're_brw_2024',
                bbox: bbox,
                outputFormat: 'application/geo+json',
                count: '5',
            });
            const url = `${this.wfsUrl}?${params}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) {
                console.error(`BE WFS error: ${res.status}`);
                // Fallback: Sachdaten-Endpunkt mit GML
                return this.tryGmlFallback(lat, lon);
            }
            const text = await res.text();
            if (!text.trimStart().startsWith('{')) {
                return this.tryGmlFallback(lat, lon);
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
            return {
                wert: p.BRW || p.brw || p.bodenrichtwert || p.BODENRICHTWERT || 0,
                stichtag: p.STICHTAG || p.stichtag || '2024-01-01',
                nutzungsart: p.NUTZUNG || p.nutzungsart || 'unbekannt',
                entwicklungszustand: p.ENTW || p.entwicklungszustand || 'B',
                zone: p.BRW_ZONE || p.brw_zone || p.ZONE || '',
                gemeinde: p.BEZIRK || p.bezirk || 'Berlin',
                bundesland: 'Berlin',
                quelle: 'BORIS-Berlin (FIS-Broker)',
                lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
            };
        }
        catch (err) {
            console.error('BE adapter error:', err);
            return null;
        }
    }
    /** Fallback: Sachdaten-Endpunkt mit GML-Parsing */
    async tryGmlFallback(lat, lon) {
        try {
            const delta = 0.0005;
            const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;
            const sachdatenUrl = 'https://fbinter.stadt-berlin.de/fb/wfs/data/senstadt/s_brw_2024';
            const params = new URLSearchParams({
                service: 'WFS',
                version: '2.0.0',
                request: 'GetFeature',
                typeNames: 'fis:s_brw_2024',
                bbox: bbox,
                count: '5',
            });
            const res = await fetch(`${sachdatenUrl}?${params}`, {
                headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return null;
            const xml = await res.text();
            if (xml.includes('ExceptionReport'))
                return null;
            const wert = this.extractGmlValue(xml, ['BRW', 'brw', 'bodenrichtwert']);
            if (!wert || wert <= 0)
                return null;
            return {
                wert,
                stichtag: this.extractGmlField(xml, ['STICHTAG', 'stichtag']) || '2024-01-01',
                nutzungsart: this.extractGmlField(xml, ['NUTZUNG', 'nutzungsart']) || 'unbekannt',
                entwicklungszustand: this.extractGmlField(xml, ['ENTW', 'entwicklungszustand']) || 'B',
                zone: this.extractGmlField(xml, ['BRW_ZONE', 'ZONE', 'zone']) || '',
                gemeinde: this.extractGmlField(xml, ['BEZIRK', 'GEMEINDE', 'bezirk']) || 'Berlin',
                bundesland: 'Berlin',
                quelle: 'BORIS-Berlin (FIS-Broker)',
                lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
            };
        }
        catch {
            return null;
        }
    }
    extractGmlValue(xml, fields) {
        for (const field of fields) {
            const re = new RegExp(`<[^>]*:?${field}[^>]*>([\\d.,]+)<`, 'i');
            const match = xml.match(re);
            if (match) {
                const val = parseFloat(match[1].replace(',', '.'));
                if (val > 0)
                    return val;
            }
        }
        return null;
    }
    extractGmlField(xml, fields) {
        for (const field of fields) {
            const re = new RegExp(`<[^>]*:?${field}[^>]*>([^<]+)<`, 'i');
            const match = xml.match(re);
            if (match)
                return match[1].trim();
        }
        return null;
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