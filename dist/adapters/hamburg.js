/**
 * Hamburg Adapter
 *
 * Nutzt geodienste.hamburg.de WFS 2.0.
 * VBORIS-Feldnamen (Kurzform): BRW, STAG, NUTA, ENTW, BRZNAME, WNUM, GENA
 * CRS: EPSG:25832, Lizenz: dl-de/by-2-0
 */
export class HamburgAdapter {
    state = 'Hamburg';
    stateCode = 'HH';
    isFallback = false;
    wfsUrl = 'https://geodienste.hamburg.de/HH_WFS_Bodenrichtwerte';
    uekWfsUrl = 'https://geodienste.hamburg.de/HH_WFS_UEKnormierteBodenrichtwerte';
    uekWmsUrl = 'https://geodienste.hamburg.de/HH_WMS_UEKnormierteBodenrichtwerte';
    discoveredTypeName = null;
    // Known type names for Hamburg VBORIS WFS (tried in order if discovery fails).
    fallbackTypeNames = [
        'app:lgv_brw_zoniert_alle',
        'app:lgv_brw_zonen_2017',
        'app:lgv_brw_zonen_2016',
    ];
    async getBodenrichtwert(lat, lon) {
        try {
            const bboxStrategies = this.buildBboxStrategies(lat, lon);
            // 1. Try main WFS endpoint with discovered type names
            const typeNames = await this.getTypeNames();
            for (const typeName of typeNames) {
                for (const strategy of bboxStrategies) {
                    const result = await this.tryWfsGml(typeName, strategy);
                    if (result)
                        return result;
                }
            }
            // 2. Try UEK (normierte Bodenrichtwerte) WFS endpoint
            //    This has simplified overview data with types like lgv_brw_uek_efh, lgv_brw_uek_mfh
            const uekTypes = [
                'app:lgv_brw_uek_mfh', // multi-family (most common in cities)
                'app:lgv_brw_uek_efh', // single-family
                'app:lgv_brw_uek_gh', // commercial/shops
                'app:lgv_brw_uek_bh', // office buildings
            ];
            for (const typeName of uekTypes) {
                for (const strategy of bboxStrategies) {
                    const result = await this.tryWfsGml(typeName, strategy, this.uekWfsUrl);
                    if (result)
                        return result;
                }
            }
            // 3. Try UEK WMS GetFeatureInfo (normalized overview, current data)
            const uekResult = await this.tryWmsQuery(lat, lon, this.uekWmsUrl);
            if (uekResult)
                return uekResult;
            // 4. Try regular WMS GetFeatureInfo (may only have historical data)
            return await this.tryWmsQuery(lat, lon);
        }
        catch (err) {
            console.error('HH adapter error:', err);
            return null;
        }
    }
    /**
     * Build multiple bbox strings to work around CRS and axis order issues.
     * Hamburg's deegree WFS uses EPSG:25832 (UTM Zone 32N) natively.
     * EPSG:4326 queries return 0 features, so we convert to UTM first.
     */
    buildBboxStrategies(lat, lon) {
        const { easting, northing } = this.wgs84ToUtm32(lat, lon);
        const utmDelta = 100; // ~100m radius in UTM meters
        const delta = 0.001;
        return [
            // EPSG:25832 (native CRS) – most likely to work
            {
                bbox: `${easting - utmDelta},${northing - utmDelta},${easting + utmDelta},${northing + utmDelta},urn:ogc:def:crs:EPSG::25832`,
                version: '2.0.0',
                typeParam: 'typeNames',
            },
            // WFS 2.0.0: lat,lon order with EPSG:4326
            {
                bbox: `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`,
                version: '2.0.0',
                typeParam: 'typeNames',
            },
            // WFS 2.0.0: lon,lat order (common deegree bug)
            {
                bbox: `${lon - delta},${lat - delta},${lon + delta},${lat + delta},urn:ogc:def:crs:EPSG::4326`,
                version: '2.0.0',
                typeParam: 'typeNames',
            },
        ];
    }
    /**
     * Convert WGS84 lat/lon to UTM Zone 32N (EPSG:25832).
     * Standard Transverse Mercator projection formulas.
     */
    wgs84ToUtm32(lat, lon) {
        const a = 6378137;
        const f = 1 / 298.257223563;
        const k0 = 0.9996;
        const lon0 = 9; // central meridian for zone 32
        const e2 = 2 * f - f * f;
        const latRad = lat * Math.PI / 180;
        const lon0Rad = lon0 * Math.PI / 180;
        const lonRad = lon * Math.PI / 180;
        const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
        const T = Math.tan(latRad) ** 2;
        const C = (e2 / (1 - e2)) * Math.cos(latRad) ** 2;
        const A = Math.cos(latRad) * (lonRad - lon0Rad);
        const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * latRad
            - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * latRad)
            + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * latRad)
            - (35 * e2 ** 3 / 3072) * Math.sin(6 * latRad));
        const easting = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6
            + (5 - 18 * T + T ** 2 + 72 * C - 58 * (e2 / (1 - e2))) * A ** 5 / 120);
        const northing = k0 * (M + N * Math.tan(latRad) * (A ** 2 / 2
            + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
            + (61 - 58 * T + T ** 2 + 600 * C - 330 * (e2 / (1 - e2))) * A ** 6 / 720));
        return { easting, northing };
    }
    async tryWfsGml(typeName, strategy, wfsBaseUrl) {
        try {
            // Extract CRS from bbox suffix for srsName parameter
            const bboxParts = strategy.bbox.split(',');
            const crs = bboxParts.length > 4 ? bboxParts[4] : 'urn:ogc:def:crs:EPSG::25832';
            const params = new URLSearchParams({
                service: 'WFS',
                version: strategy.version,
                request: 'GetFeature',
                [strategy.typeParam]: typeName,
                bbox: strategy.bbox,
                srsName: crs,
                count: '5',
                maxFeatures: '5',
            });
            const base = wfsBaseUrl || this.wfsUrl;
            const url = `${base}?${params}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok)
                return null;
            const xml = await res.text();
            if (xml.includes('ExceptionReport') || xml.includes('ServiceException'))
                return null;
            if (xml.includes('numberOfFeatures="0"') || xml.includes('numberReturned="0"'))
                return null;
            const wert = this.extractGmlValue(xml, ['BRW', 'brw', 'bodenrichtwert', 'brwkon', 'WERT', 'wert']);
            if (!wert || wert <= 0 || wert > 500000)
                return null;
            this.discoveredTypeName = typeName;
            return {
                wert,
                stichtag: this.extractGmlField(xml, ['STAG', 'stag', 'STICHTAG', 'stichtag']) || 'unbekannt',
                nutzungsart: this.extractGmlField(xml, ['NUTA', 'nutzungsart', 'NUTZUNG', 'nuta']) || 'unbekannt',
                entwicklungszustand: this.extractGmlField(xml, ['ENTW', 'entwicklungszustand', 'entw']) || 'B',
                zone: this.extractGmlField(xml, ['BRZNAME', 'WNUM', 'brw_zone', 'wnum']) || '',
                gemeinde: this.extractGmlField(xml, ['GENA', 'ORTST', 'gemeinde', 'gena', 'ortst']) || 'Hamburg',
                bundesland: 'Hamburg',
                quelle: wfsBaseUrl?.includes('UEK') ? 'BORIS-HH (UEK)' : 'BORIS-HH',
                lizenz: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
            };
        }
        catch {
            return null;
        }
    }
    /**
     * WMS GetFeatureInfo fallback.
     * Hamburg also has a WMS endpoint with different layer names.
     */
    async tryWmsQuery(lat, lon, customWmsUrl) {
        const wmsUrl = customWmsUrl || this.wfsUrl.replace('WFS', 'WMS');
        const { easting, northing } = this.wgs84ToUtm32(lat, lon);
        const utmDelta = 100; // 100 meters in UTM units
        const delta = 0.001;
        // Discover WMS layers
        let wmsLayers = [];
        try {
            const capParams = new URLSearchParams({
                SERVICE: 'WMS',
                VERSION: '1.3.0',
                REQUEST: 'GetCapabilities',
            });
            const capRes = await fetch(`${wmsUrl}?${capParams}`, {
                headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                signal: AbortSignal.timeout(8000),
            });
            if (capRes.ok) {
                const capXml = await capRes.text();
                const allLayers = [...capXml.matchAll(/<Name>([^<]+)<\/Name>/gi)]
                    .map(m => m[1].trim())
                    .filter(n => n.length > 0 && n.length < 120);
                // Prefer brw_uek or brw_zoniert layers, then any brw_ layer
                wmsLayers = allLayers.filter(n => n.includes('brw_uek') || n.includes('brw_zoniert') || n.includes('brw_zonal'));
                if (!wmsLayers.length) {
                    wmsLayers = allLayers.filter(n => n.includes('brw') && !n.includes('referenz') && !n.includes('beschriftung') && !n.includes('lagetypisch'));
                }
                if (wmsLayers.length > 0) {
                    console.log(`HH WMS: Discovered layers: ${wmsLayers.slice(0, 5).join(', ')}`);
                }
            }
        }
        catch {
            // proceed with fallback layers
        }
        // Fallback layer candidates
        if (!wmsLayers.length) {
            wmsLayers = ['lgv_brw_zoniert_alle', 'Bodenrichtwert', '0'];
        }
        // WMS strategies: try EPSG:25832 (native CRS) first, then EPSG:4326 fallbacks
        const wmsStrategies = [
            // WMS 1.3.0 + EPSG:25832 (native CRS, most likely to work)
            {
                version: '1.3.0',
                bbox: `${easting - utmDelta},${northing - utmDelta},${easting + utmDelta},${northing + utmDelta}`,
                srsParam: 'CRS',
                srs: 'EPSG:25832',
                xParam: 'I',
                yParam: 'J',
            },
            // WMS 1.3.0 + EPSG:4326 fallback (axis order: lat,lon)
            {
                version: '1.3.0',
                bbox: `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`,
                srsParam: 'CRS',
                srs: 'EPSG:4326',
                xParam: 'I',
                yParam: 'J',
            },
            // WMS 1.1.1 + EPSG:4326 fallback (axis order: lon,lat)
            {
                version: '1.1.1',
                bbox: `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`,
                srsParam: 'SRS',
                srs: 'EPSG:4326',
                xParam: 'X',
                yParam: 'Y',
            },
        ];
        for (const layer of wmsLayers) {
            for (const strat of wmsStrategies) {
                for (const fmt of ['text/plain', 'text/html', 'application/vnd.ogc.gml', 'text/xml', 'application/json']) {
                    try {
                        const params = new URLSearchParams({
                            SERVICE: 'WMS',
                            VERSION: strat.version,
                            REQUEST: 'GetFeatureInfo',
                            LAYERS: layer,
                            QUERY_LAYERS: layer,
                            [strat.srsParam]: strat.srs,
                            BBOX: strat.bbox,
                            WIDTH: '101',
                            HEIGHT: '101',
                            [strat.xParam]: '50',
                            [strat.yParam]: '50',
                            INFO_FORMAT: fmt,
                            FEATURE_COUNT: '5',
                            STYLES: '',
                            FORMAT: 'image/png',
                        });
                        const res = await fetch(`${wmsUrl}?${params}`, {
                            headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                            signal: AbortSignal.timeout(8000),
                        });
                        if (!res.ok)
                            continue;
                        const text = await res.text();
                        if (text.includes('ServiceException') || text.includes('ExceptionReport'))
                            continue;
                        if (text.trim().length < 30)
                            continue;
                        // Try HTML table parse (HH services may return HTML with tables)
                        if (text.trimStart().startsWith('<!') || text.trimStart().startsWith('<html') || text.trimStart().startsWith('<HTML') || text.trimStart().startsWith('<table')) {
                            const wert = this.extractHtmlBrw(text);
                            if (wert && wert > 0 && wert <= 500_000) {
                                return {
                                    wert,
                                    stichtag: 'aktuell',
                                    nutzungsart: 'unbekannt',
                                    entwicklungszustand: 'B',
                                    zone: '',
                                    gemeinde: 'Hamburg',
                                    bundesland: 'Hamburg',
                                    quelle: customWmsUrl?.includes('UEK') ? 'BORIS-HH (UEK WMS)' : 'BORIS-HH (WMS)',
                                    lizenz: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
                                };
                            }
                            continue;
                        }
                        // Try JSON parse
                        if (text.trimStart().startsWith('{')) {
                            try {
                                const json = JSON.parse(text);
                                if (json.features?.length) {
                                    const f = json.features[0];
                                    const p = f.properties || {};
                                    const wertRaw = p.BRW ?? p.brw ?? p.bodenrichtwert ?? p.brwkon ?? 0;
                                    const wert = parseFloat(String(wertRaw));
                                    if (wert > 0 && wert <= 500_000) {
                                        return {
                                            wert,
                                            stichtag: p.STAG || p.stag || p.stichtag || 'unbekannt',
                                            nutzungsart: p.NUTA || p.nuta || p.nutzungsart || 'unbekannt',
                                            entwicklungszustand: p.ENTW || p.entw || 'B',
                                            zone: p.BRZNAME || p.WNUM || p.wnum || '',
                                            gemeinde: p.GENA || p.ORTST || p.gena || p.ortst || 'Hamburg',
                                            bundesland: 'Hamburg',
                                            quelle: customWmsUrl?.includes('UEK') ? 'BORIS-HH (UEK WMS)' : 'BORIS-HH (WMS)',
                                            lizenz: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
                                        };
                                    }
                                }
                            }
                            catch {
                                // not valid JSON, try XML/plain extraction
                            }
                        }
                        // XML/plain extraction
                        const wert = this.extractGmlValue(text, ['BRW', 'brw', 'bodenrichtwert', 'brwkon']);
                        if (wert && wert > 0 && wert <= 500_000) {
                            return {
                                wert,
                                stichtag: this.extractGmlField(text, ['STAG', 'stag', 'stichtag']) || 'unbekannt',
                                nutzungsart: this.extractGmlField(text, ['NUTA', 'nuta', 'nutzungsart']) || 'unbekannt',
                                entwicklungszustand: this.extractGmlField(text, ['ENTW', 'entw']) || 'B',
                                zone: this.extractGmlField(text, ['BRZNAME', 'WNUM', 'wnum']) || '',
                                gemeinde: this.extractGmlField(text, ['GENA', 'ORTST', 'gena', 'ortst']) || 'Hamburg',
                                bundesland: 'Hamburg',
                                quelle: customWmsUrl?.includes('UEK') ? 'BORIS-HH (UEK WMS)' : 'BORIS-HH (WMS)',
                                lizenz: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
                            };
                        }
                    }
                    catch {
                        // try next format
                    }
                }
            }
        }
        return null;
    }
    /**
     * Extract BRW value from HTML table response.
     */
    extractHtmlBrw(html) {
        // Skip empty HTML bodies
        if (html.replace(/<[^>]*>/g, '').trim().length < 3)
            return null;
        const patterns = [
            /(?:BRW|Bodenrichtwert|brwkon|WERT)[^<]*<\/t[dh]>\s*<td[^>]*>\s*([\d.,]+)/gi,
            /([\d.,]+)\s*(?:EUR\/m|€\/m)/i,
        ];
        for (const pattern of patterns) {
            const match = pattern.exec(html);
            if (match) {
                let numStr = match[1].trim();
                if (numStr.includes(','))
                    numStr = numStr.replace(/\./g, '').replace(',', '.');
                const val = parseFloat(numStr);
                if (val > 0 && val <= 500_000 && isFinite(val))
                    return val;
            }
        }
        return null;
    }
    /** Ermittelt alle FeatureType-Namen via GetCapabilities, priorisiert */
    async getTypeNames() {
        if (this.discoveredTypeName)
            return [this.discoveredTypeName];
        try {
            const params = new URLSearchParams({
                service: 'WFS',
                version: '2.0.0',
                request: 'GetCapabilities',
            });
            const res = await fetch(`${this.wfsUrl}?${params}`, {
                headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok)
                return this.fallbackTypeNames;
            const xml = await res.text();
            // Extract <Name> from <FeatureType> blocks
            const ftBlocks = [...xml.matchAll(/<(?:[a-zA-Z]*:)?FeatureType[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]*:)?FeatureType>/gi)];
            const typeMatches = [];
            for (const block of ftBlocks) {
                const nameMatch = block[1].match(/<(?:[a-zA-Z]*:)?Name[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]*:)?Name>/i);
                if (nameMatch) {
                    const name = nameMatch[1].trim();
                    if (name.length > 0 && name.length < 120)
                        typeMatches.push(name);
                }
            }
            console.log(`HH WFS: Name-Suche: ${typeMatches.length} Treffer, FeatureType-Blöcke: ${ftBlocks.length}`);
            if (typeMatches.length > 0) {
                console.log(`HH WFS: Gefundene FeatureTypes: ${typeMatches.slice(0, 8).join(', ')}`);
            }
            if (typeMatches.length === 0)
                return this.fallbackTypeNames;
            // Prioritize: _zoniert_alle first, then _zoniert_ by year desc, then _zonen_
            const sorted = [];
            const alle = typeMatches.filter(n => n.includes('_alle'));
            const zoniert = typeMatches
                .filter(n => n.includes('_zoniert_') && !n.includes('_alle'))
                .sort((a, b) => b.localeCompare(a)); // descending year
            const zonen = typeMatches
                .filter(n => n.includes('_zonen_'))
                .sort((a, b) => b.localeCompare(a));
            const rest = typeMatches.filter(n => !n.includes('_alle') && !n.includes('_zoniert_') && !n.includes('_zonen_'));
            sorted.push(...alle, ...zoniert, ...zonen, ...rest);
            // Only try first few to avoid excessive requests
            return sorted.slice(0, 5);
        }
        catch {
            return this.fallbackTypeNames.slice(0, 5);
        }
    }
    extractGmlValue(xml, fields) {
        for (const field of fields) {
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