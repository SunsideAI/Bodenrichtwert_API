/**
 * ChainedAdapter: Versucht den primären Adapter, fällt auf den sekundären zurück.
 *
 * Anwendungsfall: Bayern – erst VBORIS versuchen (selten kostenlos),
 * dann ImmoScout-Schätzung als Fallback.
 */
export class ChainedAdapter {
    primary;
    secondary;
    state;
    stateCode;
    isFallback = false;
    constructor(primary, secondary) {
        this.primary = primary;
        this.secondary = secondary;
        this.state = primary.state;
        this.stateCode = primary.stateCode;
    }
    async getBodenrichtwert(lat, lon) {
        // Erst primären Adapter versuchen (offizieller Wert)
        try {
            const result = await this.primary.getBodenrichtwert(lat, lon);
            if (result && result.wert > 0) {
                console.log(`${this.stateCode} Chain: Primärer Adapter erfolgreich (${result.quelle})`);
                return result;
            }
        }
        catch (err) {
            console.warn(`${this.stateCode} Chain: Primärer Adapter Fehler:`, err);
        }
        // Fallback auf sekundären Adapter (Schätzung)
        try {
            console.log(`${this.stateCode} Chain: Primärer Adapter ohne Ergebnis, versuche Fallback...`);
            const result = await this.secondary.getBodenrichtwert(lat, lon);
            if (result) {
                console.log(`${this.stateCode} Chain: Fallback erfolgreich (${result.quelle})`);
                return result;
            }
        }
        catch (err) {
            console.warn(`${this.stateCode} Chain: Fallback Fehler:`, err);
        }
        return null;
    }
    async healthCheck() {
        const [pHealth, sHealth] = await Promise.allSettled([
            this.primary.healthCheck(),
            this.secondary.healthCheck(),
        ]);
        return (pHealth.status === 'fulfilled' && pHealth.value)
            || (sHealth.status === 'fulfilled' && sHealth.value);
    }
}
//# sourceMappingURL=chained.js.map