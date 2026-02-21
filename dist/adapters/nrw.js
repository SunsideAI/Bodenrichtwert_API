/**
 * Nordrhein-Westfalen Adapter
 *
 * Nutzt den BORIS-NRW WMS GetFeatureInfo-Endpunkt.
 * NRW bietet keinen öffentlichen WFS, nur WMS.
 * WMS: https://www.wms.nrw.de/boris/wms_nw_brw (aktueller Jahrgang)
 * WMS-T: https://www.wms.nrw.de/boris/wms-t_nw_brw (ab 2011)
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export class NRWAdapter {
    state = 'Nordrhein-Westfalen';
    stateCode = 'NW';
    isFallback = false;
    // WMS Endpunkte (aktuell zuerst, dann time-enabled als Fallback)
    wmsEndpoints = [
        'https://www.wms.nrw.de/boris/wms_nw_brw',
        'https://www.wms.nrw.de/boris/wms-t_nw_brw',
    ];
    // Layer-Kandidaten (typische NRW Namenskonventionen)
    layerCandidates = [
        'brw',
        'BRW',
        'bodenrichtwerte',
        'Bodenrichtwerte',
        'nw_brw',
        'boris',
        'Bodenrichtwertzonen',
    ];
    // Cache für entdeckte Layer
    discoveredLayers = {};
    async getBodenrichtwert(lat, lon) {
        for (const wmsUrl of this.wmsEndpoints) {
            try {
                const result = await this.queryEndpoint(lat, lon, wmsUrl);
                if (result)
                    return result;
            }
            catch (err) {
                console.warn(`NRW WMS ${wmsUrl} error:`, err);
            }
        }
        console.error('NRW adapter: Kein Treffer mit allen WMS-Endpunkten');
        return null;
    }
    async queryEndpoint(lat, lon, wmsUrl) {
        // Layer-Discovery per GetCapabilities (nur beim ersten Mal)
        let layers = this.discoveredLayers[wmsUrl];
        if (!layers) {
            layers = await this.discoverLayers(wmsUrl);
            this.discoveredLayers[wmsUrl] = layers;
            console.log(`NRW WMS: Discovered layers for ${wmsUrl}:`, layers);
        }
        // Falls keine Layer entdeckt, versuche Kandidaten
        const layersToTry = layers.length > 0 ? layers : this.layerCandidates;
        for (const layer of layersToTry) {
            // Versuche text/xml
            try {
                const result = await this.queryWmsLayer(lat, lon, wmsUrl, layer, 'text/xml');
                if (result)
                    return result;
            }
            catch { /* next */ }
            // Versuche text/html
            try {
                const result = await this.queryWmsLayer(lat, lon, wmsUrl, layer, 'text/html');
                if (result)
                    return result;
            }
            catch { /* next */ }
            // Versuche application/json (manche WMS unterstützen das)
            try {
                const result = await this.queryWmsLayer(lat, lon, wmsUrl, layer, 'application/json');
                if (result)
                    return result;
            }
            catch { /* next */ }
        }
        return null;
    }
    /** GetCapabilities abfragen um verfügbare Layer zu finden */
    async discoverLayers(wmsUrl) {
        try {
            const params = new URLSearchParams({
                SERVICE: 'WMS',
                VERSION: '1.3.0',
                REQUEST: 'GetCapabilities',
            });
            const res = await fetch(`${wmsUrl}?${params}`, {
                headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return [];
            const xml = await res.text();
            // Queryable Layer-Namen extrahieren
            const layers = [];
            // Match <Layer queryable="1"> ... <Name>layerName</Name>
            const layerRegex = /<Layer[^>]*queryable=["']1["'][^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
            let match;
            while ((match = layerRegex.exec(xml)) !== null) {
                layers.push(match[1].trim());
            }
            // Falls keine queryable gefunden, alle Layer-Namen nehmen
            if (layers.length === 0) {
                const nameRegex = /<Layer[^>]*>\s*<Name>([^<]+)<\/Name>/g;
                while ((match = nameRegex.exec(xml)) !== null) {
                    const name = match[1].trim();
                    if (name && !name.includes('WMS') && !name.includes('Service')) {
                        layers.push(name);
                    }
                }
            }
            return layers;
        }
        catch (err) {
            console.warn('NRW GetCapabilities error:', err);
            return [];
        }
    }
    async queryWmsLayer(lat, lon, wmsUrl, layer, infoFormat) {
        // WMS 1.3.0: CRS=EPSG:4326 → Achsenreihenfolge lat,lon
        const delta = 0.001;
        const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`;
        const params = new URLSearchParams({
            SERVICE: 'WMS',
            VERSION: '1.3.0',
            REQUEST: 'GetFeatureInfo',
            LAYERS: layer,
            QUERY_LAYERS: layer,
            CRS: 'EPSG:4326',
            BBOX: bbox,
            WIDTH: '101',
            HEIGHT: '101',
            I: '50',
            J: '50',
            INFO_FORMAT: infoFormat,
            FEATURE_COUNT: '5',
            STYLES: '',
            FORMAT: 'image/png',
        });
        const res = await fetch(`${wmsUrl}?${params}`, {
            headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            return null;
        const text = await res.text();
        // Leere Antworten oder Fehler
        if (!text || text.length < 20)
            return null;
        if (text.includes('ServiceException') || text.includes('ExceptionReport'))
            return null;
        // Debug bei erstem Treffer
        console.log(`NRW WMS [${layer}/${infoFormat}] response (500 chars):`, text.substring(0, 500));
        if (infoFormat === 'application/json') {
            return this.parseJsonResponse(text, layer);
        }
        else if (infoFormat === 'text/xml') {
            return this.parseXmlResponse(text, layer);
        }
        else {
            return this.parseHtmlResponse(text, layer);
        }
    }
    parseJsonResponse(text, layer) {
        try {
            const json = JSON.parse(text);
            const features = json.features;
            if (!features?.length)
                return null;
            const wohn = features.find((f) => (f.properties?.nutzungsart || '').startsWith('W')) || features[0];
            const p = wohn.properties;
            const wert = p.brw || p.BRW || p.bodenrichtwert || p.wert || p.richtwert || 0;
            if (!wert || wert <= 0)
                return null;
            return {
                wert,
                stichtag: p.stichtag || p.STICHTAG || 'aktuell',
                nutzungsart: p.nutzungsart || p.NUTZUNGSART || 'unbekannt',
                entwicklungszustand: p.entwicklungszustand || p.ENTWICKLUNGSZUSTAND || 'B',
                zone: p.brw_zone || p.zone || p.lage || '',
                gemeinde: p.gemeinde || p.gemeinde_name || p.ort || '',
                bundesland: 'Nordrhein-Westfalen',
                quelle: 'BORIS-NRW',
                lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
            };
        }
        catch {
            return null;
        }
    }
    parseXmlResponse(xml, layer) {
        const wert = this.extractNumberFromXml(xml, [
            'brw', 'BRW', 'bodenrichtwert', 'Bodenrichtwert', 'wert', 'Wert', 'richtwert',
        ]);
        if (!wert || wert <= 0)
            return null;
        return {
            wert,
            stichtag: this.extractFieldFromXml(xml, ['stichtag', 'STICHTAG', 'Stichtag']) || 'aktuell',
            nutzungsart: this.extractFieldFromXml(xml, ['nutzungsart', 'NUTZUNGSART', 'Nutzungsart']) || 'unbekannt',
            entwicklungszustand: this.extractFieldFromXml(xml, ['entwicklungszustand', 'ENTWICKLUNGSZUSTAND']) || 'B',
            zone: this.extractFieldFromXml(xml, ['brw_zone', 'zone', 'lage']) || '',
            gemeinde: this.extractFieldFromXml(xml, ['gemeinde', 'Gemeinde', 'ort', 'name']) || '',
            bundesland: 'Nordrhein-Westfalen',
            quelle: 'BORIS-NRW',
            lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
        };
    }
    parseHtmlResponse(html, layer) {
        // HTML-Tags und CSS entfernen für Textsuche
        const plainText = html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ');
        // EUR/m²-Wert aus HTML/Text extrahieren
        const patterns = [
            /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m²|€\/m²|EUR\/qm|€\/qm|EUR\/m&sup2;)/i,
            /(?:Bodenrichtwert|BRW|Richtwert)[:\s]*(\d+(?:[.,]\d+)?)/i,
            /(\d+(?:[.,]\d+)?)\s*(?:EUR|€)/i,
        ];
        let wert = null;
        for (const pattern of patterns) {
            // Versuche in beiden Varianten (original HTML und stripped text)
            const match = html.match(pattern) || plainText.match(pattern);
            if (match) {
                wert = parseFloat(match[1].replace(',', '.'));
                if (wert > 0)
                    break;
            }
        }
        if (!wert || wert <= 0)
            return null;
        // Stichtag aus HTML/Text
        const stichtagMatch = plainText.match(/(?:Stichtag|stichtag)[:\s]*(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})/i);
        // Gemeinde aus reinem Text extrahieren (kein CSS-Müll)
        const gemeindeMatch = plainText.match(/(?:Gemeinde|Gemeindename)[:\s]+([A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\s\-]+)/);
        // Nutzungsart
        const nutzungsartMatch = plainText.match(/(?:Nutzungsart|nutzung)[:\s]*([A-Za-zÄÖÜäöü\s]+?)(?:\s{2,}|\s*$)/i);
        return {
            wert,
            stichtag: stichtagMatch ? stichtagMatch[1] : 'aktuell',
            nutzungsart: nutzungsartMatch ? nutzungsartMatch[1].trim() : 'unbekannt',
            entwicklungszustand: 'B',
            zone: '',
            gemeinde: gemeindeMatch ? gemeindeMatch[1].trim() : '',
            bundesland: 'Nordrhein-Westfalen',
            quelle: 'BORIS-NRW',
            lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
        };
    }
    extractNumberFromXml(xml, fields) {
        for (const field of fields) {
            // 1) Element-Content: <BRW>630</BRW> oder <ns:BRW>630</ns:BRW>
            const tagRe = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${field}(?:\\s[^>]*)?>([\\d.,]+)<`, 'i');
            const tagMatch = xml.match(tagRe);
            if (tagMatch) {
                const val = this.parseGermanNumber(tagMatch[1]);
                if (val !== null)
                    return val;
            }
            // 2) Attribut-Format: Bodenrichtwert="630" (NRW FIELDS-Style)
            const attrRe = new RegExp(`\\b${field}="([\\d.,]+)"`, 'i');
            const attrMatch = xml.match(attrRe);
            if (attrMatch) {
                const val = this.parseGermanNumber(attrMatch[1]);
                if (val !== null)
                    return val;
            }
        }
        return null;
    }
    parseGermanNumber(numStr) {
        if (numStr.includes(',')) {
            numStr = numStr.replace(/\./g, '').replace(',', '.');
        }
        const val = parseFloat(numStr);
        return (val > 0 && isFinite(val)) ? val : null;
    }
    extractFieldFromXml(xml, fields) {
        for (const field of fields) {
            // 1) Element-Content: <Stichtag>2024-01-01</Stichtag>
            const tagRe = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${field}(?:\\s[^>]*)?>([^<]+)<`, 'i');
            const tagMatch = xml.match(tagRe);
            if (tagMatch)
                return tagMatch[1].trim();
            // 2) Attribut-Format: Stichtag="01.01.2024" (NRW FIELDS-Style)
            const attrRe = new RegExp(`\\b${field}="([^"]*)"`, 'i');
            const attrMatch = xml.match(attrRe);
            if (attrMatch && attrMatch[1].trim())
                return attrMatch[1].trim();
        }
        return null;
    }
    async healthCheck() {
        try {
            const params = new URLSearchParams({
                SERVICE: 'WMS',
                VERSION: '1.3.0',
                REQUEST: 'GetCapabilities',
            });
            const res = await fetch(`${this.wmsEndpoints[0]}?${params}`, {
                signal: AbortSignal.timeout(5000),
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=nrw.js.map