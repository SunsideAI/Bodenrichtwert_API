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
