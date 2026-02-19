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
            // Try JSON first, fall back to GML
            const result = await this.tryJsonQuery(lat, lon);
            if (result)
                return result;
            return await this.tryGmlQuery(lat, lon);
        }
        catch (err) {
            console.error('TH adapter error:', err);
            return null;
        }
    }
    async tryJsonQuery(lat, lon) {
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
            console.error(`TH WFS JSON error: ${res.status}`);
            return null;
        }
        // Read as text first – server may return XML even when JSON is requested
        const text = await res.text();
        if (!text.trimStart().startsWith('{') && !text.trimStart().startsWith('[')) {
            // Not JSON – will be handled by tryGmlQuery
            return null;
        }
        const json = JSON.parse(text);
        if (!json.features?.length)
            return null;
        return this.extractFromFeatures(json.features);
    }
    async tryGmlQuery(lat, lon) {
        const delta = 0.0005;
        const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;
        // Try multiple type names – TH may differ
        for (const typeName of ['BODENRICHTWERTZONE', 'bodenrichtwertzone', 'brw:BodenrichtwertZone']) {
            try {
                const params = new URLSearchParams({
                    service: 'WFS',
                    version: '1.1.0',
                    request: 'GetFeature',
                    typeName: typeName,
                    bbox: bbox,
                    maxFeatures: '5',
                });
                const url = `${this.wfsUrl}?${params}`;
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                    signal: AbortSignal.timeout(10000),
                });
                if (!res.ok)
                    continue;
                const xml = await res.text();
                if (xml.includes('ExceptionReport') || xml.includes('ServiceException'))
                    continue;
                if (xml.includes('numberReturned="0"') || xml.includes('numberOfFeatures="0"'))
                    continue;
                if (xml.trim().length < 100)
                    continue;
                const wert = this.extractGmlValue(xml, ['BRW', 'brw', 'bodenrichtwert', 'BODENRICHTWERT', 'RICHTWERT']);
                if (!wert || wert <= 0 || wert > 500000)
                    continue;
                return {
                    wert,
                    stichtag: this.extractGmlField(xml, ['STICHTAG', 'stichtag', 'STAG', 'stag']) || 'unbekannt',
                    nutzungsart: this.extractGmlField(xml, ['NUTZUNG', 'nutzungsart', 'NUTA', 'ART']) || 'unbekannt',
                    entwicklungszustand: this.extractGmlField(xml, ['ENTW', 'entwicklungszustand']) || 'B',
                    zone: this.extractGmlField(xml, ['ZONE', 'zone', 'BRWZONE', 'WNUM']) || '',
                    gemeinde: this.extractGmlField(xml, ['GEMEINDE', 'gemeinde', 'GEM', 'GENA']) || '',
                    bundesland: 'Thüringen',
                    quelle: 'BORIS-TH',
                    lizenz: '© GDI-Th, dl-de/by-2-0',
                };
            }
            catch {
                // Try next type name
            }
        }
        return null;
    }
    extractFromFeatures(features) {
        // Prefer Wohnbau
        const wohn = features.find((f) => {
            const nutzung = f.properties?.nutzungsart || f.properties?.NUTZUNG || f.properties?.ART || '';
            return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
        }) || features[0];
        const p = wohn.properties;
        const wertRaw = p.BRW ?? p.brw ?? p.bodenrichtwert ?? p.BODENRICHTWERT ?? p.wert ?? 0;
        const wert = parseFloat(String(wertRaw));
        if (!wert || wert <= 0 || wert > 500000)
            return null;
        return {
            wert,
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
    extractGmlValue(xml, fields) {
        for (const field of fields) {
            // Match exact tag name (no extra chars like Z in BRWZNR matching BRW)
            const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}>([\\d.,]+)<`, 'i');
            const match = xml.match(re);
            if (match) {
                let numStr = match[1];
                if (numStr.includes(',')) {
                    numStr = numStr.replace(/\./g, '').replace(',', '.');
                }
                const val = parseFloat(numStr);
                if (val > 0 && isFinite(val))
                    return val;
            }
        }
        return null;
    }
    extractGmlField(xml, fields) {
        for (const field of fields) {
            const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}>([^<]+)<`, 'i');
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