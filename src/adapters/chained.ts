import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';

/**
 * ChainedAdapter: Versucht den primären Adapter, fällt auf den sekundären zurück.
 *
 * Anwendungsfall: Bayern – erst VBORIS versuchen (selten kostenlos),
 * dann ImmoScout-Schätzung als Fallback.
 */
export class ChainedAdapter implements BodenrichtwertAdapter {
  state: string;
  stateCode: string;
  isFallback = false;

  constructor(
    private primary: BodenrichtwertAdapter,
    private secondary: BodenrichtwertAdapter,
  ) {
    this.state = primary.state;
    this.stateCode = primary.stateCode;
  }

  async getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null> {
    // Erst primären Adapter versuchen (offizieller Wert)
    try {
      const result = await this.primary.getBodenrichtwert(lat, lon);
      if (result && result.wert > 0) {
        console.log(`${this.stateCode} Chain: Primärer Adapter erfolgreich (${result.quelle})`);
        return result;
      }
    } catch (err) {
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
    } catch (err) {
      console.warn(`${this.stateCode} Chain: Fallback Fehler:`, err);
    }

    return null;
  }

  async healthCheck(): Promise<boolean> {
    const [pHealth, sHealth] = await Promise.allSettled([
      this.primary.healthCheck(),
      this.secondary.healthCheck(),
    ]);
    return (pHealth.status === 'fulfilled' && pHealth.value)
      || (sHealth.status === 'fulfilled' && sHealth.value);
  }
}
