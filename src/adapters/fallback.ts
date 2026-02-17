import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * Konfiguration für Fallback-Bundesländer (kein freier WFS verfügbar)
 */
interface FallbackConfig {
  state: string;
  stateCode: string;
  reason: string;
  borisUrl: string;
}

const FALLBACK_CONFIGS: Record<string, FallbackConfig> = {
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
};

/**
 * Fallback-Adapter für Bundesländer ohne freien WFS.
 * Gibt immer null zurück mit Hinweis auf BORIS-Portal.
 */
export class FallbackAdapter implements BodenrichtwertAdapter {
  state: string;
  stateCode: string;
  isFallback = true;
  fallbackReason: string;
  borisUrl: string;

  constructor(stateName: string) {
    const config = FALLBACK_CONFIGS[stateName];
    if (config) {
      this.state = config.state;
      this.stateCode = config.stateCode;
      this.fallbackReason = config.reason;
      this.borisUrl = config.borisUrl;
    } else {
      // Generischer Fallback für unbekannte/noch nicht implementierte Bundesländer
      this.state = stateName;
      this.stateCode = '??';
      this.fallbackReason = `Für ${stateName} ist noch kein WFS-Adapter implementiert.`;
      this.borisUrl = 'https://www.boris-d.de';
    }
  }

  async getBodenrichtwert(_lat: number, _lon: number): Promise<NormalizedBRW | null> {
    // Fallback gibt immer null zurück
    return null;
  }

  async healthCheck(): Promise<boolean> {
    // Fallback ist immer "healthy" – er tut ja absichtlich nichts
    return true;
  }
}
