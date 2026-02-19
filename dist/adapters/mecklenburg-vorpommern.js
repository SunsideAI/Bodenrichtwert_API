/**
 * Mecklenburg-Vorpommern Adapter
 *
 * Versucht zuerst den öffentlichen WFS-Endpunkt, fällt bei 401 auf
 * alternative WMS/WFS-Endpunkte zurück.
 * Daten: Bodenrichtwerte nach BORIS.MV2.1 Datenmodell
 * CRS: EPSG:25833 (UTM Zone 33N)
 * Lizenz: GutALVO M-V (frei zugänglich)
 */
export class MecklenburgVorpommernAdapter {
    state = 'Mecklenburg-Vorpommern';
    stateCode = 'MV';
    isFallback = false;
    // WFS endpoints to try (WFS requires auth on some, WMS may be open)
    wfsUrls = [
        'https://www.geodaten-mv.de/dienste/bodenrichtwerte_wfs',
        'https://geoserver.geodaten-mv.de/geoserver/bodenrichtwerte/wfs',
        'https://www.geodaten-mv.de/geoserver/bodenrichtwerte/wfs',
    ];
    // WMS endpoints as fallback
    wmsUrls = [
        'https://www.geodaten-mv.de/dienste/bodenrichtwerte_wms',
        'https://www.geodaten-mv.de/geoserver/bodenrichtwerte/wms',
        'https://geoserver.geodaten-mv.de/geoserver/bodenrichtwerte/wms',
    ];
    // Cached discovered WMS layer names
    discoveredWmsLayers = null;
    // MV WMS layer names discovered from GetCapabilities.
    // The service has specific sub-layers: wohnbauflaeche, gemischte_bauflaeche, etc.
    // The group layer 'bodenrichtwerte' returns ALL sub-layers.
    // We prefer specific sub-layers (Wohnbau > Gemischt > Gewerbe > Sonder > group).
    wmsLayerCandidates = [
        'wohnbauflaeche',
        'gemischte_bauflaeche',
        'gewerbliche_bauflaeche',
        'sonderbauflaeche',
        'bodenrichtwerte', // group layer (returns all sub-layers)
    ];
    async getBodenrichtwert(lat, lon) {
        // Try WFS endpoints first
        for (const wfsUrl of this.wfsUrls) {
            try {
                const result = await this.tryWfsQuery(wfsUrl, lat, lon);
                if (result)
                    return result;
            }
            catch {
                // Try next
            }
        }
        // Discover WMS layer names via GetCapabilities if not yet done
        if (!this.discoveredWmsLayers) {
            await this.discoverWmsLayers();
        }
        // Fall back to WMS GetFeatureInfo using discovered + candidate layers
        const layersToTry = this.discoveredWmsLayers?.length
            ? [...this.discoveredWmsLayers, ...this.wmsLayerCandidates]
            : this.wmsLayerCandidates;
        for (const wmsUrl of this.wmsUrls) {
            for (const layer of layersToTry) {
                try {
                    const result = await this.tryWmsQuery(wmsUrl, lat, lon, layer);
                    if (result)
                        return result;
                }
                catch {
                    // Try next
                }
            }
        }
        return null;
    }
    async discoverWmsLayers() {
        for (const wmsUrl of this.wmsUrls) {
            try {
                const params = new URLSearchParams({
                    SERVICE: 'WMS',
                    VERSION: '1.1.1',
                    REQUEST: 'GetCapabilities',
                });
                const res = await fetch(`${wmsUrl}?${params}`, {
                    headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                    signal: AbortSignal.timeout(8000),
                });
                if (!res.ok)
                    continue;
                const xml = await res.text();
                if (!xml.includes('<WMT_MS_Capabilities') && !xml.includes('<WMS_Capabilities'))
                    continue;
                const layers = [...xml.matchAll(/<Name>([^<]+)<\/Name>/gi)]
                    .map(m => m[1].trim())
                    .filter(n => n.length > 0 && n.length < 120 && !n.includes('http'));
                const brwLayers = layers.filter(n => n.toLowerCase().includes('brw') ||
                    n.toLowerCase().includes('bodenrichtwert') ||
                    n.toLowerCase().includes('vboris'));
                if (brwLayers.length > 0) {
                    console.log(`MV WMS: Discovered layers: ${brwLayers.join(', ')}`);
                    this.discoveredWmsLayers = brwLayers;
                    return;
                }
                if (layers.length > 0) {
                    this.discoveredWmsLayers = layers;
                    return;
                }
            }
            catch {
                // Try next URL
            }
        }
        this.discoveredWmsLayers = [];
    }
    async tryWfsQuery(wfsUrl, lat, lon) {
        const delta = 0.0005;
        const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;
        const params = new URLSearchParams({
            service: 'WFS',
            version: '2.0.0',
            request: 'GetFeature',
            typeNames: 'boris:bodenrichtwert',
            bbox: bbox,
            outputFormat: 'application/json',
            count: '5',
        });
        const url = `${wfsUrl}?${params}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                console.error(`MV WFS auth error: ${res.status} at ${wfsUrl}`);
            }
            return null;
        }
        const text = await res.text();
        if (!text.trimStart().startsWith('{'))
            return null;
        const json = JSON.parse(text);
        if (!json.features?.length)
            return null;
        // Prefer Wohnbau
        const wohn = json.features.find((f) => {
            const nutzung = f.properties?.nutzungsart || f.properties?.NUTZUNG || '';
            return nutzung.startsWith('W') || nutzung.toLowerCase().includes('wohn');
        }) || json.features[0];
        const p = wohn.properties;
        const wertRaw = p.bodenrichtwert ?? p.brw ?? p.BRW ?? p.wert ?? 0;
        const wert = parseFloat(String(wertRaw));
        if (!wert || wert <= 0 || wert > 500_000)
            return null;
        return {
            wert,
            stichtag: p.stichtag || p.STICHTAG || 'unbekannt',
            nutzungsart: p.nutzungsart || p.NUTZUNG || 'unbekannt',
            entwicklungszustand: p.entwicklungszustand || p.ENTW || 'B',
            zone: p.zone || p.brw_zone || p.ZONE || '',
            gemeinde: p.gemeinde || p.GEMEINDE || p.gemeinde_name || '',
            bundesland: 'Mecklenburg-Vorpommern',
            quelle: 'BORIS-MV',
            lizenz: '© LAiV M-V',
        };
    }
    async tryWmsQuery(wmsUrl, lat, lon, layer) {
        const delta = 0.001;
        const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
        // text/plain is best (structured key=value), then GML, then text/xml
        for (const infoFormat of ['text/plain', 'application/vnd.ogc.gml', 'text/xml']) {
            try {
                const params = new URLSearchParams({
                    SERVICE: 'WMS',
                    VERSION: '1.1.1',
                    REQUEST: 'GetFeatureInfo',
                    LAYERS: layer,
                    QUERY_LAYERS: layer,
                    SRS: 'EPSG:4326',
                    BBOX: bbox,
                    WIDTH: '101',
                    HEIGHT: '101',
                    X: '50',
                    Y: '50',
                    INFO_FORMAT: infoFormat,
                    FEATURE_COUNT: '10',
                    STYLES: '',
                    FORMAT: 'image/png',
                });
                const url = `${wmsUrl}?${params}`;
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
                    signal: AbortSignal.timeout(10000),
                });
                if (!res.ok)
                    continue;
                const text = await res.text();
                if (text.includes('ServiceException') || text.includes('ExceptionReport'))
                    continue;
                if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html'))
                    continue;
                if (text.trim().length < 30)
                    continue;
                // For group layer 'bodenrichtwerte', the response contains multiple Layer sections.
                // Parse each section and prefer Wohnbau > Gemischt > Gewerbe > Sonder over Forst/Grünland.
                const result = this.parseBestFeature(text, layer);
                if (result)
                    return result;
            }
            catch {
                // Try next format
            }
        }
        return null;
    }
    /**
     * Parse the best feature from a (possibly multi-layer) text/plain or GML response.
     * MV uses VBORIS short-form fields: brwkon, stag, entw, nuta, gabe, ortst, class.
     * For group layer, prefer building land over forest/agriculture.
     */
    parseBestFeature(text, queriedLayer) {
        // Split into layer sections for text/plain responses
        const sections = text.split(/(?=Layer ')/);
        // Priority order for sub-layer types
        const layerPriority = {
            'wohnbauflaeche': 1,
            'gemischte_bauflaeche': 2,
            'sonderbauflaeche': 3,
            'gewerbliche_bauflaeche': 4,
            'bebaute_flaeche_im_aussenbereich': 5,
            'sanierungsgebiet': 6,
            'sonstige_flaechen': 7,
            'ackerland': 90,
            'gruenland': 91,
            'forst': 92,
        };
        let bestResult = null;
        let bestPriority = 999;
        for (const section of sections) {
            // Identify layer name from section header
            const layerMatch = section.match(/Layer '([^']+)'/);
            const sectionLayer = layerMatch ? layerMatch[1] : queriedLayer;
            const priority = layerPriority[sectionLayer] ?? 50;
            const wert = this.extractValue(section);
            if (!wert || wert <= 0)
                continue;
            // Skip very low values from forest/agriculture if we already have building land
            if (wert < 1 && priority > 50)
                continue;
            if (priority < bestPriority) {
                bestPriority = priority;
                bestResult = {
                    wert,
                    stichtag: this.extractField(section, 'stag') || this.extractField(section, 'stichtag') || this.extractField(section, 'STAG') || 'unbekannt',
                    nutzungsart: this.extractField(section, 'nuta') || this.extractField(section, 'nutzungsart') || this.extractField(section, 'NUTA') || this.extractField(section, 'class') || 'unbekannt',
                    entwicklungszustand: this.extractField(section, 'entw') || this.extractField(section, 'entwicklungszustand') || this.extractField(section, 'ENTW') || 'B',
                    zone: this.extractField(section, 'wnum') || this.extractField(section, 'zone') || this.extractField(section, 'WNUM') || '',
                    gemeinde: this.extractField(section, 'ortst') || this.extractField(section, 'gabe') || this.extractField(section, 'gemeinde') || this.extractField(section, 'GENA') || '',
                    bundesland: 'Mecklenburg-Vorpommern',
                    quelle: `BORIS-MV (WMS/${sectionLayer})`,
                    lizenz: '© LAiV M-V',
                };
            }
        }
        // If no sections found (non-text/plain or single-layer response), try whole text
        if (!bestResult) {
            const wert = this.extractValue(text);
            if (wert && wert > 0) {
                bestResult = {
                    wert,
                    stichtag: this.extractField(text, 'stag') || this.extractField(text, 'stichtag') || 'unbekannt',
                    nutzungsart: this.extractField(text, 'nuta') || this.extractField(text, 'nutzungsart') || this.extractField(text, 'class') || 'unbekannt',
                    entwicklungszustand: this.extractField(text, 'entw') || this.extractField(text, 'entwicklungszustand') || 'B',
                    zone: this.extractField(text, 'wnum') || this.extractField(text, 'zone') || '',
                    gemeinde: this.extractField(text, 'ortst') || this.extractField(text, 'gabe') || this.extractField(text, 'gemeinde') || '',
                    bundesland: 'Mecklenburg-Vorpommern',
                    quelle: 'BORIS-MV (WMS)',
                    lizenz: '© LAiV M-V',
                };
            }
        }
        return bestResult;
    }
    extractValue(text) {
        const patterns = [
            // text/plain key=value format (MV uses brwkon as field name)
            /^\s*brwkon\s*=\s*'?([\d.,]+)'?/im,
            /^\s*BRW\s*=\s*'?([\d.,]+)'?/im,
            /^\s*BODENRICHTWERT(?:_TEXT|_LABEL)?\s*=\s*'?([\d.,]+)'?/im,
            // XML elements (allow attributes in opening tag)
            /<(?:[a-zA-Z]+:)?brwkon(?:\s[^>]*)?>(\d+(?:[.,]\d+)?)</i,
            /<(?:[a-zA-Z]+:)?BRW(?:\s[^>]*)?>(\d+(?:[.,]\d+)?)</i,
            /<(?:[a-zA-Z]+:)?bodenrichtwert(?:\s[^>]*)?>(\d+(?:[.,]\d+)?)</i,
            // XML attribute
            /\bBRW="(\d+(?:[.,]\d+)?)"/i,
            /\bbrwkon="(\d+(?:[.,]\d+)?)"/i,
            // EUR/m² unit marker
            /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m|€\/m)/i,
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                let numStr = match[1];
                if (numStr.includes(',')) {
                    numStr = numStr.replace(/\./g, '').replace(',', '.');
                }
                const val = parseFloat(numStr);
                if (val > 0 && val <= 500_000 && isFinite(val))
                    return val;
            }
        }
        return null;
    }
    extractField(text, field) {
        // text/plain key=value: FIELD = 'VALUE'
        const plainRe = new RegExp(`^\\s*${field}\\s*=\\s*'?([^'\\n]*)'?`, 'im');
        const plainMatch = text.match(plainRe);
        if (plainMatch)
            return plainMatch[1].trim();
        // XML attribute
        const attrRe = new RegExp(`\\b${field}="([^"]*)"`, 'i');
        const attrMatch = text.match(attrRe);
        if (attrMatch)
            return attrMatch[1].trim();
        // XML element
        const re = new RegExp(`<(?:[a-zA-Z]+:)?${field}(?:\\s[^>]*)?>([^<]+)<`, 'i');
        const match = text.match(re);
        return match ? match[1].trim() : null;
    }
    async healthCheck() {
        for (const url of this.wfsUrls) {
            try {
                const params = new URLSearchParams({
                    service: 'WFS',
                    version: '2.0.0',
                    request: 'GetCapabilities',
                });
                const res = await fetch(`${url}?${params}`, {
                    signal: AbortSignal.timeout(5000),
                });
                if (res.ok)
                    return true;
            }
            catch {
                // Try next
            }
        }
        return false;
    }
}
//# sourceMappingURL=mecklenburg-vorpommern.js.map