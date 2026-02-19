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
    // ±8% für hoch
    const expectedMin = Math.round(result!.realistischer_qm_preis * 0.92);
    const expectedMax = Math.round(result!.realistischer_qm_preis * 1.08);
    assertApprox(result!.qm_preis_spanne.min, expectedMin, 1, 'Spanne = ±8%');
    assertApprox(result!.qm_preis_spanne.max, expectedMax, 1, 'Spanne max = +8%');
    assert(result!.datenquellen.includes('BORIS/WFS Bodenrichtwert'), 'Datenquelle BRW');
    assert(result!.datenquellen.includes('ImmoScout24 Atlas Marktpreise'), 'Datenquelle ImmoScout');
    console.log(`    → Immobilienwert: ${result!.realistischer_immobilienwert}€, Boden: ${result!.bodenwert}€, Gebäude: ${result!.gebaeudewert}€\n`);
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

  // 4. Keine Wohnfläche → null
  {
    console.log('Test 4: Keine Wohnfläche → null');
    const result = buildBewertung(mockInput({ wohnflaeche: null }), mockBRW(), mockMarktdaten());
    assert(result === null, 'Result ist null');
    console.log('');
  }

  // 5. Keine Daten → null
  {
    console.log('Test 5: Keine Daten (weder BRW noch ImmoScout) → null');
    const result = buildBewertung(mockInput({ wohnflaeche: 100 }), null, null);
    assert(result === null, 'Result ist null');
    console.log('');
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
    const markt = mockMarktdaten({ wohnung_kauf_preis: 4500, haus_kauf_preis: 3000 });
    const result = buildBewertung(input, null, markt);
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'marktpreis-indikation', 'Methode = marktpreis-indikation (Wohnung ohne Grundstück)');
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

  // 12. Marktpreis-Indikation (BRW vorhanden aber keine Grundstücksfläche)
  {
    console.log('Test 12: BRW vorhanden aber keine Grundstücksfläche → marktpreis-indikation');
    const input = mockInput({ grundstuecksflaeche: null });
    const result = buildBewertung(input, mockBRW(), mockMarktdaten());
    assert(result !== null, 'Result ist nicht null');
    assert(result!.bewertungsmethode === 'marktpreis-indikation', 'Methode = marktpreis-indikation');
    assert(result!.hinweise.some(h => h.includes('Grundstücksfläche fehlt')), 'Hinweis zu fehlender Grundstücksfläche');
    console.log(`    → Methode: ${result!.bewertungsmethode}\n`);
  }

  // 13. Wohnfläche = 0 → null
  {
    console.log('Test 13: Wohnfläche = 0 → null');
    const result = buildBewertung(mockInput({ wohnflaeche: 0 }), mockBRW(), mockMarktdaten());
    assert(result === null, 'Result ist null');
    console.log('');
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
    // Alter ≈ 26J von 80J GND → RND/GND ≈ 54/80 ≈ 0.675
    // Gebäudewert ≈ 315.000 * 0.675 ≈ 213.000€
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
      console.log(`    → Methode: ${data.bewertung.bewertungsmethode}`);
      console.log(`    → Wert: ${data.bewertung.realistischer_immobilienwert}€`);
      console.log(`    → Boden: ${data.bewertung.bodenwert}€, Gebäude: ${data.bewertung.gebaeudewert}€`);
      console.log(`    → Konfidenz: ${data.bewertung.konfidenz}`);
    }
    // Bestehende Felder unverändert
    assert('bodenrichtwert' in data, 'bodenrichtwert Feld unverändert');
    assert('marktdaten' in data, 'marktdaten Feld unverändert');
    assert('erstindikation' in data, 'erstindikation Feld unverändert');
    console.log('');
  }

  // Test 2: Ohne Wohnfläche → bewertung null
  {
    console.log('API-Test 2: Ohne Wohnfläche → bewertung: null');
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
    assert(data.bewertung === null, 'bewertung ist null (keine Wohnfläche)');
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
