/**
 * Test-Script für alle Bundesland-Adapter
 *
 * Nutzung:
 *   npx tsx test-all-adapters.ts              # Alle testen
 *   npx tsx test-all-adapters.ts HH HE        # Nur Hamburg + Hessen
 *   npx tsx test-all-adapters.ts --api         # Via laufende API (localhost:3000)
 */

import { HamburgAdapter } from './src/adapters/hamburg.js';
import { HessenAdapter } from './src/adapters/hessen.js';
import { BrandenburgAdapter } from './src/adapters/brandenburg.js';
import { SachsenAdapter } from './src/adapters/sachsen.js';
import { SachsenAnhaltAdapter } from './src/adapters/sachsen-anhalt.js';
import { SchleswigHolsteinAdapter } from './src/adapters/schleswig-holstein.js';
import { ThueringenAdapter } from './src/adapters/thueringen.js';
import { MecklenburgVorpommernAdapter } from './src/adapters/mecklenburg-vorpommern.js';
import { BerlinAdapter } from './src/adapters/berlin.js';
import { NRWAdapter } from './src/adapters/nrw.js';
import { NiedersachsenAdapter } from './src/adapters/niedersachsen.js';
import { RheinlandPfalzAdapter } from './src/adapters/rlp.js';
import { BremenAdapter } from './src/adapters/bremen.js';
import { BayernAdapter } from './src/adapters/bayern.js';
import { SaarlandAdapter } from './src/adapters/saarland.js';
import { ImmoScoutAdapter } from './src/adapters/immoscout.js';
import { ChainedAdapter } from './src/adapters/chained.js';

// ═══════════════════════════════════════════════
// Testfälle: Bekannte Adressen mit Koordinaten
// ═══════════════════════════════════════════════
const TEST_CASES = [
  {
    code: 'HH',
    name: 'Hamburg',
    adapter: new HamburgAdapter(),
    lat: 53.5530,
    lon: 9.9925,
    adresse: 'Jungfernstieg 1, 20095, Hamburg',
  },
  {
    code: 'HE',
    name: 'Hessen',
    adapter: new HessenAdapter(),
    lat: 50.1109,
    lon: 8.6821,
    adresse: 'Zeil 1, 60313, Frankfurt am Main',
  },
  {
    code: 'BB',
    name: 'Brandenburg',
    adapter: new BrandenburgAdapter(),
    lat: 52.3906,
    lon: 13.0645,
    adresse: 'Brandenburger Straße 1, 14467, Potsdam',
  },
  {
    code: 'SN',
    name: 'Sachsen',
    adapter: new SachsenAdapter(),
    lat: 51.3397,
    lon: 12.3731,
    adresse: 'Grimmaische Straße 1, 04109, Leipzig',
  },
  {
    code: 'ST',
    name: 'Sachsen-Anhalt',
    adapter: new SachsenAnhaltAdapter(),
    lat: 51.4818,
    lon: 11.9695,
    adresse: 'Marktplatz 1, 06108, Halle (Saale)',
  },
  {
    code: 'SH',
    name: 'Schleswig-Holstein',
    adapter: new SchleswigHolsteinAdapter(),
    lat: 54.3233,
    lon: 10.1228,
    adresse: 'Holstenstraße 1, 24103, Kiel',
  },
  {
    code: 'TH',
    name: 'Thüringen',
    adapter: new ThueringenAdapter(),
    lat: 50.9787,
    lon: 11.0328,
    adresse: 'Anger 1, 99084, Erfurt',
  },
  {
    code: 'MV',
    name: 'Mecklenburg-Vorpommern',
    adapter: new MecklenburgVorpommernAdapter(),
    lat: 53.6355,
    lon: 11.4015,
    adresse: 'Schlossstraße 1, 19053, Schwerin',
  },
  // ── Bereits getestete Adapter (zum Gegencheck) ──
  {
    code: 'BE',
    name: 'Berlin',
    adapter: new BerlinAdapter(),
    lat: 52.5172,
    lon: 13.3978,
    adresse: 'Unter den Linden 1, 10117, Berlin',
  },
  {
    code: 'NW',
    name: 'NRW',
    adapter: new NRWAdapter(),
    lat: 51.2277,
    lon: 6.7735,
    adresse: 'Königsallee 1, 40212, Düsseldorf',
  },
  {
    code: 'NI',
    name: 'Niedersachsen',
    adapter: new NiedersachsenAdapter(),
    lat: 52.3759,
    lon: 9.7320,
    adresse: 'Georgstraße 1, 30159, Hannover',
  },
  {
    code: 'RP',
    name: 'Rheinland-Pfalz',
    adapter: new RheinlandPfalzAdapter(),
    lat: 50.0014,
    lon: 8.2592,
    adresse: 'Langgasse 1, 65183, Wiesbaden',
  },
  {
    code: 'HB',
    name: 'Bremen',
    adapter: new BremenAdapter(),
    lat: 53.0793,
    lon: 8.8017,
    adresse: 'Obernstraße 1, 28195, Bremen',
  },
  {
    code: 'BY',
    name: 'Bayern',
    adapter: new ChainedAdapter(new BayernAdapter(), new ImmoScoutAdapter('Bayern')),
    lat: 48.1374,
    lon: 11.5755,
    adresse: 'Marienplatz 1, 80331, München',
  },
  {
    code: 'SL',
    name: 'Saarland',
    adapter: new SaarlandAdapter(),
    lat: 49.2354,
    lon: 6.9969,
    adresse: 'Bahnhofstraße 1, 66111, Saarbrücken',
  },
  {
    code: 'BW',
    name: 'Baden-Württemberg',
    adapter: new ImmoScoutAdapter('Baden-Württemberg'),
    lat: 48.7758,
    lon: 9.1829,
    adresse: 'Königstraße 1, 70173, Stuttgart',
  },
];

// ═══════════════════════════════════════════════
// Farben für Terminal-Ausgabe
// ═══════════════════════════════════════════════
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ═══════════════════════════════════════════════
// Direkt-Test (Adapter ohne API aufrufen)
// ═══════════════════════════════════════════════
async function testDirect(testCase: typeof TEST_CASES[0]) {
  const start = Date.now();
  try {
    const result = await testCase.adapter.getBodenrichtwert(testCase.lat, testCase.lon);
    const elapsed = Date.now() - start;

    if (result && result.wert > 0) {
      console.log(`  ${GREEN}OK${RESET}  ${BOLD}${testCase.code}${RESET} ${testCase.name}`);
      console.log(`       Wert: ${BOLD}${result.wert} EUR/m²${RESET}  Stichtag: ${result.stichtag}`);
      console.log(`       Nutzung: ${result.nutzungsart}  Gemeinde: ${result.gemeinde}`);
      console.log(`       Quelle: ${result.quelle}  ${DIM}(${elapsed}ms)${RESET}`);
      return { code: testCase.code, status: 'OK', wert: result.wert, ms: elapsed };
    } else {
      console.log(`  ${RED}FAIL${RESET}  ${BOLD}${testCase.code}${RESET} ${testCase.name}`);
      console.log(`       Kein Ergebnis (null) ${DIM}(${elapsed}ms)${RESET}`);
      return { code: testCase.code, status: 'FAIL', wert: null, ms: elapsed };
    }
  } catch (err: any) {
    const elapsed = Date.now() - start;
    console.log(`  ${RED}ERR${RESET}  ${BOLD}${testCase.code}${RESET} ${testCase.name}`);
    console.log(`       ${err.message} ${DIM}(${elapsed}ms)${RESET}`);
    return { code: testCase.code, status: 'ERROR', wert: null, ms: elapsed, error: err.message };
  }
}

// ═══════════════════════════════════════════════
// API-Test (via localhost:3000)
// ═══════════════════════════════════════════════
async function testViaApi(testCase: typeof TEST_CASES[0], baseUrl: string) {
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strasse: testCase.adresse.split(',')[0].trim(),
        plz: testCase.adresse.split(',')[1]?.trim() || '',
        ort: testCase.adresse.split(',')[2]?.trim() || '',
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json() as any;
    const elapsed = Date.now() - start;

    if (data.status === 'success' && data.bodenrichtwert?.wert > 0) {
      console.log(`  ${GREEN}OK${RESET}  ${BOLD}${testCase.code}${RESET} ${testCase.name}`);
      console.log(`       Wert: ${BOLD}${data.bodenrichtwert.wert} EUR/m²${RESET}  Stichtag: ${data.bodenrichtwert.stichtag}`);
      console.log(`       Adresse: ${data.input_echo?.adresse}`);
      console.log(`       ${DIM}(${elapsed}ms, cached: ${data.meta?.cached})${RESET}`);
      return { code: testCase.code, status: 'OK', wert: data.bodenrichtwert.wert, ms: elapsed };
    } else {
      console.log(`  ${RED}FAIL${RESET}  ${BOLD}${testCase.code}${RESET} ${testCase.name}`);
      console.log(`       Status: ${data.status} – ${data.error || data.bodenrichtwert?.grund || 'unbekannt'}`);
      console.log(`       ${DIM}(${elapsed}ms)${RESET}`);
      return { code: testCase.code, status: 'FAIL', wert: null, ms: elapsed };
    }
  } catch (err: any) {
    const elapsed = Date.now() - start;
    console.log(`  ${RED}ERR${RESET}  ${BOLD}${testCase.code}${RESET} ${testCase.name}`);
    console.log(`       ${err.message} ${DIM}(${elapsed}ms)${RESET}`);
    return { code: testCase.code, status: 'ERROR', wert: null, ms: elapsed, error: err.message };
  }
}

// ═══════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════
async function main() {
  const args = process.argv.slice(2);
  const useApi = args.includes('--api');
  const apiUrl = args.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://localhost:3000';
  const filterCodes = args.filter(a => !a.startsWith('--')).map(a => a.toUpperCase());

  let cases = TEST_CASES;
  if (filterCodes.length > 0) {
    cases = TEST_CASES.filter(tc => filterCodes.includes(tc.code));
    if (cases.length === 0) {
      console.log(`Keine Adapter gefunden für: ${filterCodes.join(', ')}`);
      console.log(`Verfügbar: ${TEST_CASES.map(tc => tc.code).join(', ')}`);
      process.exit(1);
    }
  }

  console.log('');
  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  BRW Adapter Test – ${useApi ? `API (${apiUrl})` : 'Direkt'}${RESET}`);
  console.log(`${CYAN}  ${cases.length} Adapter werden getestet${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log('');

  const results = [];

  for (const tc of cases) {
    if (useApi) {
      results.push(await testViaApi(tc, apiUrl));
    } else {
      results.push(await testDirect(tc));
    }
    console.log('');
  }

  // ── Zusammenfassung ──
  const ok = results.filter(r => r.status === 'OK');
  const fail = results.filter(r => r.status === 'FAIL');
  const err = results.filter(r => r.status === 'ERROR');

  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`  ${BOLD}Ergebnis:${RESET} ${GREEN}${ok.length} OK${RESET} / ${fail.length > 0 ? RED : DIM}${fail.length} FAIL${RESET} / ${err.length > 0 ? RED : DIM}${err.length} ERROR${RESET}`);
  console.log('');

  if (ok.length > 0) {
    console.log(`  ${GREEN}Erfolgreich:${RESET} ${ok.map(r => r.code).join(', ')}`);
  }
  if (fail.length > 0) {
    console.log(`  ${RED}Fehlgeschlagen:${RESET} ${fail.map(r => r.code).join(', ')}`);
  }
  if (err.length > 0) {
    console.log(`  ${RED}Fehler:${RESET} ${err.map(r => r.code).join(', ')}`);
  }

  const avgMs = Math.round(results.reduce((sum, r) => sum + r.ms, 0) / results.length);
  console.log(`  ${DIM}Durchschnittliche Antwortzeit: ${avgMs}ms${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log('');

  // Exit-Code: 1 wenn irgendwas fehlschlägt
  if (fail.length > 0 || err.length > 0) process.exit(1);
}

main().catch(console.error);
