const FALLBACK_CONFIGS = {
    'Baden-Württemberg': {
        state: 'Baden-Württemberg',
        stateCode: 'BW',
        reason: 'Baden-Württemberg hat keinen landesweiten WMS/WFS-Endpunkt. Einzelne Kommunen (Stuttgart, Heidelberg etc.) haben eigene WMS-Dienste, aber keine einheitliche Abdeckung.',
        borisUrl: 'https://www.gutachterausschuesse-bw.de/borisbw/',
    },
    'Bayern': {
        state: 'Bayern',
        stateCode: 'BY',
        reason: 'Die meisten Gutachterausschüsse in Bayern geben BRW-Werte nur gegen Gebühr heraus. Der VBORIS-WMS-Dienst (geoportal.bayern.de) funktioniert technisch, aber die Wertabfrage ist kostenpflichtig. Nur wenige Stellen sind öffentlich.',
        borisUrl: 'https://geoportal.bayern.de/bodenrichtwerte/',
    },
};
/**
 * Fallback-Adapter für Bundesländer ohne freien WFS.
 * Gibt immer null zurück mit Hinweis auf BORIS-Portal.
 */
export class FallbackAdapter {
    state;
    stateCode;
    isFallback = true;
    fallbackReason;
    borisUrl;
    constructor(stateName) {
        const config = FALLBACK_CONFIGS[stateName];
        if (config) {
            this.state = config.state;
            this.stateCode = config.stateCode;
            this.fallbackReason = config.reason;
            this.borisUrl = config.borisUrl;
        }
        else {
            // Generischer Fallback für unbekannte/noch nicht implementierte Bundesländer
            this.state = stateName;
            this.stateCode = '??';
            this.fallbackReason = `Für ${stateName} ist noch kein WFS-Adapter implementiert.`;
            this.borisUrl = 'https://www.boris-d.de';
        }
    }
    async getBodenrichtwert(_lat, _lon) {
        // Fallback gibt immer null zurück
        return null;
    }
    async healthCheck() {
        // Fallback ist immer "healthy" – er tut ja absichtlich nichts
        return true;
    }
}
//# sourceMappingURL=fallback.js.map