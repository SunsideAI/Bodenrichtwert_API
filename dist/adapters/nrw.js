/**
 * Nordrhein-Westfalen Adapter
 *
 * Nutzt den BORIS-NRW WMS GetFeatureInfo-Endpunkt (ESRI ArcGIS Server).
 * NRW bietet keinen öffentlichen WFS, nur WMS.
 * WMS: https://www.wms.nrw.de/boris/wms_nw_brw (aktueller Jahrgang)
 * WMS-T: https://www.wms.nrw.de/boris/wms-t_nw_brw (ab 2011)
 *
 * ESRI-WMS liefert GetFeatureInfo als <FIELDS attr="val" /> Attribut-Format.
 * Layer-IDs können numerisch ("5") oder benannt ("brw_ein_zweigeschossig") sein.
 *
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
export class NRWAdapter {
    state = 'Nordrhein-Westfalen';
    stateCode = 'NW';
    isFallback = false;
    wmsEndpoints = [
        'https://www.wms.nrw.de/boris/wms_nw_brw',
        'https://www.wms.nrw.de/boris/wms-t_nw_brw',
    ];
    // Bekannte NRW BRW Layer-Namen (beide Namenskonventionen: benannt + offiziell)
    knownLayers = [
        'brw_ein_zweigeschossig',
        'brw_mehrgeschossige_bauweise',
        'BRW_Wohngebiete',
        'BRW_Mischgebiete',
        'BRW_Gewerbegebiete',
        'BRW_Sonderflaechen',
        'BRW_Sonstige_Flaechen',
        'Bodenrichtwerte',
        'Bodenrichtwertzonen',
        'brw',
        'BRW',
        'bodenrichtwerte',
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
        let discovered = this.discoveredLayers[wmsUrl];
        if (!discovered) {
            discovered = await this.discoverLayers(wmsUrl);
            this.discoveredLayers[wmsUrl] = discovered;
            if (discovered.length > 0) {
                console.log(`NRW WMS: Discovered layers for ${wmsUrl}:`, discovered);
            }
        }
        // Bekannte Layer zuerst, dann entdeckte (ohne Duplikate)
        const seen = new Set();
        const layersToTry = [];
        for (const l of [...this.knownLayers, ...discovered]) {
            if (!seen.has(l)) {
                seen.add(l);
                layersToTry.push(l);
            }
        }
        // Phase 1: Alle Layer parallel mit text/xml (ESRI-Standardformat)
        const xmlResults = await Promise.allSettled(layersToTry.map(layer => this.queryWmsXml(lat, lon, wmsUrl, layer)));
        for (const result of xmlResults) {
            if (result.status === 'fulfilled' && result.value)
                return result.value;
        }
        // Phase 2: HTML-Fallback nur für die ersten 3 Layer (falls XML-Format nicht unterstützt)
        for (const layer of layersToTry.slice(0, 3)) {
            try {
                const result = await this.queryWmsLayer(lat, lon, wmsUrl, layer, 'text/html');
                if (result)
                    return result;
            }
            catch { /* next */ }
        }
        return null;
    }
    /** Schnelle XML-Abfrage mit Early-Return bei leerer ESRI-Response */
    async queryWmsXml(lat, lon, wmsUrl, layer) {
        try {
            return await this.queryWmsLayer(lat, lon, wmsUrl, layer, 'text/xml');
        }
        catch {
            return null;
        }
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
            // Alle <Name>-Tags innerhalb von <Layer>-Blöcken extrahieren
            // ESRI WMS kann numerische ("5") oder benannte ("brw_ein_zweigeschossig") IDs haben
            const layers = [];
            const nameRegex = /<Layer[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
            let match;
            while ((match = nameRegex.exec(xml)) !== null) {
                const name = match[1].trim();
                // Root-Layer und Service-Meta überspringen
                if (name && !name.includes('WMS') && !name.includes('Service') && name !== '0') {
                    layers.push(name);
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
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok)
            return null;
        const text = await res.text();
        // Leere/ungültige Antworten früh filtern
        if (!text || text.length < 20)
            return null;
        if (text.includes('ServiceException') || text.includes('ExceptionReport'))
            return null;
        if (this.isEmptyResponse(text))
            return null;
        console.log(`NRW WMS [${layer}/${infoFormat}]: Daten gefunden (${text.length} bytes)`);
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
    /**
     * Erkennt leere ESRI WMS-Responses:
     * - Selbstschließendes XML: <FeatureInfoResponse ... />
     * - HTML nur mit CSS/Boilerplate ohne Tabellendaten
     */
    isEmptyResponse(text) {
        // ESRI leere XML-Response: selbstschließendes <FeatureInfoResponse/>
        if (text.includes('FeatureInfoResponse') && !text.includes('FIELDS') && !text.includes('<gml:')) {
            return true;
        }
        // HTML-Response ohne Daten: nur CSS-Boilerplate, keine <td>-Zellen mit Inhalt
        if (text.includes('<html') && !text.includes('<td')) {
            return true;
        }
        return false;
    }
    parseJsonResponse(text, layer) {
        try {
            const json = JSON.parse(text);
            const features = json.features;
            if (!features?.length)
                return null;
            const wohn = features.find((f) => (f.properties?.nutzungsart || '').startsWith('W')) || features[0];
            const p = wohn.properties;
            const wert = p.brw || p.BRW || p.bodenrichtwert || p.Bodenrichtwert || p.wert || p.richtwert || 0;
            if (!wert || wert <= 0)
                return null;
            return {
                wert,
                stichtag: p.stichtag || p.STICHTAG || p.Stichtag || 'aktuell',
                nutzungsart: p.nutzungsart || p.NUTZUNGSART || p.Nutzungsart || 'unbekannt',
                entwicklungszustand: p.entwicklungszustand || p.ENTWICKLUNGSZUSTAND || 'B',
                zone: p.brw_zone || p.zone || p.lage || '',
                gemeinde: p.gemeinde || p.gemeinde_name || p.Gemeinde || p.ort || '',
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
            zone: this.extractFieldFromXml(xml, ['brw_zone', 'zone', 'lage', 'Bemerkung', 'bemerkung']) || '',
            gemeinde: this.extractFieldFromXml(xml, ['gemeinde', 'Gemeinde', 'ort', 'Gemeindename']) || '',
            bundesland: 'Nordrhein-Westfalen',
            quelle: 'BORIS-NRW',
            lizenz: 'Datenlizenz Deutschland – Zero – Version 2.0',
        };
    }
    parseHtmlResponse(html, layer) {
        const plainText = html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ');
        const patterns = [
            /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m²|€\/m²|EUR\/qm|€\/qm|EUR\/m&sup2;)/i,
            /(?:Bodenrichtwert|BRW|Richtwert)[:\s]*(\d+(?:[.,]\d+)?)/i,
            /(\d+(?:[.,]\d+)?)\s*(?:EUR|€)/i,
        ];
        let wert = null;
        for (const pattern of patterns) {
            const match = html.match(pattern) || plainText.match(pattern);
            if (match) {
                wert = parseFloat(match[1].replace(',', '.'));
                if (wert > 0)
                    break;
            }
        }
        if (!wert || wert <= 0)
            return null;
        const stichtagMatch = plainText.match(/(?:Stichtag|stichtag)[:\s]*(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})/i);
        const gemeindeMatch = plainText.match(/(?:Gemeinde|Gemeindename)[:\s]+([A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\s\-]+)/);
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
            // 2) Attribut-Format: Bodenrichtwert="630" (ESRI FIELDS-Style)
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
            // 2) Attribut-Format: Stichtag="01.01.2024" (ESRI FIELDS-Style)
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