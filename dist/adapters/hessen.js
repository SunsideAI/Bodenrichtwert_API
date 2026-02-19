/**
 * Hessen Adapter
 *
 * Nutzt den GDS Hessen WFS 2.0 Endpunkt (BORIS Hessen).
 * Server (XtraServer): JSON wird NICHT unterstützt (400 Bad Request).
 * Verwendet nur GML/WFS.
 *
 * GML-Struktur (BRM 2.1.0):
 *   <boris:bodenrichtwert uom="EUR/m^2">8500</boris:bodenrichtwert>
 *   ↑ Attribut im Tag – Regex muss Attribute erlauben!
 *
 * CRS: EPSG:25832, unterstützt auch EPSG:4258
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export class HessenAdapter {
    state = 'Hessen';
    stateCode = 'HE';
    isFallback = false;
    wfsUrl = 'https://www.gds.hessen.de/wfs2/boris/cgi-bin/brw/2024/wfs';
    // Max realistic BRW in Germany
    MAX_BRW = 500_000;
    async getBodenrichtwert(lat, lon) {
        // JSON is NOT supported by this server (returns 400 Bad Request).
        // Use GML only.
        try {
            return await this.tryGmlQuery(lat, lon);
        }
        catch (err) {
            console.error('HE adapter error:', err);
            return null;
        }
    }
    async tryGmlQuery(lat, lon) {
        const delta = 0.0005;
        // EPSG:4258 (ETRS89) – explicitly supported by this server
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
        if (xml.includes('numberReturned="0"') || xml.includes('numberOfFeatures="0"'))
            return null;
        // BRM 2.1.0: <boris:bodenrichtwert uom="EUR/m^2">8500</boris:bodenrichtwert>
        // The tag has an attribute (uom), so regex must allow [^>]* after the tag name.
        const wert = this.extractGmlValue(xml, ['bodenrichtwert']);
        if (!wert) {
            console.error('HE GML: Kein valider bodenrichtwert Wert. XML snippet:', xml.slice(0, 800));
            return null;
        }
        return {
            wert,
            stichtag: this.extractGmlField(xml, ['stichtag', 'wertermittlungsstichtag', 'STICHTAG', 'stag']) || '2024-01-01',
            nutzungsart: this.extractGmlField(xml, ['nutzungsart', 'nuta', 'NUTZUNG']) || 'unbekannt',
            entwicklungszustand: this.extractGmlField(xml, ['entwicklungszustand', 'entw', 'ENTW']) || 'B',
            zone: this.extractGmlField(xml, ['zone', 'wnum', 'ZONE', 'brw_zone', 'bodenrichtwertzone']) || '',
            gemeinde: this.extractGmlField(xml, ['gemeinde', 'gena', 'GEMEINDE', 'gemeindebezeichnung']) || '',
            bundesland: 'Hessen',
            quelle: 'BORIS-Hessen',
            lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
        };
    }
    /**
     * Extracts a numeric value from a GML element.
     * Crucially allows attributes in the opening tag, e.g.:
     *   <boris:bodenrichtwert uom="EUR/m^2">8500</boris:bodenrichtwert>
     */
    extractGmlValue(xml, fields) {
        for (const field of fields) {
            // Allow optional namespace prefix and optional attributes after the field name
            const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}(?:\\s[^>]*)?>([^<]+)<`, 'i');
            const match = xml.match(re);
            if (match) {
                const raw = match[1].trim();
                // German number format: 1.250,50 → 1250.50
                const numStr = raw.includes(',')
                    ? raw.replace(/\./g, '').replace(',', '.')
                    : raw;
                const val = parseFloat(numStr);
                if (val > 0 && val <= this.MAX_BRW && isFinite(val))
                    return val;
            }
        }
        return null;
    }
    extractGmlField(xml, fields) {
        for (const field of fields) {
            // Allow optional attributes in the opening tag
            const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}(?:\\s[^>]*)?>([^<]+)<`, 'i');
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