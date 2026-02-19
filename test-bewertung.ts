/**
 * Unit- und Integrationstests für das Sachwert-lite Bewertungsmodul.
 *
 * Usage:
 *   npx tsx test-bewertung.ts          # Unit-Tests (kein Server nötig)
 *   npx tsx test-bewertung.ts --api    # Integrations-Test (Server muss laufen)
 */

import { buildBewertung } from './src/bewertung.js';
import type { BewertungInput, Bewertung } from './src/bewertung.js';
import type { NormalizedBRW } from './src/adapters/base.js';
import type { ImmoScoutPrices } from './src/utils/immoscout-scraper.js';
import { calcGebaeudewertNHK, lookupMAF } from './src/utils/nhk.js';
import { calcErtragswert } from './src/utils/ertragswert.js';

// ─── Test-Hilfsfunktionen ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${msg}`);
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, msg: string) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${msg} (got ${actual}, expected ~${expected}, tol ${tolerance})`);
}

// ─── Mock-Daten ──────────────────────────────────────────────────────────────

function mockBRW(overrides: Partial<NormalizedBRW> = {}): NormalizedBRW {
  return {
    wert: 250,
    stichtag: '2024-01-01',
    nutzungsart: 'Wohnbaufläche',
    entwicklungszustand: 'B',
    zone: 'Testzone',
    gemeinde: 'Hamburg',
    bundesland: 'Hamburg',
    quelle: 'BORIS-HH',
    lizenz: 'dl-de/by-2-0',
    ...overrides,
  };
}

function mockMarktdaten(overrides: Partial<ImmoScoutPrices> = {}): ImmoScoutPrices {
  return {
    stadt: 'Hamburg',
    stadtteil: '',
    bundesland: 'Hamburg',
    haus_kauf_preis: 3500,
    haus_kauf_min: 2000,
    haus_kauf_max: 6000,
    wohnung_kauf_preis: 4200,
    wohnung_kauf_min: 2500,
    wohnung_kauf_max: 7000,
    haus_miete_preis: 12.5,
    haus_miete_min: 8,
    haus_miete_max: 18,
    wohnung_miete_preis: 14,
    wohnung_miete_min: 9,
    wohnung_miete_max: 20,
    jahr: 2026,
    quartal: 1,
    lat: 53.55,
    lng: 10.0,
    ...overrides,
  };
}

function mockInput(overrides: Partial<BewertungInput> = {}): BewertungInput {
  return {
    art: 'Einfamilienhaus',
    grundstuecksflaeche: 500,
    wohnflaeche: 120,
    baujahr: 1985,
    objektunterart: 'Freistehendes Einfamilienhaus',
    modernisierung: 'Teilweise modernisiert',
    energie: 'Durchschnittlich',
    ausstattung: 'Mittel',
    ...overrides,
  };
}

// ─── Unit-Tests ──────────────────────────────────────────────────────────────

function runUnitTests() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Bewertungsmodul – Unit-Tests');
  console.log('═══════════════════════════════════════════════\n');

  // 1. Voller Sachwert-lite
  {
    console.log('Test 1: Voller Sachwert-lite (BRW high + ImmoScout + alle Inputs)');
    const result = buildBewertung(mockInput(), mockBRW(), mockMarktdaten());
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'sachwert-lite', 'Methode = sachwert-lite');
    assert(result!.konfidenz === 'hoch', 'Konfidenz = hoch');
    assert(result!.bodenwert > 0, `Bodenwert > 0 (${result!.bodenwert})`);
    assert(result!.gebaeudewert >= 0, `Gebäudewert >= 0 (${result!.gebaeudewert})`);
    assert(result!.realistischer_immobilienwert === result!.bodenwert + result!.gebaeudewert,
      'Immobilienwert = Bodenwert + Gebäudewert');
    assert(result!.qm_preis_spanne.min < result!.realistischer_qm_preis, 'Spanne min < Preis');
    assert(result!.qm_preis_spanne.max > result!.realistischer_qm_preis, 'Spanne max > Preis');
    // Ertragswert ist jetzt verfügbar (Mietdaten + BRW + Bodenwert) → ±6% statt ±8%
    const hasErtragswert = result!.ertragswert != null;
    const expectedSpread = hasErtragswert ? 0.06 : 0.08;
    const expectedMin = Math.round(result!.realistischer_qm_preis * (1 - expectedSpread));
    const expectedMax = Math.round(result!.realistischer_qm_preis * (1 + expectedSpread));
    assertApprox(result!.qm_preis_spanne.min, expectedMin, 1, `Spanne = ±${expectedSpread * 100}%`);
    assertApprox(result!.qm_preis_spanne.max, expectedMax, 1, `Spanne max = +${expectedSpread * 100}%`);
    assert(result!.datenquellen.includes('BORIS/WFS Bodenrichtwert'), 'Datenquelle BRW');
    assert(result!.datenquellen.includes('ImmoScout24 Atlas Marktpreise'), 'Datenquelle ImmoScout');
    if (hasErtragswert) {
      assert(result!.datenquellen.includes('Ertragswertverfahren (ImmoWertV §§ 27-34)'), 'Datenquelle Ertragswert');
      assert(result!.ertragswert! > 0, `Ertragswert > 0 (${result!.ertragswert})`);
    }
    console.log(`    → Immobilienwert: ${result!.realistischer_immobilienwert}€, Boden: ${result!.bodenwert}€, Gebäude: ${result!.gebaeudewert}€, Ertragswert: ${result!.ertragswert}€\n`);
  }

  // 2. BRW geschätzt
  {
    console.log('Test 2: BRW geschätzt (schaetzung vorhanden)');
    const brw = mockBRW({
      wert: 180,
      schaetzung: {
        methode: 'ImmoScout Atlas × Faktor',
        basis_preis: 2800,
        faktor: 0.35,
        datenstand: '2026-Q1',
        hinweis: 'Schätzwert',
      },
    });
    const result = buildBewertung(mockInput({ wohnflaeche: 100 }), brw, mockMarktdaten({ haus_kauf_preis: 2800 }));
    assert(result !== null, 'Result ist nicht null');
    assert(result!.konfidenz === 'mittel', 'Konfidenz = mittel');
    // ±15% spread
    const spread = (result!.qm_preis_spanne.max - result!.qm_preis_spanne.min) / (2 * result!.realistischer_qm_preis);
    assertApprox(spread, 0.15, 0.01, 'Spread ≈ 15%');
    assert(result!.hinweise.some(h => h.includes('Schätzwert')), 'Hinweis zu BRW-Schätzwert');
    console.log(`    → Konfidenz: ${result!.konfidenz}, Spread: ${(spread * 100).toFixed(1)}%\n`);
  }

  // 3. Nur ImmoScout (kein BRW)
  {
    console.log('Test 3: Nur ImmoScout-Daten (kein BRW)');
    const result = buildBewertung(mockInput({ wohnflaeche: 150 }), null, mockMarktdaten({ haus_kauf_preis: 4000 }));
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'marktpreis-indikation', 'Methode = marktpreis-indikation');
    assert(result!.konfidenz === 'mittel', 'Konfidenz = mittel (marktpreis-indikation)');
    assert(result!.hinweise.some(h => h.includes('Kein Bodenrichtwert')), 'Hinweis zu fehlendem BRW');
    console.log(`    → Methode: ${result!.bewertungsmethode}, Wert: ${result!.realistischer_immobilienwert}€\n`);
  }

  // 4. Keine Wohnfläche → Fallback (geschätzte Wohnfläche)
  {
    console.log('Test 4: Keine Wohnfläche → Fallback mit geschätzter Wohnfläche');
    const result = buildBewertung(mockInput({ wohnflaeche: null }), mockBRW(), mockMarktdaten());
    assert(result !== null, 'Result ist nicht null (Fallback)');
    assert(result!.realistischer_immobilienwert > 0, `Immobilienwert > 0 (${result!.realistischer_immobilienwert})`);
    assert(result!.realistischer_qm_preis > 0, `QM-Preis > 0 (${result!.realistischer_qm_preis})`);
    assert(result!.immobilienwert_spanne.min > 0, `Spanne min > 0 (${result!.immobilienwert_spanne.min})`);
    assert(result!.immobilienwert_spanne.max > 0, `Spanne max > 0 (${result!.immobilienwert_spanne.max})`);
    assert(result!.qm_preis_spanne.min > 0, `QM-Spanne min > 0 (${result!.qm_preis_spanne.min})`);
    assert(result!.qm_preis_spanne.max > 0, `QM-Spanne max > 0 (${result!.qm_preis_spanne.max})`);
    assert(result!.konfidenz === 'gering', 'Konfidenz = gering (geschätzte Wohnfläche)');
    assert(result!.hinweise.some(h => h.includes('Wohnfläche geschätzt')), 'Hinweis zu geschätzter Wohnfläche');
    console.log(`    → Fallback-Wert: ${result!.realistischer_immobilienwert}€, QM: ${result!.realistischer_qm_preis}€/m²\n`);
  }

  // 5. Keine Daten (weder BRW noch ImmoScout) → Bundesdurchschnitt-Fallback
  {
    console.log('Test 5: Keine Daten → Bundesdurchschnitt-Fallback');
    const result = buildBewertung(mockInput({ wohnflaeche: 100 }), null, null);
    assert(result !== null, 'Result ist nicht null (Bundesdurchschnitt)');
    assert(result!.realistischer_immobilienwert > 0, `Immobilienwert > 0 (${result!.realistischer_immobilienwert})`);
    assert(result!.realistischer_qm_preis > 0, `QM-Preis > 0 (${result!.realistischer_qm_preis})`);
    assert(result!.immobilienwert_spanne.min > 0, 'Spanne min > 0');
    assert(result!.immobilienwert_spanne.max > result!.immobilienwert_spanne.min, 'Spanne max > min');
    assert(result!.konfidenz === 'gering', 'Konfidenz = gering (keine lokalen Daten)');
    assert(result!.hinweise.some(h => h.includes('Bundesdurchschnitt')), 'Hinweis zu Bundesdurchschnitt');
    assert(result!.datenquellen.includes('Bundesdurchschnitt (Statistisches Bundesamt)'), 'Datenquelle Bundesdurchschnitt');
    console.log(`    → Bundesdurchschnitt-Wert: ${result!.realistischer_immobilienwert}€, Konfidenz: ${result!.konfidenz}\n`);
  }

  // 6. Alter Stichtag
  {
    console.log('Test 6: Alter Stichtag (>2 Jahre)');
    const brw = mockBRW({ stichtag: '2021-01-01' });
    const result = buildBewertung(mockInput(), brw, mockMarktdaten());
    assert(result !== null, 'Result ist nicht null');
    assert(result!.faktoren.stichtag_korrektur > 0, `Stichtag-Korrektur > 0 (${result!.faktoren.stichtag_korrektur})`);
    assert(result!.hinweise.some(h => h.includes('Stichtag')), 'Hinweis zu Stichtag');
    console.log(`    → Stichtag-Korrektur: +${(result!.faktoren.stichtag_korrektur * 100).toFixed(1)}%\n`);
  }

  // 7. Cross-Validation (hoher BRW, niedriger Marktpreis)
  {
    console.log('Test 7: Cross-Validation (>25% Abweichung)');
    const brw = mockBRW({ wert: 1000 }); // Sehr hoher BRW
    const markt = mockMarktdaten({ haus_kauf_preis: 1500 }); // Niedriger Marktpreis
    const input = mockInput({ grundstuecksflaeche: 800, wohnflaeche: 100 });
    const result = buildBewertung(input, brw, markt);
    assert(result !== null, 'Result ist nicht null');
    // Bodenwert = 1000 * 800 = 800.000€ vs Marktwert = 1500 * 100 = 150.000€
    // Bodenwert > Marktwert → Gebäudewert geclampt auf 0
    assert(result!.hinweise.some(h => h.includes('Manuelle Prüfung')), 'Hinweis zu Abweichung');
    console.log(`    → Bodenwert: ${result!.bodenwert}€, Gebäude: ${result!.gebaeudewert}€\n`);
  }

  // 8. Alle Faktoren korrekt summiert
  {
    console.log('Test 8: Korrekturfaktoren werden korrekt summiert');
    const input = mockInput({
      baujahr: 1940,              // -0.10 (< 1950)
      modernisierung: 'Keine Modernisierungen', // -0.18 (< 1970)
      energie: 'Sehr schlecht',   // -0.06
      ausstattung: 'Schlecht',    // -0.05
      objektunterart: 'Reihenmittelhaus', // -0.08
    });
    const result = buildBewertung(input, mockBRW(), mockMarktdaten());
    assert(result !== null, 'Result ist nicht null');
    assertApprox(result!.faktoren.baujahr, -0.10, 0.001, 'Baujahr = -0.10');
    assertApprox(result!.faktoren.modernisierung, -0.18, 0.001, 'Modernisierung = -0.18');
    assertApprox(result!.faktoren.energie, -0.06, 0.001, 'Energie = -0.06');
    assertApprox(result!.faktoren.ausstattung, -0.05, 0.001, 'Ausstattung = -0.05');
    assertApprox(result!.faktoren.objektunterart, -0.08, 0.001, 'Objektunterart = -0.08');
    const expectedGesamt = -0.10 + -0.18 + -0.06 + -0.05 + -0.08 + 0 + 0; // neubau=0, stichtag=0
    assertApprox(result!.faktoren.gesamt, expectedGesamt, 0.001, `Gesamt = ${expectedGesamt}`);
    console.log(`    → Faktoren: ${JSON.stringify(result!.faktoren)}\n`);
  }

  // 9. Neubau-Zuschlag
  {
    console.log('Test 9: Neubau-Zuschlag (Baujahr 2022)');
    const input = mockInput({ baujahr: 2022 });
    const result = buildBewertung(input, mockBRW(), mockMarktdaten());
    assert(result !== null, 'Result ist nicht null');
    assertApprox(result!.faktoren.neubau, 0.10, 0.001, 'Neubau = +0.10');
    assertApprox(result!.faktoren.baujahr, 0, 0.001, 'Baujahr = 0 (>=2020 → Neubau übernimmt)');
    console.log(`    → Neubau: ${result!.faktoren.neubau}, Baujahr: ${result!.faktoren.baujahr}\n`);
  }

  // 10. Wohnung (nutzt wohnung_kauf_preis)
  {
    console.log('Test 10: Wohnung (nutzt wohnung_kauf_preis)');
    const input = mockInput({ art: 'Wohnung', wohnflaeche: 80, grundstuecksflaeche: null });
    // wohnung_miete_preis=0 → kein 80/20, reiner Vergleichswert (testet Preis-Auswahl)
    const markt = mockMarktdaten({ wohnung_kauf_preis: 4500, haus_kauf_preis: 3000, wohnung_miete_preis: 0 });
    const result = buildBewertung(input, null, markt);
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'vergleichswert', 'Methode = vergleichswert (Wohnung mit Marktdaten)');
    // Basis sollte wohnung_kauf_preis (4500) sein, nicht haus_kauf (3000)
    const baseWert = 4500 * 80 * (1 + result!.faktoren.gesamt);
    assertApprox(result!.realistischer_immobilienwert, Math.round(baseWert), 1, 'Nutzt wohnung_kauf_preis als Basis');
    console.log(`    → Wert: ${result!.realistischer_immobilienwert}€ (Basis: wohnung_kauf 4500€/m²)\n`);
  }

  // 11. Sachwert-lite ohne Marktdaten (nur BRW) → NHK 2010 Gebäudewert
  {
    console.log('Test 11: Sachwert-lite ohne Marktdaten (nur BRW, NHK 2010)');
    const result = buildBewertung(mockInput(), mockBRW(), null);
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'sachwert-lite', 'Methode = sachwert-lite');
    assert(result!.datenquellen.includes('NHK 2010 (ImmoWertV 2022)'), 'Datenquelle NHK 2010');
    assert(result!.hinweise.some(h => h.includes('NHK-Berechnung')), 'Hinweis zu NHK-Berechnung');
    assert(result!.gebaeudewert > 0, `Gebäudewert > 0 (${result!.gebaeudewert})`);
    console.log(`    → Bodenwert: ${result!.bodenwert}€, Gebäude (NHK): ${result!.gebaeudewert}€\n`);
  }

  // 12. BRW vorhanden aber keine Grundstücksfläche → sachwert-lite mit geschätzter Grundfläche
  {
    console.log('Test 12: BRW vorhanden, keine Grundstücksfläche → sachwert-lite mit geschätzter GF');
    const input = mockInput({ grundstuecksflaeche: null });
    const result = buildBewertung(input, mockBRW(), mockMarktdaten());
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'sachwert-lite', 'Methode = sachwert-lite (Grundfläche geschätzt)');
    assert(result!.hinweise.some(h => h.includes('Grundstücksfläche') && h.includes('geschätzt')),
      'Hinweis zu geschätzter Grundstücksfläche');
    assert(result!.bodenwert > 0, `Bodenwert > 0 (${result!.bodenwert})`);
    console.log(`    → Methode: ${result!.bewertungsmethode}, Bodenwert: ${result!.bodenwert}\n`);
  }

  // 13. Wohnfläche = 0 → Fallback (geschätzte Wohnfläche)
  {
    console.log('Test 13: Wohnfläche = 0 → Fallback mit geschätzter Wohnfläche');
    const result = buildBewertung(mockInput({ wohnflaeche: 0 }), mockBRW(), mockMarktdaten());
    assert(result !== null, 'Result ist nicht null (Fallback)');
    assert(result!.realistischer_immobilienwert > 0, `Immobilienwert > 0 (${result!.realistischer_immobilienwert})`);
    assert(result!.konfidenz === 'gering', 'Konfidenz = gering');
    assert(result!.hinweise.some(h => h.includes('Wohnfläche geschätzt')), 'Hinweis zu geschätzter Wohnfläche');
    console.log(`    → Fallback-Wert: ${result!.realistischer_immobilienwert}€\n`);
  }

  // 14. parseNum-Simulation: Deutsches Zahlenformat (Komma als Dezimal)
  {
    console.log('Test 14: Deutsches Zahlenformat — "138,68" als Wohnfläche');
    // Simuliert parseNum("138,68") → 138.68
    const parsed = parseFloat('138,68'.replace(/\./g, '').replace(',', '.'));
    const result = buildBewertung(
      mockInput({ wohnflaeche: parsed, grundstuecksflaeche: null }),
      mockBRW(),
      mockMarktdaten(),
    );
    assert(result !== null, 'Result ist nicht null');
    assert(!isNaN(result!.realistischer_immobilienwert), 'Immobilienwert ist keine NaN');
    assert(result!.realistischer_immobilienwert > 0, `Immobilienwert > 0 (${result!.realistischer_immobilienwert})`);
    assert(result!.realistischer_qm_preis > 0, `QM-Preis > 0 (${result!.realistischer_qm_preis})`);
    console.log(`    → Wohnfläche: ${parsed}m², Wert: ${result!.realistischer_immobilienwert}€, QM: ${result!.realistischer_qm_preis}€/m²\n`);
  }

  // 15. parseNum-Simulation: Tausenderpunkt "1.200,50"
  {
    console.log('Test 15: Tausenderpunkt — "1.200,50" als Grundstücksfläche');
    const parsed = parseFloat('1.200,50'.replace(/\./g, '').replace(',', '.'));
    assertApprox(parsed, 1200.50, 0.01, 'Parsing "1.200,50" = 1200.50');
    const result = buildBewertung(
      mockInput({ grundstuecksflaeche: parsed }),
      mockBRW(),
      mockMarktdaten(),
    );
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'sachwert-lite', 'Methode = sachwert-lite');
    assert(result!.bodenwert > 0, `Bodenwert > 0 (${result!.bodenwert})`);
    console.log(`    → Grundstück: ${parsed}m², Bodenwert: ${result!.bodenwert}€\n`);
  }

  // 16. Input-Validierung: Extremes Baujahr
  {
    console.log('Test 16: Input-Validierung — Baujahr 1750 (außerhalb 1800–Zukunft)');
    const result = buildBewertung(mockInput({ baujahr: 1750 }), mockBRW(), mockMarktdaten());
    assert(result !== null, 'Result ist nicht null');
    assert(result!.hinweise.some(h => h.includes('Baujahr 1750') && h.includes('plausiblen Bereichs')), 'Validierungs-Hinweis für Baujahr');
    console.log(`    → Hinweis: ${result!.hinweise.find(h => h.includes('Baujahr'))}\n`);
  }

  // 17. Input-Validierung: Ungewöhnlich kleine Wohnfläche
  {
    console.log('Test 17: Input-Validierung — Wohnfläche 12m² (ungewöhnlich klein)');
    const result = buildBewertung(
      mockInput({ wohnflaeche: 12, grundstuecksflaeche: null }),
      null,
      mockMarktdaten(),
    );
    assert(result !== null, 'Result ist nicht null');
    assert(result!.hinweise.some(h => h.includes('12 m²') && h.includes('ungewöhnlich klein')), 'Validierungs-Hinweis für kleine Wohnfläche');
    console.log(`    → Hinweis: ${result!.hinweise.find(h => h.includes('ungewöhnlich'))}\n`);
  }

  // 18. Stadtteil-Hinweis bei vorhandenem Stadtteil
  {
    console.log('Test 18: Stadtteil-Hinweis bei Stadtteil-Daten');
    const markt = mockMarktdaten({ stadtteil: 'Schwabing' });
    const result = buildBewertung(mockInput({ grundstuecksflaeche: null }), null, markt);
    assert(result !== null, 'Result ist nicht null');
    assert(result!.hinweise.some(h => h.includes('Stadtteil-Daten') && h.includes('Schwabing')), 'Stadtteil-Hinweis vorhanden');
    console.log(`    → Hinweis: ${result!.hinweise.find(h => h.includes('Stadtteil'))}\n`);
  }

  // 19. Kein Stadtteil → Stadtdurchschnitt-Hinweis
  {
    console.log('Test 19: Stadtdurchschnitt-Hinweis ohne Stadtteil');
    const markt = mockMarktdaten({ stadtteil: '' });
    const result = buildBewertung(mockInput({ grundstuecksflaeche: null }), null, markt);
    assert(result !== null, 'Result ist nicht null');
    assert(result!.hinweise.some(h => h.includes('Stadtdurchschnitt')), 'Stadtdurchschnitt-Hinweis vorhanden');
    console.log(`    → Hinweis: ${result!.hinweise.find(h => h.includes('Stadtdurchschnitt'))}\n`);
  }

  // 20. NHK-Gebäudewert plausibel (150m² EFH, Baujahr 2000, mittel)
  {
    console.log('Test 20: NHK-Gebäudewert plausibel (150m² EFH, Bj.2000, mittel)');
    const input = mockInput({ wohnflaeche: 150, baujahr: 2000, ausstattung: 'Mittel', objektunterart: 'Freistehendes Einfamilienhaus' });
    const result = buildBewertung(input, mockBRW(), null);
    assert(result !== null, 'Result ist nicht null');
    // NHK 2010 Stufe 3 = 835€/m² BGF, BGF ≈ 150*1.35=203, BPI ≈ 1.86
    // Herstellungskosten ≈ 835 * 203 * 1.86 ≈ 315.000€
    // GND now = 70 (Stufe 3), Alter = 26 → RND = 44 → AWM = 44/70 = 0.629
    // vor MAF ≈ 315.000 * 0.629 ≈ 198.000€
    // MAF for ~198k, BRW 250 → row 200k, col >180 → 1.4 → Gebäudewert ≈ 277.000
    assert(result!.gebaeudewert > 100000, `Gebäudewert > 100k (${result!.gebaeudewert})`);
    assert(result!.gebaeudewert < 500000, `Gebäudewert < 500k (${result!.gebaeudewert})`);
    console.log(`    → Gebäudewert NHK: ${result!.gebaeudewert}€\n`);
  }

  // 21. IRW Cross-Validation (NRW)
  {
    console.log('Test 21: IRW Cross-Validation (NRW)');
    const irw = {
      irw: 3000,
      teilmarkt: 'EFH',
      stichtag: '2025-01-01',
      normobjekt: { baujahr: 1980, wohnflaeche: 120 },
      gemeinde: 'Köln',
      quelle: 'BORIS-NRW Immobilienrichtwerte' as const,
    };
    const result = buildBewertung(mockInput(), mockBRW(), mockMarktdaten(), null, irw);
    assert(result !== null, 'Result ist nicht null');
    assert(result!.datenquellen.includes('BORIS-NRW Immobilienrichtwerte'), 'Datenquelle IRW vorhanden');
    assert(result!.hinweise.some(h => h.includes('Immobilienrichtwert')), 'IRW-Hinweis vorhanden');
    console.log(`    → Hinweis: ${result!.hinweise.find(h => h.includes('Immobilienrichtwert'))}\n`);
  }

  // 22. Bundesbank Preisindex-Integration (Stichtag-Korrektur)
  {
    console.log('Test 22: Bundesbank Preisindex-basierte Stichtag-Korrektur');
    const preisindex = [
      { quartal: '2020-Q1', index: 100 },
      { quartal: '2021-Q1', index: 110 },
      { quartal: '2022-Q1', index: 120 },
      { quartal: '2023-Q1', index: 115 },
      { quartal: '2024-Q1', index: 118 },
      { quartal: '2025-Q1', index: 120 },
      { quartal: '2025-Q4', index: 122 },
    ];
    const brw = mockBRW({ stichtag: '2020-01-01' });
    const result = buildBewertung(mockInput(), brw, mockMarktdaten(), preisindex);
    assert(result !== null, 'Result ist nicht null');
    assert(result!.faktoren.stichtag_korrektur > 0, `Stichtag-Korrektur > 0 (${result!.faktoren.stichtag_korrektur})`);
    // Korrektur ≈ (122 / 100) - 1 = 0.22 (22%)
    assert(result!.hinweise.some(h => h.includes('Bundesbank')), 'Bundesbank-Hinweis vorhanden');
    console.log(`    → Stichtag-Korrektur: ${(result!.faktoren.stichtag_korrektur * 100).toFixed(1)}%`);
    console.log(`    → Hinweis: ${result!.hinweise.find(h => h.includes('Stichtag'))}\n`);
  }

  // ─── Tier-2 Feature Tests ─────────────────────────────────────────────────

  // 23. Ertragswert-Berechnung direkt (MFH)
  {
    console.log('Test 23: Ertragswert-Berechnung (MFH, 300m², 12€/m² Miete)');
    const result = calcErtragswert({
      wohnflaeche: 300,
      mietpreisProQm: 12,
      bodenwert: 150000,
      brwProQm: 200,
      baujahr: 1985,
      gebaeudTyp: 'mfh',
    });
    assert(result !== null, 'Ertragswert berechnet');
    assert(result!.ertragswert > 0, `Ertragswert > 0 (${result!.ertragswert})`);
    assert(result!.jahresrohertrag === 300 * 12 * 12, `Rohertrag = ${300 * 12 * 12} (${result!.jahresrohertrag})`);
    assert(result!.bewirtschaftungskosten > 0, `BWK > 0 (${result!.bewirtschaftungskosten})`);
    assert(result!.vervielfaeltiger > 0, `V > 0 (${result!.vervielfaeltiger})`);
    assert(result!.liegenschaftszins > 0.02 && result!.liegenschaftszins < 0.07,
      `LiZi plausibel: ${(result!.liegenschaftszins * 100).toFixed(1)}%`);
    console.log(`    → Ertragswert: ${result!.ertragswert}€, Rohertrag: ${result!.jahresrohertrag}€, LiZi: ${(result!.liegenschaftszins * 100).toFixed(1)}%, V: ${result!.vervielfaeltiger}\n`);
  }

  // 24. Ertragswert Cross-Validation im Bewertungsmodul
  {
    console.log('Test 24: Ertragswert Cross-Validation in buildBewertung');
    const input = mockInput({ art: 'Einfamilienhaus', wohnflaeche: 140, grundstuecksflaeche: 400 });
    const result = buildBewertung(input, mockBRW(), mockMarktdaten());
    assert(result !== null, 'Result ist nicht null');
    assert(result!.ertragswert !== null, `Ertragswert vorhanden (${result!.ertragswert})`);
    assert(result!.ertragswert! > 0, `Ertragswert > 0`);
    assert(result!.datenquellen.includes('Ertragswertverfahren (ImmoWertV §§ 27-34)'), 'Datenquelle Ertragswert');
    assert(result!.hinweise.some(h => h.includes('Ertragswert')), 'Ertragswert-Hinweis vorhanden');
    console.log(`    → Sachwert: ${result!.realistischer_immobilienwert}€, Ertragswert: ${result!.ertragswert}€\n`);
  }

  // 25. MAF (Marktanpassungsfaktor) in NHK-Berechnung
  {
    console.log('Test 25: Marktanpassungsfaktor (MAF) in NHK-Berechnung');
    // Niedriger BRW (30 €/m²) → MAF sollte < 1.0 für hohen Sachwert
    const nhkLow = calcGebaeudewertNHK(120, 1985, 'Freistehendes Einfamilienhaus', 'Mittel', null, true, 30);
    assert(nhkLow.marktanpassungsfaktor <= 1.1, `MAF bei BRW 30 ≤ 1.1 (${nhkLow.marktanpassungsfaktor})`);
    assert(nhkLow.hinweise.some(h => h.includes('MAF') || h.includes('Marktanpassungsfaktor')),
      'MAF-Hinweis vorhanden (BRW 30)');

    // Hoher BRW (300 €/m²) → MAF sollte > 1.0
    const nhkHigh = calcGebaeudewertNHK(120, 1985, 'Freistehendes Einfamilienhaus', 'Mittel', null, true, 300);
    assert(nhkHigh.marktanpassungsfaktor > nhkLow.marktanpassungsfaktor,
      `MAF bei BRW 300 (${nhkHigh.marktanpassungsfaktor}) > MAF bei BRW 30 (${nhkLow.marktanpassungsfaktor})`);
    assert(nhkHigh.gebaeudewert > nhkLow.gebaeudewert,
      `Gebäudewert bei hohem BRW (${nhkHigh.gebaeudewert}) > niedrigem BRW (${nhkLow.gebaeudewert})`);
    console.log(`    → BRW 30: MAF=${nhkLow.marktanpassungsfaktor}, Gebäude=${nhkLow.gebaeudewert}€`);
    console.log(`    → BRW 300: MAF=${nhkHigh.marktanpassungsfaktor}, Gebäude=${nhkHigh.gebaeudewert}€\n`);
  }

  // 26. lookupMAF Tabelle direkt testen
  {
    console.log('Test 26: lookupMAF Tabelle (Anlage 25 BewG)');
    // Niedriger Sachwert + niedriger BRW → hoher MAF
    const maf1 = lookupMAF(40000, 20);
    assert(maf1 === 1.4, `MAF(40k, BRW≤30) = 1.4 (got ${maf1})`);

    // Hoher Sachwert + hoher BRW → MAF ≈ 1.15
    const maf2 = lookupMAF(600000, 300);
    assert(maf2 === 1.15, `MAF(600k, BRW>180) = 1.15 (got ${maf2})`);

    // Mittlerer Sachwert + mittlerer BRW → MAF ≈ 1.1
    const maf3 = lookupMAF(200000, 120);
    assert(maf3 === 1.2, `MAF(200k, BRW≤120) = 1.2 (got ${maf3})`);
    console.log(`    → MAF(40k/BRW30)=${maf1}, MAF(600k/BRW300)=${maf2}, MAF(200k/BRW120)=${maf3}\n`);
  }

  // 27. Differenzierte Gesamtnutzungsdauer (GND)
  {
    console.log('Test 27: Differenzierte GND (MFH Stufe 1 = 50J vs EFH Stufe 5 = 80J)');
    // MFH mit einfacher Ausstattung → GND = 50 Jahre
    const nhkMfh = calcGebaeudewertNHK(200, 1985, 'Mehrfamilienhaus', 'Schlecht', null, true, 100);
    assert(nhkMfh.gesamtnutzungsdauer === 50, `MFH S1 GND = 50 (got ${nhkMfh.gesamtnutzungsdauer})`);

    // EFH mit gehobener Ausstattung → GND = 80 Jahre
    const nhkEfh = calcGebaeudewertNHK(200, 1985, 'Freistehendes Einfamilienhaus', 'Stark gehoben', null, true, 100);
    assert(nhkEfh.gesamtnutzungsdauer === 80, `EFH S5 GND = 80 (got ${nhkEfh.gesamtnutzungsdauer})`);

    // EFH mit mittlerer Ausstattung → GND = 70 Jahre
    const nhkMid = calcGebaeudewertNHK(200, 1985, 'Freistehendes Einfamilienhaus', 'Mittel', null, true, 100);
    assert(nhkMid.gesamtnutzungsdauer === 70, `EFH S3 GND = 70 (got ${nhkMid.gesamtnutzungsdauer})`);
    console.log(`    → MFH S1: GND=${nhkMfh.gesamtnutzungsdauer}, EFH S5: GND=${nhkEfh.gesamtnutzungsdauer}, EFH S3: GND=${nhkMid.gesamtnutzungsdauer}\n`);
  }

  // 28. NHK mit externem Baupreisindex (Destatis)
  {
    console.log('Test 28: NHK mit externem Baupreisindex (Destatis)');
    const externalBpi = {
      aktuell: 175.0,
      basis_2010: 90.4,
      stand: '2026-Q1',
      quelle: 'Destatis Genesis 61261-0002',
    };
    const nhkWithBpi = calcGebaeudewertNHK(120, 2000, 'Freistehendes Einfamilienhaus', 'Mittel', null, true, 200, externalBpi);
    const nhkWithoutBpi = calcGebaeudewertNHK(120, 2000, 'Freistehendes Einfamilienhaus', 'Mittel', null, true, 200, null);

    assert(nhkWithBpi.baupreisindex_quelle === 'Destatis Genesis 61261-0002', 'BPI Quelle = Destatis');
    assert(nhkWithoutBpi.baupreisindex_quelle === 'Fallback (hardcoded)', 'BPI Quelle = Fallback');
    // With BPI 175 vs fallback 168.2, the one with external BPI should have higher value
    assert(nhkWithBpi.baupreisindex_faktor > nhkWithoutBpi.baupreisindex_faktor,
      `BPI-Faktor Destatis (${nhkWithBpi.baupreisindex_faktor}) > Fallback (${nhkWithoutBpi.baupreisindex_faktor})`);
    assert(nhkWithBpi.gebaeudewert > nhkWithoutBpi.gebaeudewert,
      `Gebäudewert Destatis (${nhkWithBpi.gebaeudewert}) > Fallback (${nhkWithoutBpi.gebaeudewert})`);
    console.log(`    → Destatis: ${nhkWithBpi.gebaeudewert}€ (BPI ${nhkWithBpi.baupreisindex_faktor}), Fallback: ${nhkWithoutBpi.gebaeudewert}€ (BPI ${nhkWithoutBpi.baupreisindex_faktor})\n`);
  }

  // 29. Ertragswert: Kein Mietpreis → null
  {
    console.log('Test 29: Ertragswert ohne Mietdaten → null');
    const result = calcErtragswert({
      wohnflaeche: 120,
      mietpreisProQm: 0,
      bodenwert: 100000,
      brwProQm: 150,
      baujahr: 1990,
      gebaeudTyp: 'efh',
    });
    assert(result === null, 'Ertragswert ist null ohne Mietpreis');
    console.log('');
  }

  // 30. Bewertung Response enthält ertragswert Feld
  {
    console.log('Test 30: Bewertung Response enthält ertragswert Feld');
    // Mit Mietdaten + BRW + Grundstück → Ertragswert sollte berechnet werden
    const result = buildBewertung(mockInput(), mockBRW(), mockMarktdaten());
    assert(result !== null, 'Result ist nicht null');
    assert('ertragswert' in result!, 'ertragswert Feld existiert');
    // Ertragswert sollte vorhanden sein (Mietdaten + BRW + Bodenwert)
    assert(result!.ertragswert !== null, `Ertragswert vorhanden: ${result!.ertragswert}`);

    // Ohne Mietdaten → Ertragswert null
    const noMiete = buildBewertung(mockInput(), mockBRW(),
      mockMarktdaten({ haus_miete_preis: null, wohnung_miete_preis: null }));
    assert(noMiete !== null, 'Result ohne Miete ist nicht null');
    assert(noMiete!.ertragswert === null, 'Ertragswert null ohne Mietdaten');
    console.log(`    → Mit Miete: Ertragswert=${result!.ertragswert}, Ohne Miete: Ertragswert=${noMiete!.ertragswert}\n`);
  }

  // ─── Never-Null Tests ─────────────────────────────────────────────────────

  // 31. BRW vorhanden, keine Grundfläche, kein Marktpreis → Fallback (nicht null)
  {
    console.log('Test 31: BRW vorhanden, keine Grundfläche, kein Marktpreis → Fallback');
    const result = buildBewertung(
      mockInput({ grundstuecksflaeche: null, wohnflaeche: 100 }),
      mockBRW(),
      null,
    );
    assert(result !== null, 'Result ist nicht null');
    assert(result!.realistischer_immobilienwert > 0, `Immobilienwert > 0 (${result!.realistischer_immobilienwert})`);
    assert(result!.realistischer_qm_preis > 0, `QM-Preis > 0 (${result!.realistischer_qm_preis})`);
    assert(result!.immobilienwert_spanne.min > 0, 'Spanne min > 0');
    assert(result!.immobilienwert_spanne.max > result!.realistischer_immobilienwert, 'Spanne max > realistisch');
    assert(result!.hinweise.some(h => h.includes('Grundstücksfläche') && h.includes('geschätzt')),
      'Hinweis zu geschätzter Grundstücksfläche');
    console.log(`    → Wert: ${result!.realistischer_immobilienwert}€, Konfidenz: ${result!.konfidenz}\n`);
  }

  // 32. Wohnung ohne alles → Bundesdurchschnitt-Fallback
  {
    console.log('Test 32: Wohnung ohne Daten → Bundesdurchschnitt (höherer qm-Preis als Haus)');
    const resultWohnung = buildBewertung(
      mockInput({ art: 'Wohnung', wohnflaeche: 80, grundstuecksflaeche: null }),
      null, null,
    );
    const resultHaus = buildBewertung(
      mockInput({ art: 'Einfamilienhaus', wohnflaeche: 80, grundstuecksflaeche: null }),
      null, null,
    );
    assert(resultWohnung !== null, 'Wohnung-Result ist nicht null');
    assert(resultHaus !== null, 'Haus-Result ist nicht null');
    assert(resultWohnung!.realistischer_qm_preis > resultHaus!.realistischer_qm_preis,
      `Wohnung qm (${resultWohnung!.realistischer_qm_preis}) > Haus qm (${resultHaus!.realistischer_qm_preis})`);
    console.log(`    → Wohnung: ${resultWohnung!.realistischer_qm_preis}€/m², Haus: ${resultHaus!.realistischer_qm_preis}€/m²\n`);
  }

  // 33. Keine Wohnfläche, keine Grundfläche → Art-basierter Default
  {
    console.log('Test 33: Keine Wohnfläche + keine Grundfläche → Art-basierter Default');
    const result = buildBewertung(
      mockInput({ wohnflaeche: null, grundstuecksflaeche: null }),
      mockBRW(),
      mockMarktdaten(),
    );
    assert(result !== null, 'Result ist nicht null');
    assert(result!.realistischer_immobilienwert > 0, `Immobilienwert > 0 (${result!.realistischer_immobilienwert})`);
    assert(result!.konfidenz === 'gering', 'Konfidenz = gering');
    assert(result!.hinweise.some(h => h.includes('Wohnfläche geschätzt')), 'Hinweis zu geschätzter Wohnfläche');
    console.log(`    → Art-Default-Wert: ${result!.realistischer_immobilienwert}€\n`);
  }

  // 34. Alle Szenarien liefern immer min/max/realistisch > 0
  {
    console.log('Test 34: Alle Szenarien liefern min/max/realistisch > 0');
    const szenarien: [string, BewertungInput, NormalizedBRW | null, ImmoScoutPrices | null][] = [
      ['Volle Daten', mockInput(), mockBRW(), mockMarktdaten()],
      ['Nur BRW', mockInput(), mockBRW(), null],
      ['Nur Markt', mockInput({ grundstuecksflaeche: null }), null, mockMarktdaten()],
      ['Keine Daten', mockInput(), null, null],
      ['Keine WF', mockInput({ wohnflaeche: null }), mockBRW(), mockMarktdaten()],
      ['Keine WF/GF', mockInput({ wohnflaeche: null, grundstuecksflaeche: null }), null, null],
      ['Wohnung', mockInput({ art: 'Wohnung', wohnflaeche: 75 }), mockBRW(), mockMarktdaten()],
      ['MFH', mockInput({ objektunterart: 'Mehrfamilienhaus', wohnflaeche: 300 }), mockBRW(), mockMarktdaten()],
    ];

    for (const [name, input, brw, markt] of szenarien) {
      const result = buildBewertung(input, brw, markt);
      assert(result !== null, `[${name}] Result nicht null`);
      assert(result!.realistischer_immobilienwert > 0, `[${name}] Immobilienwert > 0`);
      assert(result!.realistischer_qm_preis > 0, `[${name}] QM-Preis > 0`);
      assert(result!.immobilienwert_spanne.min > 0, `[${name}] Spanne min > 0`);
      assert(result!.immobilienwert_spanne.max > 0, `[${name}] Spanne max > 0`);
      assert(result!.qm_preis_spanne.min > 0, `[${name}] QM-Spanne min > 0`);
      assert(result!.qm_preis_spanne.max > 0, `[${name}] QM-Spanne max > 0`);
    }
    console.log('');
  }

  // 35. Vergleichswertverfahren: ETW mit Marktdaten → Methode = vergleichswert, bodenwert = 0
  {
    console.log('Test 35: ETW mit Marktdaten → Vergleichswertverfahren, bodenwert=0');
    const input = mockInput({ art: 'Wohnung', wohnflaeche: 54, baujahr: 1993, grundstuecksflaeche: null });
    // wohnung_miete_preis=0 → kein 80/20, reiner Vergleichswert (testet Formel)
    const markt = mockMarktdaten({ wohnung_kauf_preis: 2100, haus_kauf_preis: 3000, wohnung_miete_preis: 0 });
    const result = buildBewertung(input, null, markt);
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'vergleichswert', 'Methode = vergleichswert');
    assert(result!.bodenwert === 0, `Bodenwert = 0 (im Vergleichswert enthalten, got ${result!.bodenwert})`);
    // Wert: 2100 × 54 × (1 + faktoren) — faktoren.baujahr negativ für 1993
    const expectedBase = 2100 * 54 * (1 + result!.faktoren.gesamt);
    assertApprox(result!.realistischer_immobilienwert, Math.round(expectedBase), 1, 'Vergleichswert = marktPreis × WF × Faktor');
    assert(result!.realistischer_immobilienwert > 0, 'Immobilienwert > 0');
    assert(result!.datenquellen.some(d => d.includes('Vergleichswertverfahren')), 'Datenquelle Vergleichswertverfahren');
    assert(result!.hinweise.some(h => h.toLowerCase().includes('vergleichswert') || h.toLowerCase().includes('bodenwertanteil')), 'Hinweis zu Vergleichswert');
    console.log(`    → Methode: ${result!.bewertungsmethode}, Wert: ${result!.realistischer_immobilienwert}€, Bodenwert: ${result!.bodenwert}€\n`);
  }

  // 36. ETW mit Markt + Mietdaten → Gewichtung 80% Vergleich + 20% Ertrag
  {
    console.log('Test 36: ETW mit Markt + Mietdaten → 80/20 Gewichtung');
    const input = mockInput({ art: 'Wohnung', wohnflaeche: 80, grundstuecksflaeche: null });
    const markt = mockMarktdaten({ wohnung_kauf_preis: 3000, wohnung_miete_preis: 12 });
    const result = buildBewertung(input, null, markt);
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'vergleichswert', 'Methode = vergleichswert');
    assert(result!.ertragswert !== null && result!.ertragswert! > 0, `Ertragswert vorhanden (${result!.ertragswert})`);
    // Wenn Ertragswert vorhanden → Spread ±6% (hoch)
    const spread = (result!.immobilienwert_spanne.max - result!.realistischer_immobilienwert) / result!.realistischer_immobilienwert;
    assertApprox(spread, 0.06, 0.01, 'Spread ≈ 6% (hoch, mit Ertragswert)');
    // Endwert ist zwischen Vergleichswert und Ertragswert
    assert(result!.realistischer_immobilienwert > 0, 'Gewichteter Wert > 0');
    console.log(`    → Wert: ${result!.realistischer_immobilienwert}€, Ertragswert: ${result!.ertragswert}€, Spread: ${(spread * 100).toFixed(1)}%\n`);
  }

  // 37. ETW ohne Marktdaten → Bundesdurchschnitt (kein NHK)
  {
    console.log('Test 37: ETW ohne Marktdaten → Bundesdurchschnitt, kein NHK');
    const input = mockInput({ art: 'Wohnung', wohnflaeche: 54, baujahr: 1993, grundstuecksflaeche: null });
    const result = buildBewertung(input, null, null); // kein BRW, keine Marktdaten
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'marktpreis-indikation', 'Methode = marktpreis-indikation (Bundesdurchschnitt)');
    assert(!result!.datenquellen.includes('NHK 2010 (ImmoWertV 2022)'), 'Keine NHK-Datenquelle für ETW');
    assert(result!.konfidenz === 'gering', 'Konfidenz = gering (Bundesdurchschnitt)');
    // Bundesdurchschnitt Wohnung 2800€/m² → deutlich höher als NHK-Ergebnis (~1371€/m²)
    assert(result!.realistischer_qm_preis > 1500, `QM-Preis > 1500 (Bundesdurchschnitt, got ${result!.realistischer_qm_preis})`);
    assert(result!.hinweise.some(h => h.includes('Bundesdurchschnitt')), 'Hinweis zu Bundesdurchschnitt');
    console.log(`    → Methode: ${result!.bewertungsmethode}, QM: ${result!.realistischer_qm_preis}€/m², Konfidenz: ${result!.konfidenz}\n`);
  }

  // 38. EFH ohne Grundfläche → weiterhin sachwert-lite mit GF-Schätzung (kein Rückschritt)
  {
    console.log('Test 38: EFH ohne Grundfläche → sachwert-lite mit GF-Schätzung (kein Rückschritt)');
    const input = mockInput({ art: 'Einfamilienhaus', wohnflaeche: 140, grundstuecksflaeche: null });
    const result = buildBewertung(input, mockBRW(), null);
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'sachwert-lite', 'Methode = sachwert-lite (EFH mit BRW)');
    assert(result!.bodenwert > 0, `Bodenwert > 0 für EFH (${result!.bodenwert})`);
    assert(result!.hinweise.some(h => h.includes('geschätzt') || h.includes('Grundstück')), 'Hinweis zu geschätzter GF');
    console.log(`    → Methode: ${result!.bewertungsmethode}, Bodenwert: ${result!.bodenwert}€\n`);
  }

  // Zusammenfassung
  console.log('═══════════════════════════════════════════════');
  console.log(`  Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  console.log('═══════════════════════════════════════════════\n');
}

// ─── Integrations-Test ───────────────────────────────────────────────────────

async function runApiTest() {
  const baseUrl = process.env.API_URL || 'http://localhost:3000';
  const token = process.env.API_TOKEN || 'test';

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Bewertungsmodul – Integrations-Test');
  console.log(`  Server: ${baseUrl}`);
  console.log('═══════════════════════════════════════════════\n');

  // Test 1: Volle Bewertung
  {
    console.log('API-Test 1: Volle Bewertung (Hamburg, EFH, alle Inputs)');
    const res = await fetch(`${baseUrl}/api/enrich`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        plz: '20095',
        ort: 'Hamburg',
        strasse: 'Rathausmarkt 1',
        art: 'Einfamilienhaus',
        grundstuecksflaeche: 500,
        wohnflaeche: 140,
        baujahr: 1985,
        objektunterart: 'Freistehendes Einfamilienhaus',
        modernisierung: 'Teilweise modernisiert',
        energie: 'Durchschnittlich',
        ausstattung: 'Mittel',
      }),
    });
    const data = await res.json();
    assert(res.ok, `HTTP ${res.status} OK`);
    assert(data.bewertung !== null && data.bewertung !== undefined, 'bewertung Feld vorhanden');
    if (data.bewertung) {
      assert(typeof data.bewertung.realistischer_immobilienwert === 'number', 'Immobilienwert ist Zahl');
      assert(typeof data.bewertung.bodenwert === 'number', 'Bodenwert ist Zahl');
      assert(typeof data.bewertung.gebaeudewert === 'number', 'Gebäudewert ist Zahl');
      assert(Array.isArray(data.bewertung.hinweise), 'Hinweise ist Array');
      assert('ertragswert' in data.bewertung, 'ertragswert Feld vorhanden');
      console.log(`    → Methode: ${data.bewertung.bewertungsmethode}`);
      console.log(`    → Wert: ${data.bewertung.realistischer_immobilienwert}€`);
      console.log(`    → Boden: ${data.bewertung.bodenwert}€, Gebäude: ${data.bewertung.gebaeudewert}€`);
      console.log(`    → Ertragswert: ${data.bewertung.ertragswert}€`);
      console.log(`    → Konfidenz: ${data.bewertung.konfidenz}`);
    }
    // Bestehende Felder unverändert
    assert('bodenrichtwert' in data, 'bodenrichtwert Feld unverändert');
    assert('marktdaten' in data, 'marktdaten Feld unverändert');
    assert('erstindikation' in data, 'erstindikation Feld unverändert');
    console.log('');
  }

  // Test 2: Ohne Wohnfläche → bewertung mit Fallback (nicht null)
  {
    console.log('API-Test 2: Ohne Wohnfläche → bewertung mit Fallback-Werten');
    const res = await fetch(`${baseUrl}/api/enrich`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        plz: '20095',
        ort: 'Hamburg',
        strasse: 'Rathausmarkt 1',
        art: 'Haus',
      }),
    });
    const data = await res.json();
    assert(res.ok, `HTTP ${res.status} OK`);
    assert(data.bewertung !== null && data.bewertung !== undefined, 'bewertung ist nicht null (Fallback)');
    if (data.bewertung) {
      assert(typeof data.bewertung.realistischer_immobilienwert === 'number', 'Immobilienwert ist Zahl');
      assert(data.bewertung.realistischer_immobilienwert > 0, 'Immobilienwert > 0');
      assert(data.bewertung.konfidenz === 'gering', 'Konfidenz = gering (Fallback)');
      assert(data.bewertung.hinweise.some((h: string) => h.includes('geschätzt')), 'Hinweis zu Schätzung');
      console.log(`    → Fallback-Wert: ${data.bewertung.realistischer_immobilienwert}€, Konfidenz: ${data.bewertung.konfidenz}`);
    }
    assert('bodenrichtwert' in data, 'bodenrichtwert Feld unverändert');
    console.log('');
  }

  console.log('═══════════════════════════════════════════════');
  console.log(`  API-Tests: ${passed} bestanden, ${failed} fehlgeschlagen`);
  console.log('═══════════════════════════════════════════════\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

const isApiTest = process.argv.includes('--api');

if (isApiTest) {
  runApiTest().catch(console.error);
} else {
  runUnitTests();
}

process.exit(failed > 0 ? 1 : 0);
