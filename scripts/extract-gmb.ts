/**
 * Offline-Extraktor für Grundstücksmarktberichte (GMB).
 *
 * Extrahiert strukturierte Daten aus PDF-Berichten der Gutachterausschüsse
 * mithilfe der Claude API (Batch-Verarbeitung, kein Runtime-Impact).
 *
 * Ausgabe: JSON-Dateien in /data/gmb/
 *   - liegenschaftszins.json — Regionale Liegenschaftszinssätze
 *   - sachwertfaktoren.json — Marktanpassungsfaktoren (MAF)
 *   - brw-durchschnitte.json — BRW-Durchschnitte pro Landkreis
 *
 * Verwendung:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/extract-gmb.ts <pdf-verzeichnis>
 *
 * Das Skript erwartet PDF-Dateien im Format:
 *   gmb-<bundesland-slug>.pdf (z.B. gmb-nordrhein-westfalen.pdf)
 *
 * Geschätzte Kosten: ~5-15 USD für alle 16 Bundesländer.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

// ─── Konfiguration ──────────────────────────────────────────────────────────

const DATA_DIR = join(import.meta.dirname ?? '.', '..', 'data', 'gmb');
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 8192;

// ─── Typen ──────────────────────────────────────────────────────────────────

interface LiegenschaftszinsEntry {
  /** Teilmarkt: 'efh', 'zfh', 'etw', 'mfh' */
  teilmarkt: string;
  /** Liegenschaftszins als Dezimalzahl (z.B. 0.035 = 3.5%) */
  zins: number;
  /** Optionale Spanne */
  min?: number;
  max?: number;
}

interface SachwertfaktorEntry {
  /** Preissegment-Beschreibung */
  segment: string;
  /** Sachwertfaktor (MAF) */
  faktor: number;
}

interface BRWDurchschnittEntry {
  /** Landkreis/Stadt-Name */
  name: string;
  /** Durchschnittlicher BRW in €/m² */
  brw: number;
  /** Nutzungsart (meist 'W' für Wohnen) */
  nutzungsart?: string;
}

interface ExtractedGMBData {
  bundesland: string;
  jahr: number | null;
  liegenschaftszins: LiegenschaftszinsEntry[];
  sachwertfaktoren: SachwertfaktorEntry[];
  brw_durchschnitte: BRWDurchschnittEntry[];
}

// ─── Claude API ─────────────────────────────────────────────────────────────

async function callClaude(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
): Promise<string> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const data = await res.json() as any;
  const textBlock = data.content?.find((b: any) => b.type === 'text');
  return textBlock?.text ?? '';
}

// ─── PDF → Text (vereinfacht: erwartet bereits extrahierten Text) ───────────

function readPDFText(pdfPath: string): string {
  // In einer vollständigen Implementierung würde hier pdf-parse oder
  // ein ähnliches Tool verwendet. Für den Prototyp unterstützen wir
  // .txt-Dateien (vorab mit pdftotext konvertiert).
  const txtPath = pdfPath.replace(/\.pdf$/, '.txt');
  if (existsSync(txtPath)) {
    return readFileSync(txtPath, 'utf-8');
  }
  // Wenn nur PDF vorhanden: Base64-Encoding für Claude Vision
  // (Claude kann PDFs direkt lesen)
  throw new Error(
    `Kein Textfile gefunden: ${txtPath}. ` +
    `Bitte zuerst mit 'pdftotext ${pdfPath}' konvertieren.`
  );
}

// ─── Extraction Prompt ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du bist ein Experte für deutsche Immobilienbewertung und Grundstücksmarktberichte.
Extrahiere aus dem folgenden Grundstücksmarktbericht-Text die angeforderten Daten.
Antworte ausschließlich mit validem JSON, ohne Markdown-Codeblöcke.`;

function buildExtractionPrompt(bundesland: string, text: string): string {
  // Kürze auf ~50k Zeichen (Claude-Limit für Sonnet)
  const truncated = text.length > 50000 ? text.slice(0, 50000) + '\n\n[... Text gekürzt ...]' : text;

  return `Grundstücksmarktbericht ${bundesland}:

${truncated}

---

Extrahiere folgende Daten als JSON mit exakt dieser Struktur:

{
  "bundesland": "${bundesland}",
  "jahr": <Berichtsjahr als Zahl oder null>,
  "liegenschaftszins": [
    { "teilmarkt": "efh|zfh|etw|mfh", "zins": <Dezimalzahl z.B. 0.035>, "min": <optional>, "max": <optional> }
  ],
  "sachwertfaktoren": [
    { "segment": "<Beschreibung>", "faktor": <Dezimalzahl z.B. 1.15> }
  ],
  "brw_durchschnitte": [
    { "name": "<Landkreis/Stadt>", "brw": <EUR/qm als Zahl>, "nutzungsart": "W" }
  ]
}

Regeln:
- Liegenschaftszinssätze: Suche nach Tabellen mit "Liegenschaftszins", "Kapitalisierungszins", oder "Zinssatz".
  Gib den Median oder Durchschnittswert pro Teilmarkt an.
- Sachwertfaktoren: Suche nach "Sachwertfaktor", "Marktanpassungsfaktor", "MAF", oder "Wertzahl".
  Gib Faktoren nach Preissegment an.
- BRW-Durchschnitte: Suche nach Tabellen mit "Bodenrichtwert", "BRW" pro Gemeinde/Landkreis.
  Wenn keine gemeindespezifischen Werte: Landkreis-Durchschnitte.
- Wenn ein Datentyp nicht im Bericht enthalten ist, gib ein leeres Array zurück.
- Alle Zahlen als reine Zahlen (keine Strings, keine %-Zeichen).`;
}

// ─── Hauptprogramm ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`
Grundstücksmarktbericht PDF-Extraktor

Verwendung:
  ANTHROPIC_API_KEY=sk-... npx tsx scripts/extract-gmb.ts <pdf-verzeichnis>

Das Verzeichnis sollte PDF- oder TXT-Dateien enthalten:
  gmb-nordrhein-westfalen.pdf (oder .txt)
  gmb-bayern.pdf
  ...

Die extrahierten Daten werden in data/gmb/ gespeichert.
`);
    process.exit(0);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Fehler: ANTHROPIC_API_KEY nicht gesetzt.');
    process.exit(1);
  }

  const inputDir = args[0];
  if (!existsSync(inputDir)) {
    console.error(`Verzeichnis nicht gefunden: ${inputDir}`);
    process.exit(1);
  }

  // Dateien finden
  const files = readdirSync(inputDir)
    .filter(f => f.startsWith('gmb-') && (f.endsWith('.pdf') || f.endsWith('.txt')))
    .map(f => join(inputDir, f));

  if (files.length === 0) {
    console.error(`Keine gmb-*.pdf oder gmb-*.txt Dateien in ${inputDir} gefunden.`);
    process.exit(1);
  }

  console.log(`Gefunden: ${files.length} Grundstücksmarktberichte`);

  // Bestehende Daten laden
  const liegenschaftszins: Record<string, any> = JSON.parse(
    readFileSync(join(DATA_DIR, 'liegenschaftszins.json'), 'utf-8')
  );
  const sachwertfaktoren: Record<string, any> = JSON.parse(
    readFileSync(join(DATA_DIR, 'sachwertfaktoren.json'), 'utf-8')
  );
  const brwDurchschnitte: Record<string, any> = JSON.parse(
    readFileSync(join(DATA_DIR, 'brw-durchschnitte.json'), 'utf-8')
  );

  // Jede Datei verarbeiten
  for (const filePath of files) {
    const fileName = basename(filePath);
    const bundesland = fileName
      .replace(/^gmb-/, '')
      .replace(/\.(pdf|txt)$/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

    console.log(`\nVerarbeite: ${fileName} → ${bundesland}`);

    try {
      const text = readPDFText(filePath);
      console.log(`  Text geladen: ${text.length} Zeichen`);

      const prompt = buildExtractionPrompt(bundesland, text);
      console.log(`  Sende an Claude API (${MODEL})...`);

      const response = await callClaude(SYSTEM_PROMPT, prompt, apiKey);

      // JSON parsen
      const extracted: ExtractedGMBData = JSON.parse(response);
      console.log(`  Extrahiert: ${extracted.liegenschaftszins.length} LiZi, ${extracted.sachwertfaktoren.length} MAF, ${extracted.brw_durchschnitte.length} BRW`);

      // In Ausgabe-Dateien mergen
      if (extracted.liegenschaftszins.length > 0) {
        liegenschaftszins.bundeslaender[bundesland] = {
          jahr: extracted.jahr,
          daten: extracted.liegenschaftszins,
        };
      }
      if (extracted.sachwertfaktoren.length > 0) {
        sachwertfaktoren.bundeslaender[bundesland] = {
          jahr: extracted.jahr,
          daten: extracted.sachwertfaktoren,
        };
      }
      if (extracted.brw_durchschnitte.length > 0) {
        for (const entry of extracted.brw_durchschnitte) {
          brwDurchschnitte.landkreise[entry.name] = {
            brw: entry.brw,
            bundesland,
            nutzungsart: entry.nutzungsart ?? 'W',
            jahr: extracted.jahr,
          };
        }
      }

    } catch (err: any) {
      console.error(`  Fehler bei ${fileName}: ${err.message}`);
    }
  }

  // Daten speichern
  const now = new Date().toISOString().slice(0, 10);
  liegenschaftszins._meta.stand = now;
  sachwertfaktoren._meta.stand = now;
  brwDurchschnitte._meta.stand = now;

  writeFileSync(join(DATA_DIR, 'liegenschaftszins.json'), JSON.stringify(liegenschaftszins, null, 2) + '\n');
  writeFileSync(join(DATA_DIR, 'sachwertfaktoren.json'), JSON.stringify(sachwertfaktoren, null, 2) + '\n');
  writeFileSync(join(DATA_DIR, 'brw-durchschnitte.json'), JSON.stringify(brwDurchschnitte, null, 2) + '\n');

  console.log(`\nDaten gespeichert in ${DATA_DIR}/`);

  // Zusammenfassung
  const blCount = Object.keys(liegenschaftszins.bundeslaender).length;
  const lkCount = Object.keys(brwDurchschnitte.landkreise).length;
  console.log(`  Liegenschaftszins: ${blCount} Bundesländer`);
  console.log(`  Sachwertfaktoren: ${Object.keys(sachwertfaktoren.bundeslaender).length} Bundesländer`);
  console.log(`  BRW-Durchschnitte: ${lkCount} Landkreise/Städte`);
}

main().catch(err => {
  console.error('Unerwarteter Fehler:', err);
  process.exit(1);
});
