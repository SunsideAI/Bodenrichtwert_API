/**
 * NHK 2010 — Normalherstellungskosten nach ImmoWertV 2022 Anlage 4.
 *
 * Berechnet den Gebäude-Herstellungswert basierend auf:
 *   - NHK 2010 Kostenkennwerten (EUR/m² BGF, Preisstand 2010)
 *   - Baupreisindex-Anpassung (2010 → aktuell) — automatisch via Destatis oder Fallback
 *   - Gesamtnutzungsdauer differenziert nach Gebäudetyp und Standardstufe (ImmoWertV 2022 Anlage 1)
 *   - Lineare Alterswertminderung (SW-RL §8)
 *   - Marktanpassungsfaktor (Sachwertfaktor) nach Anlage 25 BewG
 *
 * Quellen:
 *   - ImmoWertV 2022, Anlage 4: Kostenkennwerte nach Gebäudeart und Standardstufe
 *   - ImmoWertV 2022, Anlage 1: Gesamtnutzungsdauer (standardabhängig)
 *   - SW-RL Anlage 4: Restnutzungsdauer-Modifikation bei Modernisierung
 *   - Anlage 25 BewG (JStG 2022): Wertzahlen (Sachwertfaktoren) als MAF-Fallback
 *   - Destatis Tabelle 61261-0002: Baupreisindex für Wohngebäude (Basis 2015=100)
 */
// ─── NHK 2010 Kostenkennwerte (EUR/m² BGF, Preisstand 2010) ─────────────────
//
// Quelle: ImmoWertV 2022, Anlage 4 / SW-RL Anlage 1
//
// Gebäudeart 1.01: Freist. EFH (KG, EG, DG voll ausgebaut) — bestätigte Werte
// Andere Typen: Abgeleitet aus Verhältnissen der NHK-Tabelle
//   - DHH/Reihenendhaus ≈ 93% von EFH (Gebäudeart 2.xx, weniger Außenwand)
//   - Reihenmittelhaus ≈ 88% von EFH (Gebäudeart 3.xx, zwei Grenzmauern)
//   - ZFH ≈ EFH × 1.05 (expliziter NHK-Korrekturfaktor)
//   - MFH ≈ 75% von EFH (Gebäudearten 5.xx, Skaleneffekte)
const NHK_2010 = {
    // Gebäudeart 1.01: EFH freistehend (KG+EG+DG ausgebaut)
    // Stufe 1: 655, Stufe 2: 725, Stufe 3: 835, Stufe 4: 1005, Stufe 5: 1260
    efh_freistehend: { 1: 655, 2: 725, 3: 835, 4: 1005, 5: 1260 },
    // Gebäudeart 2.xx: DHH / Reihenendhaus (~93% von EFH)
    dhh: { 1: 610, 2: 675, 3: 775, 4: 935, 5: 1170 },
    reihenend: { 1: 610, 2: 675, 3: 775, 4: 935, 5: 1170 },
    // Gebäudeart 3.xx: Reihenmittelhaus (~88% von EFH)
    reihenmittel: { 1: 575, 2: 640, 3: 735, 4: 885, 5: 1110 },
    // ZFH: EFH × 1.05 (NHK-Korrekturfaktor lt. Anlage 4)
    zfh: { 1: 690, 2: 760, 3: 875, 4: 1055, 5: 1325 },
    // Gebäudeart 5.xx: MFH (~75% von EFH, Skaleneffekte)
    mfh: { 1: 490, 2: 545, 3: 625, 4: 755, 5: 945 },
    // ETW: Anteil an MFH-Berechnung
    etw: { 1: 490, 2: 545, 3: 625, 4: 755, 5: 945 },
};
// ─── Gesamtnutzungsdauer (ImmoWertV 2022 Anlage 1) ─────────────────────────
//
// Differenziert nach Gebäudetyp UND Standardstufe.
// EFH/ZFH/DHH/Reihen: 60-80 Jahre (S1=60, S2=65, S3=70, S4=75, S5=80)
// MFH/ETW: 50-80 Jahre (S1=50, S2=55, S3=60, S4=70, S5=80)
const GESAMTNUTZUNGSDAUER = {
    efh_freistehend: { 1: 60, 2: 65, 3: 70, 4: 75, 5: 80 },
    dhh: { 1: 60, 2: 65, 3: 70, 4: 75, 5: 80 },
    reihenend: { 1: 60, 2: 65, 3: 70, 4: 75, 5: 80 },
    reihenmittel: { 1: 60, 2: 65, 3: 70, 4: 75, 5: 80 },
    zfh: { 1: 60, 2: 65, 3: 70, 4: 75, 5: 80 },
    mfh: { 1: 50, 2: 55, 3: 60, 4: 70, 5: 80 },
    etw: { 1: 50, 2: 55, 3: 60, 4: 70, 5: 80 },
};
// ─── BGF-Schätzung (Wohnfläche → Brutto-Grundfläche) ────────────────────────
//
// DIN 277: BGF = Summe aller marktüblich nutzbaren Grundflächen (Bereich a+b)
// Typische Verhältnisse (Erfahrungswerte):
//   - EFH freistehend: BGF ≈ Wohnfläche × 1.35 (Keller, Treppe, Wände)
//   - DHH/Reihen: BGF ≈ Wohnfläche × 1.25 (weniger Grundfläche)
//   - MFH: BGF ≈ Wohnfläche × 1.25 (Flure, Treppenhäuser)
const BGF_FAKTOR = {
    efh_freistehend: 1.35,
    dhh: 1.25,
    reihenend: 1.25,
    reihenmittel: 1.20,
    zfh: 1.30,
    mfh: 1.25,
    etw: 1.25,
};
// ─── Baupreisindex Fallback (Destatis, Wohngebäude, Basis 2015=100) ─────────
//
// Quelle: Statistisches Bundesamt, Tabelle 61261-0002
// Der Index wird quartalsweise veröffentlicht.
// Diese Werte werden nur verwendet wenn der automatische Abruf fehlschlägt.
const FALLBACK_BPI_2010 = 90.4; // Jahresdurchschnitt 2010
const FALLBACK_BPI_AKTUELL = 168.2; // Q3/2025 (letzte manuelle Aktualisierung)
const FALLBACK_BPI_STAND = '2025-Q3';
const MAF_TABLE = [
    { sachwertBis: 50000, faktoren: [1.4, 1.5, 1.6, 1.7, 1.8] },
    { sachwertBis: 100000, faktoren: [1.2, 1.3, 1.4, 1.5, 1.6] },
    { sachwertBis: 150000, faktoren: [1.1, 1.2, 1.3, 1.4, 1.5] },
    { sachwertBis: 200000, faktoren: [1.0, 1.1, 1.2, 1.3, 1.4] },
    { sachwertBis: 300000, faktoren: [0.9, 1.0, 1.1, 1.2, 1.3] },
    { sachwertBis: 400000, faktoren: [0.85, 0.95, 1.05, 1.15, 1.25] },
    { sachwertBis: 500000, faktoren: [0.8, 0.9, 1.0, 1.1, 1.2] },
    { sachwertBis: Infinity, faktoren: [0.8, 0.85, 0.95, 1.05, 1.15] },
];
/**
 * Bestimmt den Marktanpassungsfaktor (Sachwertfaktor) anhand des
 * vorlaeufigen Sachwerts und des BRW-Niveaus.
 *
 * Basis: Anlage 25 BewG (vereinfachte Approximation).
 */
export function lookupMAF(vorlaeufigSachwert, brwProQm) {
    // BRW-Niveau-Index: [≤30, ≤60, ≤120, ≤180, >180]
    let brwIdx;
    if (brwProQm <= 30)
        brwIdx = 0;
    else if (brwProQm <= 60)
        brwIdx = 1;
    else if (brwProQm <= 120)
        brwIdx = 2;
    else if (brwProQm <= 180)
        brwIdx = 3;
    else
        brwIdx = 4;
    // Sachwert-Zeile finden
    const row = MAF_TABLE.find((r) => vorlaeufigSachwert <= r.sachwertBis)
        ?? MAF_TABLE[MAF_TABLE.length - 1];
    return row.faktoren[brwIdx];
}
// ─── Mapping-Funktionen ──────────────────────────────────────────────────────
/**
 * Mappt objektunterart-String auf GebaeudTyp.
 * Gleiche Logik wie calcObjektunterartFaktor in bewertung.ts.
 */
export function mapObjektunterart(objektunterart, istHaus) {
    if (!objektunterart)
        return istHaus ? 'efh_freistehend' : 'etw';
    const o = objektunterart.toLowerCase();
    if (o.includes('doppelhaushälfte') || o.includes('doppelhaushalfte') || o === 'dhh')
        return 'dhh';
    if (o.includes('reihenendhaus'))
        return 'reihenend';
    if (o.includes('reihenmittelhaus'))
        return 'reihenmittel';
    if (o.includes('zweifamilienhaus') || o === 'zfh')
        return 'zfh';
    if (o.includes('mehrfamilienhaus') || o.includes('mfh'))
        return 'mfh';
    if (o.includes('stadthaus') || o.includes('townhouse'))
        return 'reihenend';
    if (o.includes('bungalow') || o.includes('freistehend'))
        return 'efh_freistehend';
    if (o.includes('bauernhaus') || o.includes('resthof'))
        return 'efh_freistehend';
    return istHaus ? 'efh_freistehend' : 'etw';
}
/**
 * Mappt ausstattung-String oder Score auf Standardstufe (1–5).
 */
export function mapAusstattung(ausstattung) {
    if (!ausstattung)
        return 3; // Default: mittel
    // Numerischer Score
    const score = Number(ausstattung);
    if (!isNaN(score) && String(ausstattung).trim() !== '') {
        if (score >= 5)
            return 5;
        if (score >= 4)
            return 4;
        if (score >= 3)
            return 3;
        if (score >= 2)
            return 2;
        return 1;
    }
    // Text-Matching
    const a = ausstattung.toLowerCase();
    if (a.includes('stark gehoben') || a.includes('luxus'))
        return 5;
    if (a.includes('gehoben'))
        return 4;
    if (a.includes('mittel') || a.includes('normal') || a.includes('standard'))
        return 3;
    if (a.includes('einfach'))
        return 2;
    if (a.includes('schlecht'))
        return 1;
    return 3;
}
/**
 * Berechnet die modifizierte Restnutzungsdauer bei Modernisierung.
 * Vereinfachtes Modell nach SW-RL Anlage 4:
 *   - Kernsanierung/Neuwertig: Restnutzungsdauer auf mind. 65% der GND anheben
 *   - Umfassend: mind. 50% der GND
 *   - Teilweise: mind. 35% der GND
 *   - Einzelne: Keine Änderung
 */
function calcModifizierteRestnutzungsdauer(restnutzungsdauer, gesamtnutzungsdauer, modernisierung) {
    if (!modernisierung)
        return restnutzungsdauer;
    const m = modernisierung.toLowerCase();
    const score = Number(modernisierung);
    let minAnteil = 0;
    if (!isNaN(score) && String(modernisierung).trim() !== '') {
        if (score >= 5)
            minAnteil = 0.65;
        else if (score >= 4)
            minAnteil = 0.50;
        else if (score >= 3)
            minAnteil = 0.35;
        else
            return restnutzungsdauer;
    }
    else if (m.includes('kernsanierung') || m.includes('neuwertig')) {
        minAnteil = 0.65;
    }
    else if (m.includes('umfassend') || m.includes('vollständig') || m.includes('vollsaniert')) {
        minAnteil = 0.50;
    }
    else if (m.includes('teilweise') || m.includes('teilsaniert')) {
        minAnteil = 0.35;
    }
    else {
        return restnutzungsdauer;
    }
    const minRND = Math.round(gesamtnutzungsdauer * minAnteil);
    return Math.max(restnutzungsdauer, minRND);
}
// ─── Hauptfunktion ───────────────────────────────────────────────────────────
/**
 * Berechnet den Gebäude-Herstellungswert nach NHK 2010.
 *
 * Formel: Gebäudewert = NHK_2010 × BGF × BPI-Faktor × (RND / GND) × MAF
 *
 * @param wohnflaeche - Wohnfläche in m²
 * @param baujahr - Baujahr (null → Default 30 Jahre Alter)
 * @param objektunterart - Objekttyp-String (null → EFH)
 * @param ausstattung - Ausstattungsniveau (Score 1–5 oder Text)
 * @param modernisierung - Modernisierungsgrad (Score 1–5 oder Text)
 * @param istHaus - true = Haus, false = Wohnung (Default: true)
 * @param brwProQm - Bodenrichtwert EUR/m² (für MAF-Bestimmung, Default: 100)
 * @param externalBpi - Externer Baupreisindex {aktuell, basis_2010, stand, quelle} (falls verfügbar)
 */
export function calcGebaeudewertNHK(wohnflaeche, baujahr, objektunterart, ausstattung, modernisierung, istHaus = true, brwProQm = 100, externalBpi) {
    const hinweise = [];
    // 1. Gebäudetyp + Standardstufe bestimmen
    const typ = mapObjektunterart(objektunterart, istHaus);
    const stufe = mapAusstattung(ausstattung);
    // 2. NHK 2010 Kostenkennwert (EUR/m² BGF)
    const nhk2010 = NHK_2010[typ][stufe];
    // 3. BGF schätzen
    const bgfFaktor = BGF_FAKTOR[typ];
    const bgf = Math.round(wohnflaeche * bgfFaktor);
    // 4. Baupreisindex-Anpassung (2010 → aktuell)
    const bpiAktuell = externalBpi?.aktuell ?? FALLBACK_BPI_AKTUELL;
    const bpi2010 = externalBpi?.basis_2010 ?? FALLBACK_BPI_2010;
    const bpiStand = externalBpi?.stand ?? FALLBACK_BPI_STAND;
    const bpiQuelle = externalBpi?.quelle ?? 'Fallback (hardcoded)';
    const bpiFaktor = bpiAktuell / bpi2010;
    // 5. Gesamtnutzungsdauer (differenziert nach Typ + Stufe)
    const gnd = GESAMTNUTZUNGSDAUER[typ][stufe];
    const currentYear = new Date().getFullYear();
    const gebaeudealter = baujahr != null
        ? currentYear - baujahr
        : 30; // Default: 30 Jahre wenn kein Baujahr bekannt
    if (baujahr == null) {
        hinweise.push('Kein Baujahr angegeben. NHK-Berechnung nimmt 30 Jahre Gebäudealter an.');
    }
    // Restnutzungsdauer (mit Modernisierungs-Modifikation)
    const basisRND = Math.max(0, gnd - gebaeudealter);
    const rnd = calcModifizierteRestnutzungsdauer(basisRND, gnd, modernisierung);
    const alterswertminderung = gnd > 0 ? rnd / gnd : 0;
    // 6. Vorlaeufiger Sachwert (vor MAF)
    const herstellungskosten = nhk2010 * bgf * bpiFaktor;
    const gebaeudewertVorMAF = Math.round(herstellungskosten * alterswertminderung);
    // 7. Marktanpassungsfaktor (Anlage 25 BewG)
    const maf = lookupMAF(gebaeudewertVorMAF, brwProQm);
    const gebaeudewert = Math.round(gebaeudewertVorMAF * maf);
    // 8. Hinweise
    if (gebaeudealter > gnd) {
        hinweise.push(`Gebäudealter (${gebaeudealter} J.) übersteigt Gesamtnutzungsdauer (${gnd} J.). Gebäudewert auf Restwert reduziert.`);
    }
    if (rnd > basisRND) {
        hinweise.push(`Modernisierung verlängert Restnutzungsdauer von ${basisRND} auf ${rnd} Jahre.`);
    }
    if (maf !== 1.0) {
        hinweise.push(`Marktanpassungsfaktor ${maf.toFixed(2)} angewandt (Anlage 25 BewG, BRW ${brwProQm} €/m²).`);
    }
    hinweise.push(`NHK-Berechnung: ${nhk2010} €/m² BGF × ${bgf} m² BGF × ${bpiFaktor.toFixed(2)} (BPI ${bpiStand}) × ${(alterswertminderung * 100).toFixed(0)}% (RND ${rnd}/${gnd} J.) × ${maf.toFixed(2)} (MAF) = ${gebaeudewert.toLocaleString('de-DE')} € [GND=${gnd}J, BPI: ${bpiQuelle}].`);
    return {
        gebaeudewert: Math.max(0, gebaeudewert),
        gebaeudewert_vor_maf: Math.max(0, gebaeudewertVorMAF),
        nhk_2010_pro_qm_bgf: nhk2010,
        bgf_geschaetzt: bgf,
        baupreisindex_faktor: Math.round(bpiFaktor * 100) / 100,
        baupreisindex_quelle: bpiQuelle,
        alterswertminderung: Math.round(alterswertminderung * 100) / 100,
        gesamtnutzungsdauer: gnd,
        restnutzungsdauer: rnd,
        marktanpassungsfaktor: maf,
        hinweise,
    };
}
//# sourceMappingURL=nhk.js.map