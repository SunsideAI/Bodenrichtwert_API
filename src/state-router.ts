import type { BodenrichtwertAdapter } from './adapters/base.js';
import { HamburgAdapter } from './adapters/hamburg.js';
import { NRWAdapter } from './adapters/nrw.js';
import { RheinlandPfalzAdapter } from './adapters/rlp.js';
import { BrandenburgAdapter } from './adapters/brandenburg.js';
import { BerlinAdapter } from './adapters/berlin.js';
import { HessenAdapter } from './adapters/hessen.js';
import { NiedersachsenAdapter } from './adapters/niedersachsen.js';
import { ThueringenAdapter } from './adapters/thueringen.js';
import { MecklenburgVorpommernAdapter } from './adapters/mecklenburg-vorpommern.js';
import { SachsenAdapter } from './adapters/sachsen.js';
import { SachsenAnhaltAdapter } from './adapters/sachsen-anhalt.js';
import { SchleswigHolsteinAdapter } from './adapters/schleswig-holstein.js';
import { FallbackAdapter } from './adapters/fallback.js';

/**
 * Adapter-Registry: Bundesland → Adapter-Instanz.
 * 16/16 Bundesländer abgedeckt – 12 automatisch, 4 Fallback.
 */
const adapterRegistry: Record<string, BodenrichtwertAdapter> = {
  // Tier 1: WFS-Adapter (freie Daten, hohe Qualität)
  'Hamburg': new HamburgAdapter(),
  'Nordrhein-Westfalen': new NRWAdapter(),
  'Rheinland-Pfalz': new RheinlandPfalzAdapter(),
  'Brandenburg': new BrandenburgAdapter(),
  'Berlin': new BerlinAdapter(),
  'Hessen': new HessenAdapter(),
  'Niedersachsen': new NiedersachsenAdapter(),
  'Thüringen': new ThueringenAdapter(),
  'Mecklenburg-Vorpommern': new MecklenburgVorpommernAdapter(),

  // Tier 2: WMS-Adapter (GetFeatureInfo, eingeschränkter)
  'Sachsen': new SachsenAdapter(),
  'Sachsen-Anhalt': new SachsenAnhaltAdapter(),
  'Schleswig-Holstein': new SchleswigHolsteinAdapter(),

  // Tier 3: Fallback (kein freier Zugang / Lizenzeinschränkungen)
  'Bayern': new FallbackAdapter('Bayern'),
  'Baden-Württemberg': new FallbackAdapter('Baden-Württemberg'),
  'Bremen': new FallbackAdapter('Bremen'),
  'Saarland': new FallbackAdapter('Saarland'),
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
