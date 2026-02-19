/**
 * Bayern Adapter
 *
 * Nutzt das neue VBORIS-Portal (seit August 2025):
 * https://geoportal.bayern.de/bodenrichtwerte/vboris
 *
 * Die alte URL (geoservices.bayern.de/wms/v1/ogc_bodenrichtwerte.cgi)
 * gibt seit ~2025 HTTP 404 zurück.
 *
 * Layer: bodenrichtwerte_aktuell (queryable=1, bestätigt via GetCapabilities)
 * CRS: EPSG:4326, EPSG:25832, EPSG:3857, EPSG:31468 (alle bestätigt)
 * GetFeatureInfo-Formate: text/plain, text/html, application/vnd.ogc.gml
 * WMS-Version: 1.1.1
 *
 * HINWEIS: Die meisten Gutachterausschüsse in Bayern geben
 * "Information gebührenpflichtig" für den BRW-Wert zurück.
 * Getestet: München, Augsburg, Nürnberg, Garmisch-Partenkirchen — alle paywalled.
 * Nur wenige Stellen sind öffentlich zugänglich.
 * Der Adapter gibt null zurück wenn der Wert gebührenpflichtig ist.
 *
 * Lizenz: © Bayerische Vermessungsverwaltung (www.geodaten.bayern.de)
 */
export class BayernAdapter {
    state = 'Bayern';
    stateCode = 'BY';
    isFallback = false;
    // VBORIS-Portal (bestätigt via curl, GetCapabilities 200 OK)
    wmsUrls = [
        'https://geoportal.bayern.de/bodenrichtwerte/vboris',
    ];
    // Bestätigt via GetCapabilities XML
    layerCandidates = [
        'bodenrichtwerte_aktuell',
        'Bodenrichtwerte',
    ];
    discoveredLayers = {};
    async getBodenrichtwert(lat, lon) {
        for (const wmsUrl of this.wmsUrls) {
            try {
                const result = await this.queryEndpoint(lat, lon, wmsUrl);
                if (result)
                    return result;
            }
            catch (err) {
                console.warn(`BY WMS ${wmsUrl} error:`, err);
            }
        }
        console.error('BY adapter: Kein Treffer mit allen WMS-URLs/Layer/Format/CRS-Kombinationen');
        return null;
    }
    async queryEndpoint(lat, lon, wmsUrl) {
        if (!this.discoveredLayers[wmsUrl]) {
            this.discoveredLayers[wmsUrl] = await this.discoverLayers(wmsUrl);
            console.log(`BY WMS ${wmsUrl}: Discovered layers:`, this.discoveredLayers[wmsUrl]);
        }
        const layersToTry = this.discoveredLayers[wmsUrl].length > 0
            ? this.discoveredLayers[wmsUrl]
            : this.layerCandidates;
        // VBORIS unterstützt: text/plain, text/html, application/vnd.ogc.gml
        const formats = ['text/plain', 'application/vnd.ogc.gml', 'text/html'];
        for (const layer of layersToTry) {
            // EPSG:4326 direkt mit lat/lon (bestätigt via curl)
            for (const fmt of formats) {
                try {
                    const result = await this.queryWms(lat, lon, wmsUrl, layer, fmt, 'EPSG:4326');
                    if (result)
                        return result;
                }
                catch { /* nächste Kombination */ }
            }
            // Fallback: EPSG:25832 (UTM-Konvertierung)
            for (const fmt of formats) {
                try {
                    const result = await this.queryWms(lat, lon, wmsUrl, layer, fmt, 'EPSG:25832');
                    if (result)
                        return result;
                }
                catch { /* nächste Kombination */ }
            }
        }
        return null;
    }
    async discoverLayers(wmsUrl) {
        try {
            const params = new URLSearchParams({
                SERVICE: 'WMS',
                VERSION: '1.1.1',
                REQUEST: 'GetCapabilities',
            });
            const res = await fetch(`${wmsUrl}?${params}`, {
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) {
                console.warn(`BY GetCapabilities ${wmsUrl}: HTTP ${res.status}`);
                return [];
            }
            const xml = await res.text();
            const layers = [];
            // Queryable Layer bevorzugen
            const queryableRegex = /<Layer[^>]*queryable=["']1["'][^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/g;
            let match;
            while ((match = queryableRegex.exec(xml)) !== null) {
                const name = match[1].trim();
                // Filter OGC:WMS service name
                if (name && !name.startsWith('OGC:')) {
                    layers.push(name);
                }
            }
            if (layers.length > 0) {
                console.log(`BY GetCapabilities: Found ${layers.length} layers:`, layers);
                return layers;
            }
        }
        catch (err) {
            console.warn(`BY GetCapabilities error:`, err);
        }
        return [];
    }
    async queryWms(lat, lon, wmsUrl, layer, infoFormat, srs) {
        let bbox;
        if (srs === 'EPSG:25832') {
            const [e, n] = this.wgs84ToUtm32(lat, lon);
            const delta = 50;
            bbox = `${e - delta},${n - delta},${e + delta},${n + delta}`;
        }
        else {
            // WMS 1.1.1 + EPSG:4326: BBOX = minlon,minlat,maxlon,maxlat
            const delta = 0.001;
            bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
        }
        const params = new URLSearchParams({
            SERVICE: 'WMS',
            VERSION: '1.1.1',
            REQUEST: 'GetFeatureInfo',
            LAYERS: layer,
            QUERY_LAYERS: layer,
            SRS: srs,
            BBOX: bbox,
            WIDTH: '101',
            HEIGHT: '101',
            X: '50',
            Y: '50',
            INFO_FORMAT: infoFormat,
            FEATURE_COUNT: '5',
            STYLES: '',
            FORMAT: 'image/png',
        });
        const res = await fetch(`${wmsUrl}?${params}`, {
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok)
            return null;
        const text = await res.text();
        if (!text || text.length < 10)
            return null;
        if (text.includes('ServiceException') || text.includes('ExceptionReport'))
            return null;
        console.log(`BY WMS [${layer}/${infoFormat}/${srs}] response (300 chars):`, text.substring(0, 300));
        if (infoFormat === 'text/plain')
            return this.parseTextPlain(text);
        if (infoFormat === 'application/vnd.ogc.gml')
            return this.parseXml(text);
        return this.parseHtml(text);
    }
    // ─── WGS84 → UTM Zone 32N ────────────────────────────────────────────────
    wgs84ToUtm32(lat, lon) {
        const a = 6378137.0;
        const f = 1 / 298.257223563;
        const k0 = 0.9996;
        const e = Math.sqrt(2 * f - f * f);
        const e2 = e * e;
        const ep2 = e2 / (1 - e2);
        const lon0 = 9;
        const latRad = (lat * Math.PI) / 180;
        const lonRad = ((lon - lon0) * Math.PI) / 180;
        const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
        const T = Math.tan(latRad) ** 2;
        const C = ep2 * Math.cos(latRad) ** 2;
        const A = lonRad * Math.cos(latRad);
        const M = a *
            ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latRad -
                ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latRad) +
                ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad) -
                ((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad));
        const easting = 500000 +
            k0 *
                N *
                (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120);
        const northing = k0 *
            (M +
                N *
                    Math.tan(latRad) *
                    (A ** 2 / 2 +
                        ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
                        ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
        return [easting, northing];
    }
    // ─── Parser ────────────────────────────────────────────────────────────────
    parseTextPlain(text) {
        // VBORIS text/plain: "KEY = 'VALUE'" oder "KEY: VALUE"
        const get = (key) => {
            const patterns = [
                new RegExp(`^\\s*${key}\\s*=\\s*'?([^'\\n]*)'?`, 'im'),
                new RegExp(`${key}[:\\s]+([^\\n]+)`, 'im'),
            ];
            for (const re of patterns) {
                const m = text.match(re);
                if (m)
                    return m[1].trim();
            }
            return '';
        };
        const brwRaw = get('Bodenrichtwert') || get('BODENRICHTWERT') || get('BRW')
            || get('bodenrichtwert') || get('RICHTWERT') || get('brw');
        // "Information gebührenpflichtig" → kein numerischer Wert
        if (!brwRaw || brwRaw.includes('gebührenpflichtig')) {
            if (brwRaw.includes('gebührenpflichtig')) {
                console.log('BY VBORIS text/plain: BRW gebührenpflichtig');
            }
            return null;
        }
        const wert = parseFloat(brwRaw.replace(/\./g, '').replace(',', '.'));
        if (!wert || wert <= 0 || !isFinite(wert))
            return null;
        const stichtagRaw = get('Stichtag') || get('STICHTAG') || get('stichtag');
        return {
            wert,
            stichtag: this.convertDate(stichtagRaw) || stichtagRaw || 'aktuell',
            nutzungsart: get('Nutzungsart') || get('NUTZUNGSART') || 'unbekannt',
            entwicklungszustand: get('Entwicklungszustand') || get('ENTWICKLUNGSZUSTAND') || 'B',
            zone: get('Bodenrichtwertzonenname') || get('Bodenrichtwertnummer') || '',
            gemeinde: get('Gemeinde') || get('GEMEINDE') || '',
            bundesland: 'Bayern',
            quelle: 'BORIS-Bayern (Bayerische Vermessungsverwaltung)',
            lizenz: '© Bayerische Vermessungsverwaltung, www.geodaten.bayern.de',
        };
    }
    parseXml(xml) {
        const wert = this.extractNumber(xml, [
            'bodenrichtwert', 'BODENRICHTWERT', 'brw', 'BRW', 'wert', 'WERT', 'richtwert',
        ]);
        if (!wert || wert <= 0)
            return null;
        const stichtagRaw = this.extractField(xml, ['stichtag', 'STICHTAG', 'dat', 'DAT', 'datum']) || '';
        return {
            wert,
            stichtag: this.convertDate(stichtagRaw) || stichtagRaw || 'aktuell',
            nutzungsart: this.extractField(xml, ['nutzungsart', 'NUTZUNGSART', 'nutzung', 'art']) || 'unbekannt',
            entwicklungszustand: this.extractField(xml, ['entwicklungszustand', 'ENTWICKLUNGSZUSTAND', 'entw']) || 'B',
            zone: this.extractField(xml, ['bodenrichtwertzonenname', 'brwnummer', 'zone', 'brz', 'lage']) || '',
            gemeinde: this.extractField(xml, ['gemeinde', 'GEMEINDE', 'gem', 'ort']) || '',
            bundesland: 'Bayern',
            quelle: 'BORIS-Bayern (Bayerische Vermessungsverwaltung)',
            lizenz: '© Bayerische Vermessungsverwaltung, www.geodaten.bayern.de',
        };
    }
    parseHtml(html) {
        // VBORIS-spezifisch: strukturierte <td>Key</td><td>Value</td> Tabelle
        const result = this.parseVborisTable(html);
        if (result)
            return result;
        // Generischer Fallback: Freitext-Suche nach EUR/m²-Mustern
        return this.parseHtmlGeneric(html);
    }
    /**
     * Parser für die VBORIS-HTML-Tabelle (bestätigtes Format via curl).
     * Extrahiert Key-Value-Paare aus <td>Key</td><td>Value</td> Zeilen.
     */
    parseVborisTable(html) {
        // Alle <tr> mit genau 2 <td> Zellen extrahieren
        const rows = [...html.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)];
        if (rows.length === 0)
            return null;
        const data = {};
        for (const row of rows) {
            const key = row[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            const val = row[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (key && val)
                data[key] = val;
        }
        // Mindestens Gemeinde oder Zonenname muss vorhanden sein
        if (!data['Gemeinde'] && !data['Bodenrichtwertzonenname'])
            return null;
        // BRW-Wert extrahieren
        const brwKey = Object.keys(data).find(k => k.includes('Bodenrichtwert') && k.includes('Euro'));
        const brwRaw = brwKey ? data[brwKey] : '';
        // "Information gebührenpflichtig" → Paywall
        if (brwRaw.includes('gebührenpflichtig') || !brwRaw) {
            console.log('BY VBORIS: Zone erkannt, aber BRW gebührenpflichtig:', data['Bodenrichtwertzonenname'] || data['Gemeinde'] || 'unbekannt');
            return null;
        }
        const wert = parseFloat(brwRaw.replace(/\./g, '').replace(',', '.'));
        if (!wert || wert <= 0 || !isFinite(wert))
            return null;
        const stichtagRaw = data['Stichtag'] || '';
        const nutzungsart = data['Nutzungsart'] || '';
        const entwicklung = data['Entwicklungszustand'] || '';
        return {
            wert,
            stichtag: this.convertDate(stichtagRaw) || stichtagRaw || 'aktuell',
            nutzungsart: nutzungsart.includes('gebührenpflichtig') ? 'unbekannt' : (nutzungsart || 'unbekannt'),
            entwicklungszustand: entwicklung.includes('gebührenpflichtig') ? 'B' : (entwicklung || 'B'),
            zone: data['Bodenrichtwertzonenname'] || data['Bodenrichtwertnummer'] || '',
            gemeinde: data['Gemeinde'] || '',
            bundesland: 'Bayern',
            quelle: 'BORIS-Bayern (Bayerische Vermessungsverwaltung)',
            lizenz: '© Bayerische Vermessungsverwaltung, www.geodaten.bayern.de',
        };
    }
    /** Generischer HTML-Parser als Fallback */
    parseHtmlGeneric(html) {
        const plain = html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ');
        const patterns = [
            /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m²|€\/m²|EUR\/qm|€\/qm)/i,
            /(?:Bodenrichtwert|BRW)[:\s]+(\d+(?:[.,]\d+)?)/i,
            /(\d{2,6}(?:[.,]\d+)?)\s*(?:EUR|€)/i,
        ];
        let wert = null;
        for (const p of patterns) {
            const m = plain.match(p);
            if (m) {
                wert = parseFloat(m[1].replace(',', '.'));
                if (wert > 0)
                    break;
            }
        }
        if (!wert || wert <= 0)
            return null;
        const stichtagM = plain.match(/(?:Stichtag)[:\s]+(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})/i);
        return {
            wert,
            stichtag: stichtagM ? (this.convertDate(stichtagM[1]) || stichtagM[1]) : 'aktuell',
            nutzungsart: plain.match(/Nutzungsart[:\s]+([A-Za-zÄÖÜäöü]+)/i)?.[1] || 'unbekannt',
            entwicklungszustand: 'B',
            zone: '',
            gemeinde: plain.match(/(?:Gemeinde|Ort)[:\s]+([A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\s\-]+)/)?.[1]?.trim() || '',
            bundesland: 'Bayern',
            quelle: 'BORIS-Bayern (Bayerische Vermessungsverwaltung)',
            lizenz: '© Bayerische Vermessungsverwaltung, www.geodaten.bayern.de',
        };
    }
    // ─── Hilfsfunktionen ──────────────────────────────────────────────────────
    extractNumber(xml, fields) {
        for (const field of fields) {
            const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${field}(?:\\s[^>]*)?>([\\d.,]+)<`, 'i');
            const m = xml.match(re);
            if (m) {
                let s = m[1];
                if (s.includes(','))
                    s = s.replace(/\./g, '').replace(',', '.');
                const val = parseFloat(s);
                if (val > 0 && val <= 500_000 && isFinite(val))
                    return val;
            }
        }
        return null;
    }
    extractField(xml, fields) {
        for (const field of fields) {
            const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${field}(?:\\s[^>]*)?>([^<]+)<`, 'i');
            const m = xml.match(re);
            if (m)
                return m[1].trim();
        }
        return null;
    }
    /** '01.01.2024' → '2024-01-01' */
    convertDate(raw) {
        if (!raw)
            return null;
        const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (!m)
            return null;
        return `${m[3]}-${m[2]}-${m[1]}`;
    }
    async healthCheck() {
        try {
            const params = new URLSearchParams({
                SERVICE: 'WMS',
                VERSION: '1.1.1',
                REQUEST: 'GetCapabilities',
            });
            const res = await fetch(`${this.wmsUrls[0]}?${params}`, {
                signal: AbortSignal.timeout(5000),
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=bayern.js.map