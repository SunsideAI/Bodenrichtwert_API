/**
 * Direkter Test der Bewertungslogik ohne Server/Geocoding/Netzwerk.
 * Simuliert bekannte Testfälle und vergleicht mit Realwerten.
 */
import { buildBewertung } from '../src/bewertung.js';
import type { NormalizedBRW } from '../src/adapters/base.js';
import type { ImmoScoutPrices } from '../src/utils/immoscout-scraper.js';

interface TestCase {
  name: string;
  realwert: number;
  input: Parameters<typeof buildBewertung>;
}

function runTest(tc: TestCase) {
  const result = buildBewertung(...tc.input);
  const abweichung = ((result.realistischer_immobilienwert - tc.realwert) / tc.realwert) * 100;
  const ok = Math.abs(abweichung) <= 20;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST: ${tc.name}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`  Realwert:       ${tc.realwert.toLocaleString('de-DE')} €`);
  console.log(`  API-Ergebnis:   ${result.realistischer_immobilienwert.toLocaleString('de-DE')} €`);
  console.log(`  Abweichung:     ${abweichung > 0 ? '+' : ''}${abweichung.toFixed(1)}%`);
  console.log(`  Methode:        ${result.bewertungsmethode}`);
  console.log(`  Konfidenz:      ${result.konfidenz}`);
  console.log(`  Bodenwert:      ${result.bodenwert.toLocaleString('de-DE')} €`);
  console.log(`  Gebäudewert:    ${result.gebaeudewert.toLocaleString('de-DE')} €`);
  console.log(`  Ertragswert:    ${result.ertragswert?.toLocaleString('de-DE') ?? '-'} €`);
  console.log(`  qm-Preis:       ${result.realistischer_qm_preis} €/m²`);
  console.log(`  Spanne:         ${result.immobilienwert_spanne.min.toLocaleString('de-DE')} - ${result.immobilienwert_spanne.max.toLocaleString('de-DE')} €`);
  console.log(`  Faktoren:       ${JSON.stringify(result.faktoren)}`);
  console.log(`  Status:         ${ok ? '✅ PASS' : '❌ FAIL'} (Toleranz ±20%)`);
  console.log(`  Hinweise:`);
  result.hinweise.forEach((h, i) => console.log(`    ${i + 1}. ${h}`));
  console.log(`  Datenquellen:   ${result.datenquellen.join(', ')}`);

  return { ok, abweichung, result };
}

// ─── Testfälle ──────────────────────────────────────────────────────────────

const tests: TestCase[] = [
  {
    name: 'Bramsche EFH (NI) — Realwert 430.000 €',
    realwert: 430000,
    input: [
      // BewertungInput
      {
        art: 'Haus',
        wohnflaeche: 140,
        grundstuecksflaeche: 565,
        baujahr: 2008,
        objektunterart: 'Freistehendes Einfamilienhaus',
        modernisierung: 'Keine Modernisierungen',
        energie: 'Gut',
        ausstattung: 'Gehoben',
      },
      // BRW (offiziell, BORIS-NI)
      {
        wert: 150,
        stichtag: '2025-01-01',
        nutzungsart: 'WA',
        entwicklungszustand: 'B',
        zone: '',
        gemeinde: '',
        bundesland: 'Niedersachsen',
        quelle: 'BORIS-NI (LGLN)',
        lizenz: '© LGLN, dl-de/by-2-0',
        schaetzung: false,
      } satisfies NormalizedBRW,
      // Marktdaten (IS24 Atlas Osnabrück — stadt-level, kein stadtteil)
      {
        stadt: 'osnabrück',
        stadtteil: '', // Kein Stadtteil → Stadt-Durchschnitt
        bundesland: 'niedersachsen',
        haus_kauf_preis: 4986.34,
        haus_kauf_min: 3215.17,
        haus_kauf_max: 6976.19,
        haus_miete_preis: 12.71,
        haus_miete_min: 11.70,
        haus_miete_max: 16.96,
        wohnung_kauf_preis: 3647.17,
        wohnung_kauf_min: 2771.73,
        wohnung_kauf_max: 6639.17,
        wohnung_miete_preis: 11.11,
        wohnung_miete_min: 9.57,
        wohnung_miete_max: 16.34,
        jahr: 2026,
        quartal: 1,
        lat: 52.412,
        lng: 7.971,
      } satisfies ImmoScoutPrices,
      // preisindex
      null,
      // irw
      null,
      // baupreisindex
      null,
      // bundesland
      'Niedersachsen',
    ],
  },
  {
    name: 'Allensbach ETW (BW) — Realwert ~320.000 €',
    realwert: 320000,
    input: [
      {
        art: 'Wohnung',
        wohnflaeche: 86,
        grundstuecksflaeche: 275,
        baujahr: 1963,
        objektunterart: 'Etagenwohnung',
        modernisierung: 'Teilweise modernisiert',
        energie: 'Eher schlecht',
        ausstattung: 'Mittel',
      },
      {
        wert: 1421,
        stichtag: '2026-01-01',
        nutzungsart: 'Wohnbaufläche (geschätzt)',
        entwicklungszustand: 'B',
        zone: 'VVG der Stadt Konstanz',
        gemeinde: 'VVG der Stadt Konstanz',
        bundesland: 'Baden-Württemberg',
        quelle: 'ImmoScout24 Atlas (Schätzwert)',
        lizenz: 'Schätzung basierend auf Marktdaten.',
        schaetzung: true,
      } satisfies NormalizedBRW,
      {
        stadt: 'VVG der Stadt Konstanz',
        stadtteil: '',
        bundesland: 'baden-württemberg',
        haus_kauf_preis: 3465,
        haus_kauf_min: 2268,
        haus_kauf_max: 5393,
        haus_miete_preis: null,
        haus_miete_min: null,
        haus_miete_max: null,
        wohnung_kauf_preis: 4594,
        wohnung_kauf_min: 2690,
        wohnung_kauf_max: 10000,
        wohnung_miete_preis: null,
        wohnung_miete_min: null,
        wohnung_miete_max: null,
        jahr: 2026,
        quartal: 1,
        lat: 47.72,
        lng: 9.06,
      } satisfies ImmoScoutPrices,
      null, null, null,
      'Baden-Württemberg',
    ],
  },
  {
    name: 'Günstiges EFH Sachsen-Anhalt (Magdeburg-Umland) — Realwert ~180.000 €',
    realwert: 180000,
    input: [
      {
        art: 'Haus',
        wohnflaeche: 120,
        grundstuecksflaeche: 600,
        baujahr: 1994,
        objektunterart: 'Freistehendes Einfamilienhaus',
        modernisierung: 'Teilweise modernisiert',
        energie: 'Durchschnittlich',
        ausstattung: 'Mittel',
      },
      {
        wert: 45,
        stichtag: '2025-01-01',
        nutzungsart: 'W',
        entwicklungszustand: 'B',
        zone: '',
        gemeinde: 'Magdeburg',
        bundesland: 'Sachsen-Anhalt',
        quelle: 'BORIS',
        lizenz: 'dl-de/by-2-0',
        schaetzung: false,
      } satisfies NormalizedBRW,
      {
        stadt: 'magdeburg',
        stadtteil: '',
        bundesland: 'sachsen-anhalt',
        haus_kauf_preis: 2200,
        haus_kauf_min: 1400,
        haus_kauf_max: 3500,
        haus_miete_preis: 7.50,
        haus_miete_min: 6.00,
        haus_miete_max: 9.50,
        wohnung_kauf_preis: 1800,
        wohnung_kauf_min: 1100,
        wohnung_kauf_max: 3000,
        wohnung_miete_preis: 7.00,
        wohnung_miete_min: 5.50,
        wohnung_miete_max: 9.00,
        jahr: 2026,
        quartal: 1,
        lat: 52.13,
        lng: 11.63,
      } satisfies ImmoScoutPrices,
      null, null, null,
      'Sachsen-Anhalt',
    ],
  },
  {
    name: 'Hamburg Stadtvilla (Premium A-Lage) — Realwert ~1.200.000 €',
    realwert: 1200000,
    input: [
      {
        art: 'Haus',
        wohnflaeche: 180,
        grundstuecksflaeche: 450,
        baujahr: 2015,
        objektunterart: 'Freistehendes Einfamilienhaus',
        modernisierung: null,
        energie: 'Sehr gut',
        ausstattung: 'Stark gehoben',
      },
      {
        wert: 800,
        stichtag: '2025-01-01',
        nutzungsart: 'W',
        entwicklungszustand: 'B',
        zone: 'Blankenese',
        gemeinde: 'Hamburg',
        bundesland: 'Hamburg',
        quelle: 'GAG Hamburg',
        lizenz: 'dl-de/by-2-0',
        schaetzung: false,
      } satisfies NormalizedBRW,
      {
        stadt: 'hamburg',
        stadtteil: 'blankenese',
        bundesland: 'hamburg',
        haus_kauf_preis: 6500,
        haus_kauf_min: 4500,
        haus_kauf_max: 9000,
        haus_miete_preis: 16.00,
        haus_miete_min: 13.00,
        haus_miete_max: 20.00,
        wohnung_kauf_preis: 5800,
        wohnung_kauf_min: 4000,
        wohnung_kauf_max: 8500,
        wohnung_miete_preis: 14.00,
        wohnung_miete_min: 11.00,
        wohnung_miete_max: 18.00,
        jahr: 2026,
        quartal: 1,
        lat: 53.56,
        lng: 9.80,
      } satisfies ImmoScoutPrices,
      null, null, null,
      'Hamburg',
    ],
  },
  {
    name: 'EFH nur mit BRW (kein IS24) — NHK-only Test',
    realwert: 280000, // NRW-Durchschnitt: 2200 €/m² × 130m² × 0.96 ≈ 275k
    input: [
      {
        art: 'Haus',
        wohnflaeche: 130,
        grundstuecksflaeche: 500,
        baujahr: 2000,
        objektunterart: 'Freistehendes Einfamilienhaus',
        modernisierung: null,
        energie: null,
        ausstattung: 'Mittel',
      },
      {
        wert: 120,
        stichtag: '2025-01-01',
        nutzungsart: 'W',
        entwicklungszustand: 'B',
        zone: '',
        gemeinde: '',
        bundesland: 'Nordrhein-Westfalen',
        quelle: 'BORIS-NRW',
        lizenz: 'dl-de/by-2-0',
        schaetzung: false,
      } satisfies NormalizedBRW,
      // Kein IS24 Marktdaten
      null,
      null, null, null,
      'Nordrhein-Westfalen',
    ],
  },
];

// ─── Tests ausführen ────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║         BEWERTUNG QUALITÄTSTEST — Plausibilitätsprüfung         ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

let passed = 0;
let failed = 0;

for (const tc of tests) {
  const { ok } = runTest(tc);
  if (ok) passed++;
  else failed++;
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`ERGEBNIS: ${passed}/${tests.length} bestanden, ${failed} fehlgeschlagen`);
console.log(`${'═'.repeat(70)}`);

process.exit(failed > 0 ? 1 : 0);
