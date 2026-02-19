/**
 * NHK 2010 — Normalherstellungskosten nach ImmoWertV 2022 Anlage 4.
 *
 * Berechnet den Gebäude-Herstellungswert basierend auf:
 *   - NHK 2010 Kostenkennwerten (EUR/m² BGF, Preisstand 2010)
 *   - Baupreisindex-Anpassung (2010 → aktuell)
 *   - Lineare Alterswertminderung (SW-RL §8)
 *
 * Quellen:
 *   - ImmoWertV 2022, Anlage 4: Kostenkennwerte nach Gebäudeart und Standardstufe
 *   - SW-RL Anlage 3: Gesamtnutzungsdauer (60–80 Jahre für Wohngebäude)
 *   - SW-RL Anlage 4: Restnutzungsdauer-Modifikation bei Modernisierung
 *   - Destatis: Baupreisindex für Wohngebäude (Basis 2015=100)
 */

// ─── Typen ───────────────────────────────────────────────────────────────────

export type GebaeudTyp =
  | 'efh_freistehend'
  | 'dhh'
  | 'reihenend'
  | 'reihenmittel'
  | 'zfh'
  | 'mfh'
  | 'etw';

/** Standardstufe 1 (einfachst) bis 5 (stark gehoben) */
export type Standardstufe = 1 | 2 | 3 | 4 | 5;

export interface NHKResult {
  gebaeudewert: number;
  nhk_2010_pro_qm_bgf: number;
  bgf_geschaetzt: number;
  baupreisindex_faktor: number;
  alterswertminderung: number;
  gesamtnutzungsdauer: number;
  restnutzungsdauer: number;
  hinweise: string[];
}

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

const NHK_2010: Record<GebaeudTyp, Record<Standardstufe, number>> = {
  // Gebäudeart 1.01: EFH freistehend (KG+EG+DG ausgebaut)
  // Stufe 1: 655, Stufe 2: 725, Stufe 3: 835, Stufe 4: 1005, Stufe 5: 1260
  efh_freistehend: { 1: 655, 2: 725, 3: 835, 4: 1005, 5: 1260 },

  // Gebäudeart 2.xx: DHH / Reihenendhaus (~93% von EFH)
  dhh:             { 1: 610, 2: 675, 3: 775, 4: 935, 5: 1170 },
  reihenend:       { 1: 610, 2: 675, 3: 775, 4: 935, 5: 1170 },

  // Gebäudeart 3.xx: Reihenmittelhaus (~88% von EFH)
  reihenmittel:    { 1: 575, 2: 640, 3: 735, 4: 885, 5: 1110 },

  // ZFH: EFH × 1.05 (NHK-Korrekturfaktor lt. Anlage 4)
  zfh:             { 1: 690, 2: 760, 3: 875, 4: 1055, 5: 1325 },

  // Gebäudeart 5.xx: MFH (~75% von EFH, Skaleneffekte)
  mfh:             { 1: 490, 2: 545, 3: 625, 4: 755, 5: 945 },

  // ETW: Anteil an MFH-Berechnung
  etw:             { 1: 490, 2: 545, 3: 625, 4: 755, 5: 945 },
};

// ─── Gesamtnutzungsdauer (SW-RL Anlage 3) ────────────────────────────────────

const GESAMTNUTZUNGSDAUER: Record<GebaeudTyp, number> = {
  efh_freistehend: 80,
  dhh: 80,
  reihenend: 80,
  reihenmittel: 80,
  zfh: 80,
  mfh: 80,
  etw: 80,
};

// ─── BGF-Schätzung (Wohnfläche → Brutto-Grundfläche) ────────────────────────
//
// DIN 277: BGF = Summe aller marktüblich nutzbaren Grundflächen (Bereich a+b)
// Typische Verhältnisse (Erfahrungswerte):
//   - EFH freistehend: BGF ≈ Wohnfläche × 1.35 (Keller, Treppe, Wände)
//   - DHH/Reihen: BGF ≈ Wohnfläche × 1.25 (weniger Grundfläche)
//   - MFH: BGF ≈ Wohnfläche × 1.25 (Flure, Treppenhäuser)

const BGF_FAKTOR: Record<GebaeudTyp, number> = {
  efh_freistehend: 1.35,
  dhh: 1.25,
  reihenend: 1.25,
  reihenmittel: 1.20,
  zfh: 1.30,
  mfh: 1.25,
  etw: 1.25,
};

// ─── Baupreisindex (Destatis, Wohngebäude, Basis 2015=100) ───────────────────
//
// Quelle: Statistisches Bundesamt, Baureihe 441
// Der Index wird quartalsweise veröffentlicht.
// TODO: Könnte per Destatis Genesis API automatisch aktualisiert werden.

const BAUPREISINDEX_2010 = 90.4;      // Jahresdurchschnitt 2010
const BAUPREISINDEX_AKTUELL = 168.2;   // Q3/2025 (letzte Aktualisierung)
const BAUPREISINDEX_STAND = '2025-Q3';

// ─── Mapping-Funktionen ──────────────────────────────────────────────────────

/**
 * Mappt objektunterart-String auf GebaeudTyp.
 * Gleiche Logik wie calcObjektunterartFaktor in bewertung.ts.
 */
function mapObjektunterart(
  objektunterart: string | null,
  istHaus: boolean,
): GebaeudTyp {
  if (!objektunterart) return istHaus ? 'efh_freistehend' : 'etw';

  const o = objektunterart.toLowerCase();
  if (o.includes('doppelhaushälfte') || o.includes('doppelhaushalfte') || o === 'dhh')
    return 'dhh';
  if (o.includes('reihenendhaus')) return 'reihenend';
  if (o.includes('reihenmittelhaus')) return 'reihenmittel';
  if (o.includes('zweifamilienhaus') || o === 'zfh') return 'zfh';
  if (o.includes('mehrfamilienhaus') || o.includes('mfh')) return 'mfh';
  if (o.includes('stadthaus') || o.includes('townhouse')) return 'reihenend';
  if (o.includes('bungalow') || o.includes('freistehend')) return 'efh_freistehend';
  if (o.includes('bauernhaus') || o.includes('resthof')) return 'efh_freistehend';

  return istHaus ? 'efh_freistehend' : 'etw';
}

/**
 * Mappt ausstattung-String oder Score auf Standardstufe (1–5).
 */
function mapAusstattung(ausstattung: string | null): Standardstufe {
  if (!ausstattung) return 3; // Default: mittel

  // Numerischer Score
  const score = Number(ausstattung);
  if (!isNaN(score) && String(ausstattung).trim() !== '') {
    if (score >= 5) return 5;
    if (score >= 4) return 4;
    if (score >= 3) return 3;
    if (score >= 2) return 2;
    return 1;
  }

  // Text-Matching
  const a = ausstattung.toLowerCase();
  if (a.includes('stark gehoben') || a.includes('luxus')) return 5;
  if (a.includes('gehoben')) return 4;
  if (a.includes('mittel') || a.includes('normal') || a.includes('standard')) return 3;
  if (a.includes('einfach')) return 2;
  if (a.includes('schlecht')) return 1;

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
function calcModifizierteRestnutzungsdauer(
  restnutzungsdauer: number,
  gesamtnutzungsdauer: number,
  modernisierung: string | null,
): number {
  if (!modernisierung) return restnutzungsdauer;

  const m = modernisierung.toLowerCase();
  const score = Number(modernisierung);

  let minAnteil = 0;
  if (!isNaN(score) && String(modernisierung).trim() !== '') {
    if (score >= 5) minAnteil = 0.65;
    else if (score >= 4) minAnteil = 0.50;
    else if (score >= 3) minAnteil = 0.35;
    else return restnutzungsdauer;
  } else if (m.includes('kernsanierung') || m.includes('neuwertig')) {
    minAnteil = 0.65;
  } else if (m.includes('umfassend') || m.includes('vollständig') || m.includes('vollsaniert')) {
    minAnteil = 0.50;
  } else if (m.includes('teilweise') || m.includes('teilsaniert')) {
    minAnteil = 0.35;
  } else {
    return restnutzungsdauer;
  }

  const minRND = Math.round(gesamtnutzungsdauer * minAnteil);
  return Math.max(restnutzungsdauer, minRND);
}

// ─── Hauptfunktion ───────────────────────────────────────────────────────────

/**
 * Berechnet den Gebäude-Herstellungswert nach NHK 2010.
 *
 * Formel: Gebäudewert = NHK_2010 × BGF × (BPI_aktuell / BPI_2010) × (RND / GND)
 *
 * @param wohnflaeche - Wohnfläche in m²
 * @param baujahr - Baujahr (null → Default 30 Jahre Alter)
 * @param objektunterart - Objekttyp-String (null → EFH)
 * @param ausstattung - Ausstattungsniveau (Score 1–5 oder Text)
 * @param modernisierung - Modernisierungsgrad (Score 1–5 oder Text)
 * @param istHaus - true = Haus, false = Wohnung (Default: true)
 */
export function calcGebaeudewertNHK(
  wohnflaeche: number,
  baujahr: number | null,
  objektunterart: string | null,
  ausstattung: string | null,
  modernisierung: string | null,
  istHaus: boolean = true,
): NHKResult {
  const hinweise: string[] = [];

  // 1. Gebäudetyp + Standardstufe bestimmen
  const typ = mapObjektunterart(objektunterart, istHaus);
  const stufe = mapAusstattung(ausstattung);

  // 2. NHK 2010 Kostenkennwert (EUR/m² BGF)
  const nhk2010 = NHK_2010[typ][stufe];

  // 3. BGF schätzen
  const bgfFaktor = BGF_FAKTOR[typ];
  const bgf = Math.round(wohnflaeche * bgfFaktor);

  // 4. Baupreisindex-Anpassung (2010 → aktuell)
  const bpiFaktor = BAUPREISINDEX_AKTUELL / BAUPREISINDEX_2010;

  // 5. Alterswertminderung (linear)
  const gnd = GESAMTNUTZUNGSDAUER[typ];
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

  // 6. Gebäudewert berechnen
  const herstellungskosten = nhk2010 * bgf * bpiFaktor;
  const gebaeudewert = Math.round(herstellungskosten * alterswertminderung);

  // 7. Hinweise
  if (gebaeudealter > gnd) {
    hinweise.push(
      `Gebäudealter (${gebaeudealter} J.) übersteigt Gesamtnutzungsdauer (${gnd} J.). Gebäudewert auf Restwert reduziert.`,
    );
  }
  if (rnd > basisRND) {
    hinweise.push(
      `Modernisierung verlängert Restnutzungsdauer von ${basisRND} auf ${rnd} Jahre.`,
    );
  }
  hinweise.push(
    `NHK-Berechnung: ${nhk2010} €/m² BGF × ${bgf} m² BGF × ${bpiFaktor.toFixed(2)} (BPI) × ${(alterswertminderung * 100).toFixed(0)}% (RND/GND) = ${gebaeudewert.toLocaleString('de-DE')} € (Stand ${BAUPREISINDEX_STAND}).`,
  );

  return {
    gebaeudewert: Math.max(0, gebaeudewert),
    nhk_2010_pro_qm_bgf: nhk2010,
    bgf_geschaetzt: bgf,
    baupreisindex_faktor: Math.round(bpiFaktor * 100) / 100,
    alterswertminderung: Math.round(alterswertminderung * 100) / 100,
    gesamtnutzungsdauer: gnd,
    restnutzungsdauer: rnd,
    hinweise,
  };
}
