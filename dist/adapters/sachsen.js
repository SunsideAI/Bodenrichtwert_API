/**
 * Sachsen Adapter
 *
 * Nutzt den WMS GetFeatureInfo Endpunkt (kein WFS verfügbar).
 * Daten: Bodenrichtwerte 2023 (jahresspezifischer Dienst)
 * CRS: EPSG:25833 (UTM Zone 33N)
 * Lizenz: Erlaubnis- und gebührenfrei
 */
export class SachsenAdapter {
    state = 'Sachsen';
    stateCode = 'SN';
    isFallback = false;
    wmsUrl = 'https://www.landesvermessung.sachsen.de/fp/http-proxy/svc';
    async getBodenrichtwert(lat, lon) {
        // Versuche aktuellstes Jahr zuerst, dann Fallback
        for (const year of ['2023', '2022']) {
            try {
                const result = await this.queryWms(lat, lon, year);
                if (result)
                    return result;
            }
            catch (err) {
                console.warn(`SN WMS ${year} error:`, err);
            }
        }
        return null;
    }
    async queryWms(lat, lon, year) {
        const delta = 0.001;
        const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
        const params = new URLSearchParams({
            cfg: `boris_${year}`,
            SERVICE: 'WMS',
            VERSION: '1.1.1',
            REQUEST: 'GetFeatureInfo',
            LAYERS: 'brw_zonen',
            QUERY_LAYERS: 'brw_zonen',
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
        const url = `${this.wmsUrl}?${params}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            return null;
        const text = await res.text();
        const wert = this.extractValue(text);
        if (!wert || wert <= 0)
            return null;
        return {
            wert,
            stichtag: `${year}-01-01`,
            nutzungsart: this.extractField(text, 'nutzungsart') || this.extractField(text, 'NUTZUNG') || 'unbekannt',
            entwicklungszustand: this.extractField(text, 'entwicklungszustand') || 'B',
            zone: this.extractField(text, 'zone') || this.extractField(text, 'ZONE') || '',
            gemeinde: this.extractField(text, 'gemeinde') || this.extractField(text, 'GEMEINDE') || '',
            bundesland: 'Sachsen',
            quelle: `BORIS-Sachsen (${year})`,
            lizenz: '© GeoSN, erlaubnis- und gebührenfrei',
        };
    }
    extractValue(text) {
        const patterns = [
            /<(?:brw|wert|bodenrichtwert|richtwert|BRW|Wert|Bodenrichtwert)>([\d.,]+)<\//i,
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
        const re = new RegExp(`<${field}[^>]*>([^<]+)</${field}>`, 'i');
        const match = text.match(re);
        return match ? match[1].trim() : null;
    }
    async healthCheck() {
        try {
            const params = new URLSearchParams({
                cfg: 'boris_2023',
                SERVICE: 'WMS',
                VERSION: '1.1.1',
                REQUEST: 'GetCapabilities',
            });
            const res = await fetch(`${this.wmsUrl}?${params}`, {
                signal: AbortSignal.timeout(5000),
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=sachsen.js.map