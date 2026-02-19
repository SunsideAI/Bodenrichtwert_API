/**
 * Destatis Genesis API — Baupreisindex für Wohngebäude.
 *
 * Ruft Tabelle 61261-0002 (quartalsweise Baupreisindizes, Basis 2015=100)
 * vom Statistischen Bundesamt ab und extrahiert den aktuellsten Index.
 *
 * Verwendet für die NHK 2010 Anpassung (2010 → aktuell).
 *
 * Datenquelle: https://www-genesis.destatis.de
 * Lizenz: Datenlizenz Deutschland – Namensnennung – Version 2.0
 */
// ─── Hardcoded Fallback ─────────────────────────────────────────────────────
// Wird verwendet wenn die API nicht erreichbar ist.
// Sollte bei jedem Release manuell aktualisiert werden.
const FALLBACK_BPI_2010 = 90.4; // Jahresdurchschnitt 2010 (Basis 2015=100)
const FALLBACK_BPI_AKTUELL = 168.2; // Q3/2025
const FALLBACK_BPI_STAND = '2025-Q3';
// ─── API-Konfiguration ──────────────────────────────────────────────────────
const GENESIS_BASE = 'https://www-genesis.destatis.de/genesisWS/rest/2020';
const TABLE_CODE = '61261-0002';
// ─── Hauptfunktion ──────────────────────────────────────────────────────────
/**
 * Ruft den aktuellen Baupreisindex für Wohngebäude ab.
 *
 * 1. Versucht Destatis Genesis API (Tabelle 61261-0002)
 * 2. Fallback auf hardcoded Werte bei API-Fehler
 *
 * @returns BaupreisindexResult mit aktuellem Index und 2010-Basis
 */
export async function fetchBaupreisindex() {
    try {
        const entries = await fetchFromGenesis();
        if (entries.length > 0) {
            // Sortiert nach Quartal (chronologisch), letzter = aktuellster
            entries.sort((a, b) => a.quartal.localeCompare(b.quartal));
            const aktuell = entries[entries.length - 1];
            // 2010 Jahresdurchschnitt berechnen (Q1-Q4 mitteln, falls vorhanden)
            const entries2010 = entries.filter((e) => e.quartal.startsWith('2010'));
            const basis2010 = entries2010.length > 0
                ? entries2010.reduce((sum, e) => sum + e.index, 0) / entries2010.length
                : FALLBACK_BPI_2010;
            return {
                aktuell: aktuell.index,
                stand: aktuell.quartal,
                basis_2010: Math.round(basis2010 * 10) / 10,
                faktor: Math.round((aktuell.index / basis2010) * 100) / 100,
                zeitreihe: entries,
                quelle: 'Destatis Genesis 61261-0002',
            };
        }
    }
    catch (err) {
        console.warn('Destatis Genesis API Fehler:', err);
    }
    // Fallback
    return {
        aktuell: FALLBACK_BPI_AKTUELL,
        stand: FALLBACK_BPI_STAND,
        basis_2010: FALLBACK_BPI_2010,
        faktor: Math.round((FALLBACK_BPI_AKTUELL / FALLBACK_BPI_2010) * 100) / 100,
        zeitreihe: [],
        quelle: 'Fallback (hardcoded)',
    };
}
// ─── Genesis API Abruf ──────────────────────────────────────────────────────
async function fetchFromGenesis() {
    const params = new URLSearchParams({
        username: 'GAST',
        password: 'GAST',
        name: TABLE_CODE,
        area: 'all',
        compress: 'false',
        format: 'ffcsv',
        language: 'de',
        startyear: '2010',
        endyear: String(new Date().getFullYear() + 1),
    });
    const res = await fetch(`${GENESIS_BASE}/data/tablefile?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
        console.warn(`Destatis Genesis HTTP ${res.status}: ${res.statusText}`);
        return [];
    }
    const text = await res.text();
    return parseFfcsv(text);
}
// ─── FFCSV Parser ───────────────────────────────────────────────────────────
/**
 * Parst Destatis Flat-File CSV (FFCSV) Format.
 *
 * FFCSV-Struktur:
 *   Zeile 1: Header mit Spaltenbezeichnungen
 *   Zeile 2+: Datenzeilen, Semikolon-getrennt
 *
 * Wir suchen Zeilen mit:
 *   - Zeitraum-Spalte: z.B. "2025Q3", "2024Q4"
 *   - Gebäudeart: "Wohngebäude" oder ähnlich
 *   - Wert-Spalte: Der Indexwert
 */
function parseFfcsv(csv) {
    const lines = csv.split('\n').filter((l) => l.trim());
    if (lines.length < 2)
        return [];
    // Header analysieren
    const header = lines[0].split(';').map((h) => h.trim().replace(/"/g, ''));
    // Spalten-Indizes finden
    const zeitIdx = header.findIndex((h) => /zeit|time|quartal|period/i.test(h));
    const wertIdx = header.findIndex((h) => /wert|value|index|__/i.test(h) || h === '');
    // Alle numerischen Spalten finden (für den Fall dass die Spalten anders benannt sind)
    const entries = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(';').map((c) => c.trim().replace(/"/g, ''));
        // Quartal finden: Format "2025Q3", "2025-Q3", "2025 Q3", "Q3 2025", etc.
        let quartal = null;
        let indexValue = null;
        for (const col of cols) {
            // Quartal-Muster
            const qMatch = col.match(/(\d{4})\s*Q(\d)/i) || col.match(/Q(\d)\s*(\d{4})/i);
            if (qMatch) {
                const year = qMatch[1].length === 4 ? qMatch[1] : qMatch[2];
                const q = qMatch[1].length === 4 ? qMatch[2] : qMatch[1];
                quartal = `${year}-Q${q}`;
                continue;
            }
            // Jahresformat "2010", "2011" — als Q4 interpretieren
            if (/^\d{4}$/.test(col) && parseInt(col) >= 2000 && parseInt(col) <= 2100) {
                if (!quartal)
                    quartal = `${col}-Q4`;
                continue;
            }
        }
        // Wert finden: Letzte numerische Spalte, die wie ein Index aussieht (50-300)
        for (let j = cols.length - 1; j >= 0; j--) {
            const numStr = cols[j].replace(',', '.');
            const num = parseFloat(numStr);
            if (!isNaN(num) && num >= 50 && num <= 300) {
                indexValue = num;
                break;
            }
        }
        // Nur Zeilen die "Wohngebäude" oder "insgesamt" enthalten (falls erkennbar)
        const lineStr = lines[i].toLowerCase();
        const isWohngebaeude = lineStr.includes('wohngebäude') ||
            lineStr.includes('wohngebaeude') ||
            lineStr.includes('wohngeb') ||
            lineStr.includes('insgesamt') ||
            // Wenn kein Typ erkennbar, trotzdem nehmen
            !lineStr.includes('bürogebäude') &&
                !lineStr.includes('gewerb');
        if (quartal && indexValue && isWohngebaeude) {
            // Duplikate vermeiden (bevorzuge "Wohngebäude" über "insgesamt")
            const existing = entries.findIndex((e) => e.quartal === quartal);
            if (existing >= 0) {
                if (lineStr.includes('wohngebäude') || lineStr.includes('wohngeb')) {
                    entries[existing].index = indexValue;
                }
            }
            else {
                entries.push({ quartal, index: indexValue });
            }
        }
    }
    return entries;
}
//# sourceMappingURL=destatis.js.map