/**
 * Sachsen-Anhalt Adapter
 *
 * Nutzt den Geodatenportal WMS GetFeatureInfo Endpunkt (kein WFS verfügbar).
 * Daten: Bodenrichtwerte 2024
 * CRS: EPSG:25832 (UTM Zone 32N)
 * Lizenz: dl-de/by-2-0 (© GeoBasis-DE / LVermGeo ST)
 */
export class SachsenAnhaltAdapter {
    state = 'Sachsen-Anhalt';
    stateCode = 'ST';
    isFallback = false;
    baseUrl = 'https://www.geodatenportal.sachsen-anhalt.de/wss/service';
    // Mögliche Layer-Namen
    layerCandidates = ['Bauland', 'BRW', 'bodenrichtwerte', '0', '1'];
    async getBodenrichtwert(lat, lon) {
        // Versuche aktuellstes Jahr zuerst
        for (const year of ['2024', '2022']) {
            for (const layer of this.layerCandidates) {
                try {
                    const result = await this.queryWms(lat, lon, year, layer);
                    if (result)
                        return result;
                }
                catch {
                    // Nächste Kombination versuchen
                }
            }
        }
        console.error('ST adapter: Kein Treffer mit allen Jahr/Layer-Kombinationen');
        return null;
    }
    async queryWms(lat, lon, year, layer) {
        const delta = 0.001;
        const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
        const wmsUrl = `${this.baseUrl}/ST_LVermGeo_BRW${year}_gast/guest`;
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
            INFO_FORMAT: 'text/xml',
            FEATURE_COUNT: '5',
            STYLES: '',
            FORMAT: 'image/png',
        });
        const url = `${wmsUrl}?${params}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            return null;
        const text = await res.text();
        if (text.includes('ServiceException') || text.includes('ExceptionReport'))
            return null;
        const wert = this.extractValue(text);
        if (!wert || wert <= 0)
            return null;
        return {
            wert,
            stichtag: this.extractField(text, 'stichtag') || this.extractField(text, 'stag') || `${year}-01-01`,
            nutzungsart: this.extractField(text, 'nutzungsart') || this.extractField(text, 'nuta') || 'unbekannt',
            entwicklungszustand: this.extractField(text, 'entwicklungszustand') || this.extractField(text, 'entw') || 'B',
            zone: this.extractField(text, 'zone') || this.extractField(text, 'wnum') || '',
            gemeinde: this.extractField(text, 'gemeinde') || this.extractField(text, 'gena') || '',
            bundesland: 'Sachsen-Anhalt',
            quelle: `BORIS-ST (${year})`,
            lizenz: '© GeoBasis-DE / LVermGeo ST, dl-de/by-2-0',
        };
    }
    extractValue(text) {
        const patterns = [
            /<[^>]*:?(?:brw|wert|bodenrichtwert|richtwert|BRW|Wert|Bodenrichtwert)[^>]*>([\d.,]+)<\//i,
            /([\d]+(?:[.,]\d+)?)\s*(?:EUR\/m|€\/m)/i,
            /(?:brw|wert|bodenrichtwert)[:\s=]*([\d.,]+)/i,
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                const val = parseFloat(match[1].replace(',', '.'));
                if (val > 0)
                    return val;
            }
        }
        return null;
    }
    extractField(text, field) {
        const re = new RegExp(`<[^>]*:?${field}[^>]*>([^<]+)<`, 'i');
        const match = text.match(re);
        return match ? match[1].trim() : null;
    }
    async healthCheck() {
        try {
            const wmsUrl = `${this.baseUrl}/ST_LVermGeo_BRW2024_gast/guest`;
            const params = new URLSearchParams({
                SERVICE: 'WMS',
                VERSION: '1.1.1',
                REQUEST: 'GetCapabilities',
            });
            const res = await fetch(`${wmsUrl}?${params}`, {
                signal: AbortSignal.timeout(5000),
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=sachsen-anhalt.js.map