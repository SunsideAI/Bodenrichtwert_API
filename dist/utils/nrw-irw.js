/**
 * BORIS-NRW Immobilienrichtwerte (IRW) — Amtliche Vergleichswerte.
 *
 * Ruft über WMS GetFeatureInfo die offiziellen Immobilienrichtwerte
 * der Gutachterausschüsse NRW ab. IRW liefern EUR/m² Wohnfläche
 * für ein standorttypisches Normobjekt (inkl. Boden + Gebäude).
 *
 * Teilmärkte: EFH, ZFH, RDH (Reihen-/Doppelhaus), ETW, MFH
 *
 * Datenquelle: https://www.wms.nrw.de/boris/wms_nw_irw
 * Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
 */
// ─── WMS Konfiguration ──────────────────────────────────────────────────────
const WMS_ENDPOINTS = [
    'https://www.wms.nrw.de/boris/wms_nw_irw',
    'https://www.wms.nrw.de/boris/wms-t_nw_irw',
];
const LAYER_CANDIDATES = [
    'irw',
    'IRW',
    'immobilienrichtwerte',
    'Immobilienrichtwerte',
    'nw_irw',
    'Immobilienrichtwertzonen',
];
// Layer-Discovery-Cache
let _discoveredLayers = {};
// ─── Hauptfunktion ──────────────────────────────────────────────────────────
/**
 * Ruft den Immobilienrichtwert für eine NRW-Koordinate ab.
 * Versucht beide WMS-Endpunkte mit Layer-Discovery.
 *
 * @param lat - Breitengrad (WGS84)
 * @param lon - Längengrad (WGS84)
 * @param teilmarktFilter - Optionaler Teilmarkt-Filter (z.B. "EFH", "ETW")
 * @returns IRW-Daten oder null
 */
export async function fetchImmobilienrichtwert(lat, lon, teilmarktFilter) {
    for (const wmsUrl of WMS_ENDPOINTS) {
        try {
            const result = await queryIrwEndpoint(lat, lon, wmsUrl, teilmarktFilter);
            if (result)
                return result;
        }
        catch (err) {
            console.warn(`NRW IRW WMS ${wmsUrl} error:`, err);
        }
    }
    return null;
}
// ─── WMS Queries ────────────────────────────────────────────────────────────
async function queryIrwEndpoint(lat, lon, wmsUrl, teilmarktFilter) {
    // Layer-Discovery
    let layers = _discoveredLayers[wmsUrl];
    if (!layers) {
        layers = await discoverLayers(wmsUrl);
        _discoveredLayers[wmsUrl] = layers;
        if (layers.length > 0) {
            console.log(`NRW IRW: Discovered layers for ${wmsUrl}:`, layers);
        }
    }
    const layersToTry = layers.length > 0 ? layers : LAYER_CANDIDATES;
    for (const layer of layersToTry) {
        for (const format of ['text/xml', 'text/html', 'application/json']) {
            try {
                const result = await queryWmsLayer(lat, lon, wmsUrl, layer, format, teilmarktFilter);
                if (result)
                    return result;
            }
            catch { /* next format/layer */ }
        }
    }
    return null;
}
async function discoverLayers(wmsUrl) {
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
        const layers = [];
        // Queryable Layer
        const queryableRegex = /<Layer[^>]*queryable=["']1["'][^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
        let match;
        while ((match = queryableRegex.exec(xml)) !== null) {
            layers.push(match[1].trim());
        }
        // Fallback: alle Layer-Namen
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
        console.warn('NRW IRW GetCapabilities error:', err);
        return [];
    }
}
async function queryWmsLayer(lat, lon, wmsUrl, layer, infoFormat, teilmarktFilter) {
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
        FEATURE_COUNT: '10',
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
    if (!text || text.length < 20)
        return null;
    if (text.includes('ServiceException') || text.includes('ExceptionReport'))
        return null;
    console.log(`NRW IRW [${layer}/${infoFormat}] response (500 chars):`, text.substring(0, 500));
    let results;
    if (infoFormat === 'application/json') {
        results = parseJsonResponse(text);
    }
    else if (infoFormat === 'text/xml') {
        results = parseXmlResponse(text);
    }
    else {
        results = parseHtmlResponse(text);
    }
    if (results.length === 0)
        return null;
    // Teilmarkt-Filter anwenden
    if (teilmarktFilter) {
        const filter = teilmarktFilter.toLowerCase();
        const matched = results.find((r) => r.teilmarkt.toLowerCase().includes(filter));
        if (matched)
            return matched;
    }
    // Erstes Ergebnis zurückgeben
    return results[0];
}
// ─── Response-Parser ────────────────────────────────────────────────────────
function parseJsonResponse(text) {
    try {
        const json = JSON.parse(text);
        const features = json.features;
        if (!features?.length)
            return [];
        return features
            .map((f) => {
            const p = f.properties || {};
            const irw = p.irw || p.IRW || p.immobilienrichtwert || p.richtwert || p.wert || 0;
            if (!irw || irw <= 0)
                return null;
            return {
                irw,
                teilmarkt: p.teilmarkt || p.TEILMARKT || p.objektart || p.OBJEKTART || 'unbekannt',
                stichtag: p.stichtag || p.STICHTAG || 'aktuell',
                normobjekt: {
                    baujahr: p.baujahr || p.BAUJAHR || p.normobjekt_baujahr || undefined,
                    wohnflaeche: p.wohnflaeche || p.WOHNFLAECHE || p.normobjekt_wohnflaeche || undefined,
                    grundstuecksflaeche: p.grundstuecksflaeche || p.GRUNDSTUECKSFLAECHE || undefined,
                    gebaeudeart: p.gebaeudeart || p.GEBAEUDEART || p.objektunterart || undefined,
                },
                gemeinde: p.gemeinde || p.GEMEINDE || p.gemeinde_name || p.ort || '',
                quelle: 'BORIS-NRW Immobilienrichtwerte',
            };
        })
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
function parseXmlResponse(xml) {
    const irw = extractNumberFromXml(xml, [
        'irw', 'IRW', 'immobilienrichtwert', 'Immobilienrichtwert', 'richtwert', 'wert',
    ]);
    if (!irw || irw <= 0)
        return [];
    return [{
            irw,
            teilmarkt: extractFieldFromXml(xml, ['teilmarkt', 'TEILMARKT', 'objektart', 'OBJEKTART']) || 'unbekannt',
            stichtag: extractFieldFromXml(xml, ['stichtag', 'STICHTAG', 'Stichtag']) || 'aktuell',
            normobjekt: {
                baujahr: extractNumberFromXml(xml, ['baujahr', 'BAUJAHR', 'normobjekt_baujahr']) ?? undefined,
                wohnflaeche: extractNumberFromXml(xml, ['wohnflaeche', 'WOHNFLAECHE', 'normobjekt_wohnflaeche']) ?? undefined,
                grundstuecksflaeche: extractNumberFromXml(xml, ['grundstuecksflaeche', 'GRUNDSTUECKSFLAECHE']) ?? undefined,
                gebaeudeart: extractFieldFromXml(xml, ['gebaeudeart', 'GEBAEUDEART', 'objektunterart']) ?? undefined,
            },
            gemeinde: extractFieldFromXml(xml, ['gemeinde', 'Gemeinde', 'ort', 'name']) || '',
            quelle: 'BORIS-NRW Immobilienrichtwerte',
        }];
}
function parseHtmlResponse(html) {
    const plainText = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
    // IRW-Wert extrahieren (EUR/m² Wohnfläche)
    const patterns = [
        /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m²|€\/m²|EUR\/qm|€\/qm)/i,
        /(?:Immobilienrichtwert|IRW|Richtwert)[:\s]*(\d+(?:[.,]\d+)?)/i,
        /(\d+(?:[.,]\d+)?)\s*(?:EUR|€)/i,
    ];
    let irw = null;
    for (const pattern of patterns) {
        const match = html.match(pattern) || plainText.match(pattern);
        if (match) {
            irw = parseFloat(match[1].replace(',', '.'));
            if (irw > 0)
                break;
        }
    }
    if (!irw || irw <= 0)
        return [];
    const stichtagMatch = plainText.match(/(?:Stichtag|stichtag)[:\s]*(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})/i);
    const teilmarktMatch = plainText.match(/(?:Teilmarkt|Objektart)[:\s]*([A-Za-zÄÖÜäöüß\-\/\s]+?)(?:\s{2,}|$)/i);
    const gemeindeMatch = plainText.match(/(?:Gemeinde|Gemeindename)[:\s]+([A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\s\-]+)/);
    return [{
            irw,
            teilmarkt: teilmarktMatch ? teilmarktMatch[1].trim() : 'unbekannt',
            stichtag: stichtagMatch ? stichtagMatch[1] : 'aktuell',
            normobjekt: {},
            gemeinde: gemeindeMatch ? gemeindeMatch[1].trim() : '',
            quelle: 'BORIS-NRW Immobilienrichtwerte',
        }];
}
// ─── XML-Hilfsfunktionen ────────────────────────────────────────────────────
function parseGermanNumber(numStr) {
    if (numStr.includes(',')) {
        numStr = numStr.replace(/\./g, '').replace(',', '.');
    }
    const val = parseFloat(numStr);
    return (val > 0 && isFinite(val)) ? val : null;
}
function extractNumberFromXml(xml, fields) {
    for (const field of fields) {
        // 1) Element-Content: <IRW>630</IRW> oder <ns:IRW>630</ns:IRW>
        const tagRe = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${field}(?:\\s[^>]*)?>([\\d.,]+)<`, 'i');
        const tagMatch = xml.match(tagRe);
        if (tagMatch) {
            const val = parseGermanNumber(tagMatch[1]);
            if (val !== null)
                return val;
        }
        // 2) Attribut-Format: IRW="630" (NRW FIELDS-Style)
        const attrRe = new RegExp(`\\b${field}="([\\d.,]+)"`, 'i');
        const attrMatch = xml.match(attrRe);
        if (attrMatch) {
            const val = parseGermanNumber(attrMatch[1]);
            if (val !== null)
                return val;
        }
    }
    return null;
}
function extractFieldFromXml(xml, fields) {
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
//# sourceMappingURL=nrw-irw.js.map