import type { BodenrichtwertAdapter } from './adapters/base.js';
import { HamburgAdapter } from './adapters/hamburg.js';
import { NRWAdapter } from './adapters/nrw.js';
import { RheinlandPfalzAdapter } from './adapters/rlp.js';
import { BrandenburgAdapter } from './adapters/brandenburg.js';
import { FallbackAdapter } from './adapters/fallback.js';

/**
 * Adapter-Registry: Bundesland → Adapter-Instanz.
 * Neue Bundesländer = neuer Adapter, zero Refactoring.
 */
const adapterRegistry: Record<string, BodenrichtwertAdapter> = {
  // Phase 1: Bestätigte freie WFS
  'Hamburg': new HamburgAdapter(),
  'Nordrhein-Westfalen': new NRWAdapter(),
  'Rheinland-Pfalz': new RheinlandPfalzAdapter(),
  'Brandenburg': new BrandenburgAdapter(),

  // Phase 2: Folgen als nächstes
  // 'Berlin': new BerlinAdapter(),
  // 'Hessen': new HessenAdapter(),
  // 'Mecklenburg-Vorpommern': new MVAdapter(),

  // Problem-Bundesländer: Fallback
  'Bayern': new FallbackAdapter('Bayern'),
  'Baden-Württemberg': new FallbackAdapter('Baden-Württemberg'),
  'Bremen': new FallbackAdapter('Bremen'),
};

/**
 * Wählt den richtigen Adapter für ein Bundesland.
 * Gibt FallbackAdapter zurück für unbekannte/nicht implementierte Länder.
 */
export function routeToAdapter(state: string): BodenrichtwertAdapter {
  const adapter = adapterRegistry[state];

  if (adapter) {
    return adapter;
  }

  // Nicht implementiertes Bundesland → generischer Fallback
  console.warn(`Kein Adapter für "${state}" – verwende Fallback`);
  return new FallbackAdapter(state);
}

/**
 * Gibt alle registrierten Adapter zurück (für Health-Check Endpoint)
 */
export function getAllAdapters(): Record<string, BodenrichtwertAdapter> {
  return { ...adapterRegistry };
}
