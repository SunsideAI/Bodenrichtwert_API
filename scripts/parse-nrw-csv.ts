/**
 * NRW Grundstücksmarktdaten CSV Parser
 *
 * Lädt die GMDNRW CSV-Daten (Open Data, Datenlizenz Deutschland Zero 2.0)
 * und extrahiert Liegenschaftszinssätze und Sachwertfaktoren in das JSON-Format.
 *
 * Verwendung:
 *   npx tsx scripts/parse-nrw-csv.ts [pfad-zur-csv-zip]
 *
 * Wenn kein Pfad angegeben wird, wird versucht die Datei aus
 * data/gmb/pdfs/GMDNRW_2024_CSV.zip zu laden.
 *
 * Die Ergebnisse werden in data/gmb/liegenschaftszins.json und
 * data/gmb/sachwertfaktoren.json geschrieben.
 *
 * Quelle: https://open.nrw/dataset/ad760913-eb7b-4843-b3b7-dc9100b788ca
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const DATA_DIR = join(import.meta.dirname ?? '.', '..', 'data', 'gmb');
const PDF_DIR = join(DATA_DIR, 'pdfs');

// ─── CSV-Parsing ──────────────────────────────────────────────────────────────

/**
 * Einfacher CSV-Parser (semicolon-delimited, wie in deutschen Behörden-CSVs üblich).
 */
function parseCSV(content: string, delimiter = ';'): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Versucht eine Dezimalzahl zu parsen (deutsch: Komma als Dezimaltrennzeichen).
 */
function parseDE(value: string): number {
  if (!value || value === '-' || value === '') return NaN;
  return parseFloat(value.replace(',', '.'));
}

// ─── ZIP-Extraktion ───────────────────────────────────────────────────────────

function extractZIP(zipPath: string, outDir: string): void {
  console.log(`Entpacke ${zipPath} nach ${outDir}...`);
  execSync(`unzip -o "${zipPath}" -d "${outDir}"`, { stdio: 'pipe' });
}

// ─── Liegenschaftszinssätze extrahieren ───────────────────────────────────────

interface LiZiEntry {
  teilmarkt: string;
  zins: number;
  min?: number;
  max?: number;
}

/**
 * Sucht in den CSV-Dateien nach Liegenschaftszinssätze-Daten.
 * Mögliche Spaltennamen: LiZi, Liegenschaftszinssatz, Kapitalisierungszinssatz
 */
function extractLiegenschaftszins(csvDir: string): LiZiEntry[] {
  const csvFiles = readdirSync(csvDir)
    .filter(f => extname(f).toLowerCase() === '.csv')
    .sort();

  console.log(`\nSuche Liegenschaftszinssätze in ${csvFiles.length} CSV-Dateien...`);

  // Suche nach CSV-Dateien die "LiZi" oder "Liegenschaftszins" im Namen haben
  const liziFiles = csvFiles.filter(f =>
    /lizi|liegenschaftszins|kapitalisierung/i.test(f)
  );

  if (liziFiles.length > 0) {
    console.log(`  Gefunden: ${liziFiles.join(', ')}`);
    return parseLiZiFile(join(csvDir, liziFiles[0]));
  }

  // Fallback: Alle CSV-Dateien nach relevanten Spalten durchsuchen
  console.log('  Kein dedizierter LiZi-Datei gefunden, durchsuche alle CSVs...');
  for (const f of csvFiles) {
    const content = readFileSync(join(csvDir, f), 'utf-8');
    const firstLine = content.split('\n')[0]?.toLowerCase() ?? '';
    if (firstLine.includes('liegenschaftszins') || firstLine.includes('lizi') ||
        firstLine.includes('kapitalisierungszins')) {
      console.log(`  Relevante Spalten in ${f} gefunden`);
      return parseLiZiFile(join(csvDir, f));
    }
  }

  console.log('  Keine LiZi-Daten in CSV-Dateien gefunden.');
  return [];
}

function parseLiZiFile(filePath: string): LiZiEntry[] {
  const content = readFileSync(filePath, 'utf-8');

  // Versuche beide Delimiter
  let rows = parseCSV(content, ';');
  if (rows.length === 0 || Object.keys(rows[0]).length < 2) {
    rows = parseCSV(content, ',');
  }

  if (rows.length === 0) return [];

  console.log(`  Spalten: ${Object.keys(rows[0]).join(', ')}`);
  console.log(`  ${rows.length} Zeilen`);

  // Versuche Teilmarkt + Zinssatz-Spalten zu finden
  const headers = Object.keys(rows[0]);
  const teilmarktCol = headers.find(h => /teilmarkt|immobilienart|objektart|art/i.test(h));
  const zinsCol = headers.find(h => /zins|lizi|rate|median/i.test(h));
  const minCol = headers.find(h => /min|untergrenze|von/i.test(h));
  const maxCol = headers.find(h => /max|obergrenze|bis/i.test(h));

  if (!teilmarktCol || !zinsCol) {
    console.log(`  Konnte Spalten nicht zuordnen. Teilmarkt: ${teilmarktCol}, Zins: ${zinsCol}`);
    // Zeige erste 3 Zeilen zur Diagnose
    for (const r of rows.slice(0, 3)) {
      console.log(`    ${JSON.stringify(r)}`);
    }
    return [];
  }

  const results: LiZiEntry[] = [];
  const teilmarktMap: Record<string, string> = {};

  for (const row of rows) {
    const art = row[teilmarktCol].toLowerCase();
    const zins = parseDE(row[zinsCol]);
    if (isNaN(zins) || zins <= 0 || zins > 0.15) continue;

    // Teilmarkt-Mapping auf unser Schema
    let teilmarkt: string | null = null;
    if (/einfamilien|efh|ein-.*familien/i.test(art)) teilmarkt = 'efh';
    else if (/zweifamilien|zfh|zwei-.*familien/i.test(art)) teilmarkt = 'zfh';
    else if (/eigentumswohn|etw|wohnung/i.test(art)) teilmarkt = 'etw';
    else if (/mehrfamilien|mfh|mietwohn|rendite/i.test(art)) teilmarkt = 'mfh';

    if (!teilmarkt || teilmarktMap[teilmarkt]) continue;
    teilmarktMap[teilmarkt] = art;

    const entry: LiZiEntry = { teilmarkt, zins };
    if (minCol) {
      const min = parseDE(row[minCol]);
      if (!isNaN(min) && min > 0) entry.min = min;
    }
    if (maxCol) {
      const max = parseDE(row[maxCol]);
      if (!isNaN(max) && max > 0) entry.max = max;
    }

    results.push(entry);
    console.log(`  → ${teilmarkt}: ${(zins * 100).toFixed(1)}%${entry.min ? ` (${(entry.min * 100).toFixed(1)}-${(entry.max! * 100).toFixed(1)}%)` : ''}`);
  }

  return results;
}

// ─── Sachwertfaktoren extrahieren ─────────────────────────────────────────────

interface SWFEntry {
  segment: string;
  faktor: number;
}

function extractSachwertfaktoren(csvDir: string): SWFEntry[] {
  const csvFiles = readdirSync(csvDir)
    .filter(f => extname(f).toLowerCase() === '.csv')
    .sort();

  console.log(`\nSuche Sachwertfaktoren in ${csvFiles.length} CSV-Dateien...`);

  const swfFiles = csvFiles.filter(f =>
    /swf|sachwert|marktanpassung|maf/i.test(f)
  );

  if (swfFiles.length > 0) {
    console.log(`  Gefunden: ${swfFiles.join(', ')}`);
    return parseSWFFile(join(csvDir, swfFiles[0]));
  }

  // Fallback
  console.log('  Kein dedizierter SWF-Datei gefunden, durchsuche alle CSVs...');
  for (const f of csvFiles) {
    const content = readFileSync(join(csvDir, f), 'utf-8');
    const firstLine = content.split('\n')[0]?.toLowerCase() ?? '';
    if (firstLine.includes('sachwert') || firstLine.includes('marktanpassung') ||
        firstLine.includes('swf') || firstLine.includes('maf')) {
      console.log(`  Relevante Spalten in ${f} gefunden`);
      return parseSWFFile(join(csvDir, f));
    }
  }

  console.log('  Keine SWF-Daten in CSV-Dateien gefunden.');
  return [];
}

function parseSWFFile(filePath: string): SWFEntry[] {
  const content = readFileSync(filePath, 'utf-8');

  let rows = parseCSV(content, ';');
  if (rows.length === 0 || Object.keys(rows[0]).length < 2) {
    rows = parseCSV(content, ',');
  }

  if (rows.length === 0) return [];

  console.log(`  Spalten: ${Object.keys(rows[0]).join(', ')}`);
  console.log(`  ${rows.length} Zeilen`);

  const headers = Object.keys(rows[0]);
  const segmentCol = headers.find(h => /segment|sachwert|bereich|klasse|von|bis/i.test(h));
  const faktorCol = headers.find(h => /faktor|swf|maf|wert|median/i.test(h));

  if (!segmentCol || !faktorCol) {
    console.log(`  Konnte Spalten nicht zuordnen. Segment: ${segmentCol}, Faktor: ${faktorCol}`);
    for (const r of rows.slice(0, 3)) {
      console.log(`    ${JSON.stringify(r)}`);
    }
    return [];
  }

  const results: SWFEntry[] = [];

  for (const row of rows) {
    const segment = row[segmentCol];
    const faktor = parseDE(row[faktorCol]);
    if (isNaN(faktor) || faktor <= 0 || faktor > 3) continue;
    if (!segment) continue;

    results.push({ segment, faktor });
    console.log(`  → ${segment}: ${faktor.toFixed(2)}`);
  }

  return results;
}

// ─── JSON-Dateien aktualisieren ────────────────────────────────────────────────

function updateLiZiJSON(entries: LiZiEntry[]): void {
  const filePath = join(DATA_DIR, 'liegenschaftszins.json');
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));

  data.bundeslaender['Nordrhein-Westfalen'] = {
    jahr: 2024,
    daten: entries,
  };
  data._meta.stand = new Date().toISOString().split('T')[0];

  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`\n✓ ${filePath} aktualisiert (NRW: ${entries.length} Teilmärkte)`);
}

function updateSWFJSON(entries: SWFEntry[]): void {
  const filePath = join(DATA_DIR, 'sachwertfaktoren.json');
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));

  data.bundeslaender['Nordrhein-Westfalen'] = {
    jahr: 2024,
    daten: entries,
  };
  data._meta.stand = new Date().toISOString().split('T')[0];

  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ ${filePath} aktualisiert (NRW: ${entries.length} Segmente)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let zipPath = args[0] ?? join(PDF_DIR, 'GMDNRW_2024_CSV.zip');

  if (!existsSync(zipPath)) {
    console.error(`Datei nicht gefunden: ${zipPath}`);
    console.error('\nBitte zuerst herunterladen:');
    console.error('  npx tsx scripts/download-gmb.ts --nrw');
    console.error('\nOder direkt:');
    console.error('  curl -L -o data/gmb/pdfs/GMDNRW_2024_CSV.zip \\');
    console.error('    "https://www.opengeodata.nrw.de/produkte/infrastruktur_bauen_wohnen/boris/GMD/GMDNRW_2024_CSV.zip"');
    process.exit(1);
  }

  // ZIP entpacken in temporäres Verzeichnis
  const tmpDir = join(PDF_DIR, '_nrw_csv_tmp');
  extractZIP(zipPath, tmpDir);

  // CSV-Dateien im entpackten Verzeichnis finden
  let csvDir = tmpDir;
  const subdirs = readdirSync(tmpDir).filter(f => {
    try {
      return readdirSync(join(tmpDir, f)).length > 0;
    } catch { return false; }
  });
  if (subdirs.length > 0 && !readdirSync(tmpDir).some(f => extname(f) === '.csv')) {
    csvDir = join(tmpDir, subdirs[0]);
  }

  console.log(`CSV-Verzeichnis: ${csvDir}`);
  console.log(`Dateien: ${readdirSync(csvDir).join(', ')}`);

  // Daten extrahieren
  const liziEntries = extractLiegenschaftszins(csvDir);
  const swfEntries = extractSachwertfaktoren(csvDir);

  // JSON-Dateien aktualisieren
  if (liziEntries.length > 0) {
    updateLiZiJSON(liziEntries);
  } else {
    console.log('\n⚠ Keine Liegenschaftszinssätze extrahiert');
  }

  if (swfEntries.length > 0) {
    updateSWFJSON(swfEntries);
  } else {
    console.log('⚠ Keine Sachwertfaktoren extrahiert');
  }

  // Aufräumen
  console.log(`\nTemporäres Verzeichnis: ${tmpDir}`);
  console.log('Zum Aufräumen: rm -rf ' + tmpDir);
}

main().catch(err => {
  console.error('Fehler:', err);
  process.exit(1);
});
