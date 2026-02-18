/**
 * Niedersachsen Adapter
 *
 * Nutzt den LGLN OpenData WFS Endpunkt (doorman/noauth).
 * Auto-Discovery: Holt TypeNames aus GetCapabilities beim ersten Aufruf.
 * Versucht auch jahresspezifische Endpunkte (boris_2024_wfs, boris_2023_wfs).
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: dl-de/by-2-0 (Namensnennung)
 */
export class NiedersachsenAdapter {
    state = 'Niedersachsen';
    stateCode = 'NI';
    isFallback = false;
    baseUrl = 'https://opendata.lgln.niedersachsen.de/doorman/noauth';
    // Endpunkte in Prioritätsreihenfolge (aktuell zuerst, dann jahresspezifisch)
    endpoints = [
        'boris_wfs',
        'boris_2024_wfs',
        'boris_2023_wfs',
    ];
    // Cache für entdeckte TypeNames pro Endpunkt
    discoveredTypeNames = {};
    async getBodenrichtwert(lat, lon) {
        for (const endpoint of this.endpoints) {
            try {
                const result = await this.queryEndpoint(lat, lon, endpoint);
                if (result)
                    return result;
            }
            catch (err) {
                console.warn(`NI ${endpoint} error:`, err);
            }
        }
        console.error('NI adapter: Kein Treffer mit allen Endpunkten');
        return null;
    }
    async queryEndpoint(lat, lon, endpoint) {
        const wfsUrl = `${this.baseUrl}/${endpoint}`;
        // TypeNames für diesen Endpunkt entdecken (nur beim ersten Mal)
        let typeNames = this.discoveredTypeNames[endpoint];
        if (!typeNames) {
            typeNames = await this.discoverTypeNames(wfsUrl);
            this.discoveredTypeNames[endpoint] = typeNames;
            console.log(`NI ${endpoint}: Discovered typeNames:`, typeNames);
        }
        if (typeNames.length === 0)
            return null;
        // Jeden TypeName versuchen
        for (const typeName of typeNames) {
            // Versuche JSON
            try {
                const result = await this.fetchFeatures(wfsUrl, lat, lon, typeName, 'application/json');
                if (result)
                    return result;
            }
            catch { /* next */ }
            // Versuche GeoJSON
            try {
                const result = await this.fetchFeatures(wfsUrl, lat, lon, typeName, 'application/geo+json');
                if (result)
                    return result;
            }
            catch { /* next */ }
            // Versuche GML (default)
            try {
                const result = await this.fetchGml(wfsUrl, lat, lon, typeName);
                if (result)
                    return result;
            }
            catch { /* next */ }
        }
        return null;
    }
    /** GetCapabilities abfragen und FeatureType-Namen extrahieren */
    async discoverTypeNames(wfsUrl) {
        try {
            const params = new URLSearchParams({
                service: 'WFS',
                version: '2.0.0',
                request: 'GetCapabilities',
            });
            const res = await fetch(`${wfsUrl}?${params}`, {
                headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return [];
            const xml = await res.text();
            // FeatureType Names aus GetCapabilities extrahieren
            const typeNames = [];
            const nameRegex = /<(?:wfs:)?Name>([^<]+)<\/(?:wfs:)?Name>/g;
            let match;
            while ((match = nameRegex.exec(xml)) !== null) {
                const name = match[1].trim();
                // Nur relevante FeatureTypes (nicht Service-Name o.ä.)
                if (name && !name.includes('WFS') && !name.includes('Service')) {
                    typeNames.push(name);
                }
            }
            return typeNames;
        }
        catch (err) {
            console.warn('NI GetCapabilities error:', err);
            return [];
        }
    }
    /** JSON/GeoJSON GetFeature Abfrage */
    async fetchFeatures(wfsUrl, lat, lon, typeName, format) {
        const delta = 0.0005;
        const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;
        const params = new URLSearchParams({
            service: 'WFS',
            version: '2.0.0',
            request: 'GetFeature',
            typeNames: typeName,
            bbox: bbox,
            outputFormat: format,
            count: '5',
        });
        const res = await fetch(`${wfsUrl}?${params}`, {
            headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            return null;
        const text = await res.text();
        if (!text.trimStart().startsWith('{') && !text.trimStart().startsWith('['))
            return null;
        const json = JSON.parse(text);
        if (!json.features?.length)
            return null;
        // Wohnbau-BRW bevorzugen
        const wohn = json.features.find((f) => {
            const nutzung = f.properties?.nuta || f.properties?.NUTA || f.properties?.nutzungsart || f.properties?.NUTZUNG || '';
            return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
        }) || json.features[0];
        return this.mapProperties(wohn.properties);
    }
    /** GML GetFeature Abfrage (ohne outputFormat → Server-Default) */
    async fetchGml(wfsUrl, lat, lon, typeName) {
        const delta = 0.0005;
        const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;
        const params = new URLSearchParams({
            service: 'WFS',
            version: '2.0.0',
            request: 'GetFeature',
            typeNames: typeName,
            bbox: bbox,
            count: '5',
        });
        const res = await fetch(`${wfsUrl}?${params}`, {
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
        // BRW-Wert aus GML extrahieren
        const wert = this.extractGmlValue(xml, ['brw', 'BRW', 'bodenrichtwert', 'Bodenrichtwert', 'wert', 'richtwert']);
        if (!wert || wert <= 0)
            return null;
        return {
            wert,
            stichtag: this.extractGmlField(xml, ['stag', 'STAG', 'stichtag', 'STICHTAG']) || 'unbekannt',
            nutzungsart: this.extractGmlField(xml, ['nuta', 'NUTA', 'nutzungsart', 'NUTZUNG']) || 'unbekannt',
            entwicklungszustand: this.extractGmlField(xml, ['entw', 'ENTW', 'entwicklungszustand']) || 'B',
            zone: this.extractGmlField(xml, ['wnum', 'WNUM', 'zone', 'ZONE', 'brw_zone']) || '',
            gemeinde: this.extractGmlField(xml, ['gena', 'GENA', 'gemeinde', 'GEMEINDE']) || '',
            bundesland: 'Niedersachsen',
            quelle: 'BORIS-NI (LGLN)',
            lizenz: '© LGLN, dl-de/by-2-0',
        };
    }
    /** Properties aus JSON-Response mappen (VBORIS Kurz- und Langform) */
    mapProperties(p) {
        return {
            wert: p.brw || p.BRW || p.bodenrichtwert || p.wert || 0,
            stichtag: p.stag || p.STAG || p.stichtag || p.STICHTAG || 'unbekannt',
            nutzungsart: p.nuta || p.NUTA || p.nutzungsart || p.NUTZUNG || 'unbekannt',
            entwicklungszustand: p.entw || p.ENTW || p.entwicklungszustand || 'B',
            zone: p.wnum || p.WNUM || p.zone || p.brw_zone || p.ZONE || '',
            gemeinde: p.gena || p.GENA || p.gemeinde || p.GEMEINDE || p.gemeinde_name || '',
            bundesland: 'Niedersachsen',
            quelle: 'BORIS-NI (LGLN)',
            lizenz: '© LGLN, dl-de/by-2-0',
        };
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
            const res = await fetch(`${this.baseUrl}/boris_wfs?${params}`, {
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