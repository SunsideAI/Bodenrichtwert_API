/**
 * Download-Skript für Grundstücksmarktberichte (GMB).
 *
 * Lädt öffentlich verfügbare Immobilienmarktberichte und GMB-Daten
 * der Gutachterausschüsse herunter.
 *
 * Verwendung:
 *   npx tsx scripts/download-gmb.ts [--all | --bayern | --nrw | ...]
 *
 * Heruntergeladene Dateien werden in data/gmb/pdfs/ gespeichert
 * (in .gitignore, nicht im Repository).
 *
 * Quellen:
 *   - Bayern: OGA Bayern Immobilienmarktbericht (kostenlos)
 *   - NRW: Open.NRW Grundstücksmarktdaten (Open Data, CSV)
 *   - Weitere Bundesländer: Obere Gutachterausschüsse
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── Konfiguration ──────────────────────────────────────────────────────────

const DATA_DIR = join(import.meta.dirname ?? '.', '..', 'data', 'gmb');
const PDF_DIR = join(DATA_DIR, 'pdfs');

// ─── Download-Quellen ───────────────────────────────────────────────────────
//
// Hinweis: URLs können sich ändern. Bei 404/403 die Webseite manuell prüfen.
// Alle Links sind kostenlos und öffentlich zugänglich (Stand: 2025).

interface DownloadSource {
  /** Bundesland-Name */
  bundesland: string;
  /** Kurzschlüssel für CLI */
  slug: string;
  /** Download-URL */
  url: string;
  /** Erwarteter Dateityp */
  typ: 'pdf' | 'csv' | 'xlsx';
  /** Beschreibung */
  beschreibung: string;
  /** Ausgabe-Dateiname */
  dateiname: string;
}

const SOURCES: DownloadSource[] = [
  // ── Bayern (höchste Priorität — kein offizieller WFS-BRW) ─────────────
  {
    bundesland: 'Bayern',
    slug: 'bayern',
    url: 'https://www.gutachterausschuesse-bayern.de/fileadmin/user_upload/Immobilienmarktberichte/2024_IMB_BY.pdf',
    typ: 'pdf',
    beschreibung: 'OGA Bayern Immobilienmarktbericht 2024',
    dateiname: 'gmb-bayern-2024.pdf',
  },
  // ── NRW (Open Data — CSV mit Liegenschaftszinssätzen) ─────────────────
  {
    bundesland: 'Nordrhein-Westfalen',
    slug: 'nrw',
    url: 'https://www.opengeodata.nrw.de/produkte/kataster_und_vermessung/grundstuecksmarktdaten/liegenschaftszinssaetze/LiZi_NRW.csv',
    typ: 'csv',
    beschreibung: 'NRW Liegenschaftszinssätze (Open Data CSV)',
    dateiname: 'nrw-liegenschaftszins.csv',
  },
  {
    bundesland: 'Nordrhein-Westfalen',
    slug: 'nrw',
    url: 'https://www.opengeodata.nrw.de/produkte/kataster_und_vermessung/grundstuecksmarktdaten/sachwertfaktoren/SWF_NRW.csv',
    typ: 'csv',
    beschreibung: 'NRW Sachwertfaktoren (Open Data CSV)',
    dateiname: 'nrw-sachwertfaktoren.csv',
  },
  // ── Rheinland-Pfalz ──────────────────────────────────────────────────
  {
    bundesland: 'Rheinland-Pfalz',
    slug: 'rlp',
    url: 'https://gutachterausschuesse.rlp.de/fileadmin/OGA/download/immobilienmarktberichte/LGMB-2025_RLP.pdf',
    typ: 'pdf',
    beschreibung: 'OGA RLP Landesgrundstücksmarktbericht 2025',
    dateiname: 'gmb-rheinland-pfalz-2025.pdf',
  },
  // ── Hessen ───────────────────────────────────────────────────────────
  {
    bundesland: 'Hessen',
    slug: 'hessen',
    url: 'https://hvbg.hessen.de/sites/default/files/2024-12/Immobilienmarktbericht_Hessen_2024.pdf',
    typ: 'pdf',
    beschreibung: 'HVBG Hessen Immobilienmarktbericht 2024',
    dateiname: 'gmb-hessen-2024.pdf',
  },
  // ── Brandenburg ──────────────────────────────────────────────────────
  {
    bundesland: 'Brandenburg',
    slug: 'brandenburg',
    url: 'https://gutachterausschuss.brandenburg.de/sixcms/media.php/9/GMB_Land_Brandenburg_2024.pdf',
    typ: 'pdf',
    beschreibung: 'OGA Brandenburg GMB 2024',
    dateiname: 'gmb-brandenburg-2024.pdf',
  },
  // ── Sachsen ──────────────────────────────────────────────────────────
  {
    bundesland: 'Sachsen',
    slug: 'sachsen',
    url: 'https://www.boris.sachsen.de/download/Grundstuecksmarktbericht_Sachsen_2024.pdf',
    typ: 'pdf',
    beschreibung: 'OGA Sachsen GMB 2024',
    dateiname: 'gmb-sachsen-2024.pdf',
  },
  // ── Mecklenburg-Vorpommern ───────────────────────────────────────────
  {
    bundesland: 'Mecklenburg-Vorpommern',
    slug: 'mv',
    url: 'https://www.laiv-mv.de/static/LAIV/Dateien/Grundst%C3%BCcksmarktberichte/GMB_MV_2024.pdf',
    typ: 'pdf',
    beschreibung: 'LAIV-MV GMB 2024',
    dateiname: 'gmb-mecklenburg-vorpommern-2024.pdf',
  },
  // ── Thüringen ────────────────────────────────────────────────────────
  {
    bundesland: 'Thüringen',
    slug: 'thueringen',
    url: 'https://tlbg.thueringen.de/fileadmin/TLBG/Wertermittlung/Berichte/GMB_Thueringen_2024.pdf',
    typ: 'pdf',
    beschreibung: 'TLBG Thüringen GMB 2024',
    dateiname: 'gmb-thueringen-2024.pdf',
  },
  // ── Sachsen-Anhalt ───────────────────────────────────────────────────
  {
    bundesland: 'Sachsen-Anhalt',
    slug: 'sachsen-anhalt',
    url: 'https://www.lvermgeo.sachsen-anhalt.de/de/download/gdp-grundstuecksmarktbericht/GMB_Sachsen-Anhalt_2024.pdf',
    typ: 'pdf',
    beschreibung: 'LVermGeo Sachsen-Anhalt GMB 2024',
    dateiname: 'gmb-sachsen-anhalt-2024.pdf',
  },
];

// ─── Download-Logik ─────────────────────────────────────────────────────────

async function downloadFile(source: DownloadSource): Promise<boolean> {
  const outPath = join(PDF_DIR, source.dateiname);

  if (existsSync(outPath)) {
    console.log(`  ⏭ Bereits vorhanden: ${source.dateiname}`);
    return true;
  }

  console.log(`  ⬇ Lade herunter: ${source.beschreibung}`);
  console.log(`    URL: ${source.url}`);

  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BRW-API-Datensammlung/1.0)',
        'Accept': source.typ === 'csv'
          ? 'text/csv,text/plain,*/*'
          : 'application/pdf,*/*',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      console.error(`    ✗ HTTP ${res.status} ${res.statusText}`);
      return false;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(outPath, buffer);

    const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
    console.log(`    ✓ Gespeichert: ${source.dateiname} (${sizeMB} MB)`);
    return true;

  } catch (err: any) {
    console.error(`    ✗ Fehler: ${err.message}`);
    return false;
  }
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const showHelp = args.includes('--help') || args.includes('-h');

  if (showHelp) {
    console.log(`
GMB-Download-Skript — Lädt Grundstücksmarktberichte herunter.

Verwendung:
  npx tsx scripts/download-gmb.ts [Optionen]

Optionen:
  --all               Alle verfügbaren Quellen herunterladen
  --bayern            Nur Bayern IMB
  --nrw               Nur NRW Open Data (CSV)
  --rlp               Nur Rheinland-Pfalz
  --hessen            Nur Hessen
  --brandenburg       Nur Brandenburg
  --sachsen           Nur Sachsen
  --mv                Nur Mecklenburg-Vorpommern
  --thueringen        Nur Thüringen
  --sachsen-anhalt    Nur Sachsen-Anhalt
  --list              Verfügbare Quellen anzeigen
  --help              Diese Hilfe anzeigen

Dateien werden in data/gmb/pdfs/ gespeichert.

Anschließend mit extract-gmb.ts die Daten extrahieren:
  ANTHROPIC_API_KEY=sk-... npx tsx scripts/extract-gmb.ts data/gmb/pdfs/
`);
    return;
  }

  if (args.includes('--list')) {
    console.log('\nVerfügbare GMB-Quellen:\n');
    for (const s of SOURCES) {
      console.log(`  --${s.slug.padEnd(18)} ${s.beschreibung} (${s.typ.toUpperCase()})`);
    }
    console.log(`\nGesamt: ${SOURCES.length} Quellen`);
    return;
  }

  // Verzeichnis erstellen
  if (!existsSync(PDF_DIR)) {
    mkdirSync(PDF_DIR, { recursive: true });
  }

  // Quellen filtern
  const requestedSlugs = args
    .filter(a => a.startsWith('--') && a !== '--all')
    .map(a => a.replace(/^--/, ''));

  const isAll = args.length === 0 || args.includes('--all');

  const selectedSources = isAll
    ? SOURCES
    : SOURCES.filter(s => requestedSlugs.includes(s.slug));

  if (selectedSources.length === 0) {
    console.error('Keine Quellen ausgewählt. Verwende --all oder --<bundesland>.');
    console.error('Verfügbare: ' + [...new Set(SOURCES.map(s => `--${s.slug}`))].join(', '));
    process.exit(1);
  }

  console.log(`\nGMB-Download: ${selectedSources.length} Quellen\n`);

  let successCount = 0;
  let failCount = 0;

  for (const source of selectedSources) {
    console.log(`[${source.bundesland}]`);
    const ok = await downloadFile(source);
    if (ok) successCount++;
    else failCount++;
  }

  console.log(`\n─── Ergebnis ───`);
  console.log(`  Erfolgreich: ${successCount}`);
  if (failCount > 0) {
    console.log(`  Fehlgeschlagen: ${failCount}`);
    console.log(`\n  Hinweis: Bei 403/404-Fehlern die URL manuell in Browser prüfen.`);
    console.log(`  GMB-Download-URLs ändern sich jährlich.`);
  }

  if (successCount > 0) {
    console.log(`\nNächster Schritt:`);
    console.log(`  ANTHROPIC_API_KEY=sk-... npx tsx scripts/extract-gmb.ts data/gmb/pdfs/`);
  }
}

main().catch(err => {
  console.error('Unerwarteter Fehler:', err);
  process.exit(1);
});
