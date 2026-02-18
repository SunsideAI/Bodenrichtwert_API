/**
 * Hessen Adapter
 *
 * Nutzt den GDS Hessen WFS 2.0 Endpunkt (BORIS Hessen).
 * Server: XtraServer – JSON evtl. nicht unterstützt, daher JSON+GML-Fallback.
 * Daten: Bodenrichtwerte zonal nach BRM 2.1.0 Schema
 * CRS: EPSG:25832, unterstützt auch EPSG:4258
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export class HessenAdapter {
    state = 'Hessen';
    stateCode = 'HE';
    isFallback = false;
    wfsUrl = 'https://www.gds.hessen.de/wfs2/boris/cgi-bin/brw/2024/wfs';
    async getBodenrichtwert(lat, lon) {
        // Versuche zuerst JSON, dann GML
        try {
            const result = await this.tryJsonQuery(lat, lon);
            if (result)
                return result;
        }
        catch {
            // JSON fehlgeschlagen
        }
        try {
            return await this.tryGmlQuery(lat, lon);
        }
        catch (err) {
            console.error('HE adapter error:', err);
            return null;
        }
    }
    async tryJsonQuery(lat, lon) {
        const delta = 0.0005;
        // EPSG:4258 (ETRS89) statt 4326 – vom Service explizit unterstützt
        const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4258`;
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
        if (!res.ok)
            return null;
        const text = await res.text();
        // Prüfe ob es tatsächlich JSON ist (XtraServer gibt evtl. GML zurück)
        if (!text.trimStart().startsWith('{') && !text.trimStart().startsWith('['))
            return null;
        const json = JSON.parse(text);
        if (!json.features?.length)
            return null;
        // Wohnbau-BRW bevorzugen
        const wohn = json.features.find((f) => {
            const nutzung = f.properties?.nutzungsart || f.properties?.NUTZUNG || '';
            return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
        }) || json.features[0];
        const p = wohn.properties;
        const wert = parseFloat(String(p.bodenrichtwert || p.brw || p.BRW || p.wert || 0));
        if (!wert || wert <= 0)
            return null;
        return {
            wert,
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
    async tryGmlQuery(lat, lon) {
        const delta = 0.0005;
        const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4258`;
        const params = new URLSearchParams({
            service: 'WFS',
            version: '2.0.0',
            request: 'GetFeature',
            typeNames: 'boris:BR_BodenrichtwertZonal',
            bbox: bbox,
            count: '5',
        });
        const url = `${this.wfsUrl}?${params}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            return null;
        const xml = await res.text();
        if (xml.includes('ExceptionReport') || xml.includes('ServiceException'))
            return null;
        if (xml.includes('numberOfFeatures="0"') || xml.includes('numberReturned="0"'))
            return null;
        const wert = this.extractGmlValue(xml, ['bodenrichtwert', 'brw', 'BRW', 'wert']);
        if (!wert || wert <= 0)
            return null;
        return {
            wert,
            stichtag: this.extractGmlField(xml, ['stichtag', 'STICHTAG']) || '2024-01-01',
            nutzungsart: this.extractGmlField(xml, ['nutzungsart', 'NUTZUNG']) || 'unbekannt',
            entwicklungszustand: this.extractGmlField(xml, ['entwicklungszustand', 'ENTW']) || 'B',
            zone: this.extractGmlField(xml, ['zone', 'ZONE', 'brw_zone']) || '',
            gemeinde: this.extractGmlField(xml, ['gemeinde', 'GEMEINDE', 'gemeinde_name']) || '',
            bundesland: 'Hessen',
            quelle: 'BORIS-Hessen',
            lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
        };
    }
    extractGmlValue(xml, fields) {
        for (const field of fields) {
            const re = new RegExp(`<[^>]*:?${field}[^>]*>([\\d.,]+)<`, 'i');
            const match = xml.match(re);
            if (match) {
                let numStr = match[1];
                // Deutsche Zahlenformat: 1.250,50 → 1250.50
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
//# sourceMappingURL=hessen.js.map