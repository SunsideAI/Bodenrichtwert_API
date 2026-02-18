const FALLBACK_CONFIGS = {
    'Bayern': {
        state: 'Bayern',
        stateCode: 'BY',
        reason: 'Bayern stellt keine freien WFS-Daten bereit (kostenpflichtig nach BayKostG). Bitte BORIS-Bayern für manuelle Abfrage nutzen.',
        borisUrl: 'https://www.boris-bayern.de',
    },
    'Baden-Württemberg': {
        state: 'Baden-Württemberg',
        stateCode: 'BW',
        reason: 'Baden-Württemberg erlaubt seit 2024 freie Ansicht, schließt aber kommerzielle Nutzung explizit aus.',
        borisUrl: 'https://www.boris-bw.de',
    },
    'Bremen': {
        state: 'Bremen',
        stateCode: 'HB',
        reason: 'Bremen bietet derzeit keinen freien WFS-Zugang.',
        borisUrl: 'https://www.gutachterausschuss.bremen.de',
    },
    'Saarland': {
        state: 'Saarland',
        stateCode: 'SL',
        reason: 'Saarland erlaubt nur Ansicht im Geoportal, Einbindung in andere Anwendungen ist nicht gestattet.',
        borisUrl: 'https://geoportal.saarland.de/article/Bodenrichtwerte/',
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