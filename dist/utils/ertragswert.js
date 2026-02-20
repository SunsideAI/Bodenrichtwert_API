/**
 * Ertragswertverfahren nach ImmoWertV 2022 §§ 27-34.
 *
 * Berechnet den Ertragswert (Renditewert) einer Immobilie basierend auf:
 *   - Jahresrohertrag (Mieteinnahmen)
 *   - Bewirtschaftungskosten (II. BV §26)
 *   - Liegenschaftszins (BewG §256 / Gutachterausschuss)
 *   - Vervielfältiger (Barwertfaktor)
 *   - Bodenwert
 *
 * Dieses Verfahren ist besonders geeignet für:
 *   - Mehrfamilienhäuser (MFH)
 *   - Eigentumswohnungen (ETW) als Kapitalanlage
 *   - Mietwohngrundstücke
 *
 * Quellen:
 *   - ImmoWertV 2022, §§ 27-34: Ertragswertverfahren
 *   - ImmoWertV 2022, Anlage 1: Vervielfältigertabelle
 *   - BewG § 256: Liegenschaftszinssätze (gesetzlicher Fallback)
 *   - II. BV § 26: Verwaltungskosten (Anhaltswerte)
 */
const LIEGENSCHAFTSZINS = {
    mfh: { min: 0.025, max: 0.065, default: 0.040 },
    etw: { min: 0.020, max: 0.050, default: 0.030 },
    efh: { min: 0.015, max: 0.040, default: 0.025 },
    zfh: { min: 0.020, max: 0.045, default: 0.030 },
};
// ─── GMB-Daten Loader (Liegenschaftszinssätze aus Grundstücksmarktberichten) ─
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
let _gmbLiZiCache = null;
let _gmbLiZiLoaded = false;
function loadGMBLiegenschaftszins() {
    if (_gmbLiZiLoaded)
        return _gmbLiZiCache;
    _gmbLiZiLoaded = true;
    try {
        const filePath = join(import.meta.dirname ?? '.', '..', '..', 'data', 'gmb', 'liegenschaftszins.json');
        if (!existsSync(filePath))
            return null;
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (data?.bundeslaender && Object.keys(data.bundeslaender).length > 0) {
            _gmbLiZiCache = data;
            return _gmbLiZiCache;
        }
    }
    catch { /* Fallback auf hardcoded Werte */ }
    return null;
}
/**
 * Leitet den Liegenschaftszins aus dem BRW-Niveau ab.
 * Höherer BRW → niedrigerer Zins (inverse Korrelation: teure Lagen = geringere Rendite).
 *
 * Priorität:
 *   1. GMB-Daten (aus Grundstücksmarktberichten, wenn für Bundesland verfügbar)
 *   2. BRW-basierte Interpolation (Fallback, hardcoded Ranges)
 */
function deriveLiegenschaftszins(typ, brwProQm, bundesland) {
    // 1. Versuch: GMB-Daten
    if (bundesland) {
        const gmb = loadGMBLiegenschaftszins();
        if (gmb?.bundeslaender[bundesland]) {
            const blData = gmb.bundeslaender[bundesland];
            const match = blData.daten.find(d => d.teilmarkt === typ);
            if (match && match.zins > 0) {
                return Math.round(match.zins * 1000) / 1000;
            }
        }
    }
    // 2. Fallback: BRW-basierte Interpolation
    const range = LIEGENSCHAFTSZINS[typ] ?? LIEGENSCHAFTSZINS.mfh;
    // Lineare Interpolation: BRW 0 → max, BRW 500 → min
    const brwNorm = Math.min(Math.max(brwProQm, 0), 500) / 500;
    const zins = range.max - brwNorm * (range.max - range.min);
    // Auf 3 Dezimalstellen runden (z.B. 0.035)
    return Math.round(zins * 1000) / 1000;
}
function calcBewirtschaftungskosten(wohnflaeche, jahresrohertrag, baujahr) {
    const currentYear = new Date().getFullYear();
    const alter = baujahr != null ? currentYear - baujahr : 30;
    // Verwaltungskosten: 230 €/Wohnung/Jahr (Proxy: 1 Wohnung pro 80m² Wohnfläche)
    const anzahlWE = Math.max(1, Math.round(wohnflaeche / 80));
    const verwaltung = anzahlWE * 230;
    // Instandhaltungskosten (II. BV altersabhängig)
    let ihkProQm;
    if (alter < 22)
        ihkProQm = 7.10;
    else if (alter < 32)
        ihkProQm = 9.00;
    else
        ihkProQm = 11.50;
    const instandhaltung = Math.round(wohnflaeche * ihkProQm);
    // Mietausfallwagnis: 2% des Rohertrags
    const mietausfallwagnis = Math.round(jahresrohertrag * 0.02);
    return {
        verwaltung,
        instandhaltung,
        mietausfallwagnis,
        gesamt: verwaltung + instandhaltung + mietausfallwagnis,
    };
}
// ─── Vervielfältiger (Barwertfaktor, ImmoWertV Anlage 1) ───────────────────
/**
 * Berechnet den Vervielfältiger (Barwertfaktor) nach ImmoWertV Anlage 1.
 *
 * V = ((1+i)^n - 1) / ((1+i)^n × i)
 *
 * @param liegenschaftszins - Zinssatz als Dezimalzahl (z.B. 0.04 = 4%)
 * @param restnutzungsdauer - Restnutzungsdauer in Jahren
 */
function calcVervielfaeltiger(liegenschaftszins, restnutzungsdauer) {
    if (liegenschaftszins <= 0 || restnutzungsdauer <= 0)
        return 0;
    const i = liegenschaftszins;
    const n = restnutzungsdauer;
    const qn = Math.pow(1 + i, n);
    return (qn - 1) / (qn * i);
}
// ─── Hauptfunktion ──────────────────────────────────────────────────────────
/**
 * Berechnet den Ertragswert nach ImmoWertV 2022 §§ 27-34 (allgemeines Verfahren).
 *
 * Formel:
 *   Ertragswert = Gebäudeertragswert + Bodenwert
 *   Gebäudeertragswert = (Reinertrag - Bodenwertverzinsung) × Vervielfältiger
 *   Reinertrag = Rohertrag - Bewirtschaftungskosten
 *
 * @param input - Eingabeparameter für die Ertragswertberechnung
 * @returns ErtragswertResult oder null wenn Berechnung nicht möglich
 */
export function calcErtragswert(input) {
    const { wohnflaeche, mietpreisProQm, bodenwert, brwProQm, baujahr, gebaeudTyp, bundesland } = input;
    // Gate: Wir brauchen Mietpreis, Wohnfläche und Bodenwert
    if (!mietpreisProQm || mietpreisProQm <= 0)
        return null;
    if (!wohnflaeche || wohnflaeche <= 0)
        return null;
    if (bodenwert <= 0)
        return null;
    const hinweise = [];
    // 1. Jahresrohertrag (monatliche Kaltmiete × 12)
    const jahresrohertrag = Math.round(wohnflaeche * mietpreisProQm * 12);
    // 2. Bewirtschaftungskosten
    const bwk = calcBewirtschaftungskosten(wohnflaeche, jahresrohertrag, baujahr);
    const bwkAnteil = ((bwk.gesamt / jahresrohertrag) * 100).toFixed(1);
    // 3. Jahresreinertrag
    const jahresreinertrag = jahresrohertrag - bwk.gesamt;
    if (jahresreinertrag <= 0) {
        hinweise.push('Reinertrag negativ. Bewirtschaftungskosten übersteigen Mieteinnahmen.');
        return null;
    }
    // 4. Liegenschaftszins (bevorzugt aus GMB-Daten, Fallback: BRW-Interpolation)
    const liegenschaftszins = deriveLiegenschaftszins(gebaeudTyp, brwProQm, bundesland);
    // 5. Bodenwertverzinsung
    const bodenwertverzinsung = bodenwert * liegenschaftszins;
    // 6. Gebäudereinertrag
    const gebaeudereinertrag = jahresreinertrag - bodenwertverzinsung;
    // 7. Restnutzungsdauer
    const rnd = input.restnutzungsdauer ?? estimateRND(baujahr, gebaeudTyp);
    // 8. Vervielfältiger
    const vervielfaeltiger = calcVervielfaeltiger(liegenschaftszins, rnd);
    // 9. Gebäudeertragswert
    const gebaeudeertragswert = Math.round(Math.max(0, gebaeudereinertrag * vervielfaeltiger));
    // 10. Ertragswert
    const ertragswert = gebaeudeertragswert + bodenwert;
    // Hinweise
    hinweise.push(`Ertragswert: ${jahresrohertrag.toLocaleString('de-DE')} € Rohertrag - ${bwk.gesamt.toLocaleString('de-DE')} € BWK (${bwkAnteil}%) = ${jahresreinertrag.toLocaleString('de-DE')} € Reinertrag.`);
    hinweise.push(`Liegenschaftszins ${(liegenschaftszins * 100).toFixed(1)}% (BRW ${brwProQm} €/m²), Vervielfältiger ${vervielfaeltiger.toFixed(2)} (RND ${rnd} J.).`);
    if (gebaeudereinertrag < 0) {
        hinweise.push('Bodenwertverzinsung übersteigt Reinertrag. Gebäudeertragswert auf 0 gesetzt.');
    }
    return {
        ertragswert,
        gebaeudeertragswert,
        jahresrohertrag,
        bewirtschaftungskosten: bwk.gesamt,
        jahresreinertrag,
        liegenschaftszins,
        vervielfaeltiger: Math.round(vervielfaeltiger * 100) / 100,
        bodenwert,
        hinweise,
    };
}
// ─── Hilfsfunktionen ────────────────────────────────────────────────────────
/**
 * Schätzt die Restnutzungsdauer basierend auf Baujahr und Gebäudetyp.
 * Fallback wenn keine explizite RND übergeben wird.
 */
function estimateRND(baujahr, typ) {
    const currentYear = new Date().getFullYear();
    const alter = baujahr != null ? currentYear - baujahr : 30;
    // GND nach Typ (vereinfacht, mittlere Standardstufe)
    const gnd = typ === 'mfh' || typ === 'etw' ? 60 : 70;
    return Math.max(5, gnd - alter); // Minimum 5 Jahre
}
//# sourceMappingURL=ertragswert.js.map