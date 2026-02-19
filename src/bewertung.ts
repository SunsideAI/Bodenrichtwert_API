/**
 * Sachwert-lite Bewertungsmodul.
 *
 * Berechnet Immobilienwerte anhand von:
 *   - Bodenrichtwert (offiziell oder geschätzt)
 *   - ImmoScout-Marktpreise (Stadtdurchschnitt)
 *   - Korrekturfaktoren (Baujahr, Modernisierung, Energie, Ausstattung, Objektunterart)
 *
 * Ersetzt den bisherigen Zapier-JavaScript-Code + LLM "Sophia".
 */

import type { NormalizedBRW } from './adapters/base.js';
import type { ImmoScoutPrices } from './utils/immoscout-scraper.js';
import type { PreisindexEntry } from './utils/bundesbank.js';
import { calcIndexKorrektur } from './utils/bundesbank.js';
import { calcGebaeudewertNHK } from './utils/nhk.js';
import type { NRWImmobilienrichtwert } from './utils/nrw-irw.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface BewertungInput {
  art: string | null;
  grundstuecksflaeche: number | null;
  wohnflaeche: number | null;
  baujahr: number | null;
  objektunterart: string | null;
  modernisierung: string | null;
  energie: string | null;
  ausstattung: string | null;
}

export interface BewertungFaktoren {
  baujahr: number;
  modernisierung: number;
  energie: number;
  ausstattung: number;
  objektunterart: number;
  grundstueck: number;
  neubau: number;
  stichtag_korrektur: number;
  gesamt: number;
}

export interface Bewertung {
  realistischer_qm_preis: number;
  qm_preis_spanne: { min: number; max: number };
  realistischer_immobilienwert: number;
  immobilienwert_spanne: { min: number; max: number };
  bodenwert: number;
  gebaeudewert: number;
  bewertungsmethode: 'sachwert-lite' | 'marktpreis-indikation';
  konfidenz: 'hoch' | 'mittel' | 'gering';
  faktoren: BewertungFaktoren;
  hinweise: string[];
  datenquellen: string[];
}

// ─── Korrekturfaktoren (1:1 aus Zapier-Code) ────────────────────────────────

function calcBaujahrFaktor(baujahr: number | null): number {
  if (baujahr == null) return 0;
  if (baujahr >= 2020) return 0; // Neubau-Faktor übernimmt den Zeitwertbonus
  if (baujahr < 1950) return -0.10;
  if (baujahr <= 1979) return -0.08;
  if (baujahr <= 1999) return -0.04;
  if (baujahr <= 2010) return 0;
  return 0.03;
}

function calcModernisierungFaktor(
  modernisierung: string | null,
  baujahr: number | null,
): number {
  if (!modernisierung) return 0;

  // Numerischer Score: 5=Kernsanierung, 4=Umfassend, 3=Teilweise, 2=Einzelne, 1=Keine
  const score = Number(modernisierung);
  if (!isNaN(score) && String(modernisierung).trim() !== '') {
    const alter = baujahr ?? 2000;
    if (score >= 5) return 0.02;
    if (score >= 4) return 0;
    if (score >= 3) return alter < 1970 ? -0.06 : alter < 1990 ? -0.04 : -0.02;
    if (score >= 2) return alter < 1970 ? -0.10 : alter < 1990 ? -0.08 : -0.05;
    return alter < 1970 ? -0.18 : alter < 1990 ? -0.12 : -0.02;
  }

  const m = modernisierung.toLowerCase();

  if (m.includes('kernsanierung') || m.includes('neuwertig')) return 0.02;
  // Bug-Fix: "umfassend modernisiert" / "vollständig modernisiert" ebenfalls matchen
  if (m.includes('umfassend') || m.includes('vollständig') || m.includes('vollsaniert')) return 0;

  if (m.includes('teilweise') || m.includes('teilsaniert')) {
    if (baujahr && baujahr < 1970) return -0.06;
    if (baujahr && baujahr < 1990) return -0.04;
    return -0.02;
  }

  if (m.includes('nur einzelne') || m.includes('einzelne maßnahmen') || m.includes('einzelne')) {
    if (baujahr && baujahr < 1970) return -0.10;
    if (baujahr && baujahr < 1990) return -0.08;
    return -0.05;
  }

  if (m.includes('keine') || m.includes('unsaniert') || m.includes('unrenoviert')) {
    if (baujahr && baujahr < 1970) return -0.18;
    if (baujahr && baujahr < 1990) return -0.12;
    return -0.02;
  }

  return 0;
}

function calcEnergieFaktor(energie: string | null): number {
  if (!energie) return 0;

  // Numerischer Score: 5=Sehr gut (A+/A), 4=Gut (B), 3=Durchschnittlich (C/D), 2=Eher schlecht (E/F), 1=Sehr schlecht (G/H)
  const score = Number(energie);
  if (!isNaN(score) && String(energie).trim() !== '') {
    if (score >= 5) return 0.03;
    if (score >= 4) return 0;
    if (score >= 3) return -0.01;
    if (score >= 2) return -0.03;
    return -0.06;
  }

  const e = energie.toLowerCase();
  if (e.includes('sehr gut')) return 0.03;
  if (e.includes('gut')) return 0;
  if (e.includes('durchschnittlich')) return -0.01;
  if (e.includes('eher schlecht')) return -0.03;
  if (e.includes('sehr schlecht') || e.includes('schlecht')) return -0.06;
  return 0;
}

function calcAusstattungFaktor(ausstattung: string | null): number {
  if (!ausstattung) return 0;

  // Numerischer Score: 5=Stark gehoben, 4=Gehoben, 3=Mittel, 2=Einfach, 1=Schlecht
  const score = Number(ausstattung);
  if (!isNaN(score) && String(ausstattung).trim() !== '') {
    if (score >= 5) return 0.05;
    if (score >= 4) return 0.03;
    if (score >= 3) return 0;
    if (score >= 2) return -0.03;
    return -0.05;
  }

  const a = ausstattung.toLowerCase();
  if (a.includes('stark gehoben') || a.includes('luxus')) return 0.05;
  if (a.includes('gehoben')) return 0.03;
  if (a.includes('mittel') || a.includes('normal') || a.includes('standard')) return 0;
  if (a.includes('einfach')) return -0.03;
  if (a.includes('schlecht')) return -0.05;
  return 0;
}

function calcObjektunterartFaktor(objektunterart: string | null): number {
  if (!objektunterart) return 0;
  const o = objektunterart.toLowerCase();
  if (o.includes('stadthaus') || o.includes('townhouse')) return 0.05;
  if (o.includes('bungalow')) return 0.02;
  if (o.includes('freistehend')) return 0;
  if (o.includes('zweifamilienhaus') || o === 'zfh') return -0.03;
  if (o.includes('reihenendhaus')) return -0.04;
  if (o.includes('mehrfamilienhaus') || o.includes('mfh')) return -0.04;
  if (o.includes('doppelhaushälfte') || o.includes('doppelhaushalfte') || o === 'dhh') return -0.05;
  if (o.includes('reihenmittelhaus')) return -0.08;
  if (o.includes('bauernhaus') || o.includes('resthof')) return -0.10;
  return 0;
}

function calcNeubauFaktor(baujahr: number | null): number {
  if (baujahr != null && baujahr >= 2020) return 0.10;
  return 0;
}

function calcStichtagKorrektur(
  brw: NormalizedBRW | null,
  preisindex?: PreisindexEntry[] | null,
): number {
  if (!brw?.stichtag) return 0;

  // Versuch 1: Echter Bundesbank-Preisindex
  if (preisindex && preisindex.length > 0) {
    const indexKorrektur = calcIndexKorrektur(brw.stichtag, preisindex);
    if (indexKorrektur !== null) return indexKorrektur;
  }

  // Fallback: Pauschale +2.5%/Jahr nach 2-Jahres-Frist
  const stichtag = new Date(brw.stichtag);
  if (isNaN(stichtag.getTime())) return 0;

  const now = new Date();
  const diffYears = (now.getTime() - stichtag.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  if (diffYears <= 2) return 0;
  return Math.round(diffYears - 2) * 0.025;
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function selectMarktpreis(marktdaten: ImmoScoutPrices | null, istHaus: boolean): number | null {
  if (!marktdaten) return null;
  if (istHaus) {
    return marktdaten.haus_kauf_preis ?? marktdaten.wohnung_kauf_preis;
  }
  return marktdaten.wohnung_kauf_preis ?? marktdaten.haus_kauf_preis;
}

function determineConfidenceAndSpread(
  brw: NormalizedBRW | null,
  methode: 'sachwert-lite' | 'marktpreis-indikation',
): { konfidenz: 'hoch' | 'mittel' | 'gering'; spread: number } {
  // Marktpreis-Indikation: basiert auf Stadtdurchschnitt → inhärente Unsicherheit ±15%
  // BRW-Qualität ist irrelevant, da der BRW nicht in die Berechnung eingeht
  if (methode === 'marktpreis-indikation') {
    return { konfidenz: 'mittel', spread: 0.15 };
  }
  // Sachwert-lite: BRW-Qualität bestimmt die Konfidenz
  if (!brw || brw.wert <= 0) return { konfidenz: 'gering', spread: 0.20 };
  if (brw.schaetzung)         return { konfidenz: 'mittel', spread: 0.15 };
  return                              { konfidenz: 'hoch',   spread: 0.08 };
}

// ─── Hauptfunktion ───────────────────────────────────────────────────────────

export function buildBewertung(
  input: BewertungInput,
  brw: NormalizedBRW | null,
  marktdaten: ImmoScoutPrices | null,
  preisindex?: PreisindexEntry[] | null,
  irw?: NRWImmobilienrichtwert | null,
): Bewertung | null {
  // Gate: Wohnfläche ist Pflicht
  if (!input.wohnflaeche || input.wohnflaeche <= 0) return null;

  // ─── Input-Plausibilitätsprüfung ────────────────────────────────────────────
  const validationHinweise: string[] = [];
  const currentYear = new Date().getFullYear();

  if (input.baujahr != null && (input.baujahr < 1800 || input.baujahr > currentYear + 5)) {
    validationHinweise.push(
      `Baujahr ${input.baujahr} liegt außerhalb des plausiblen Bereichs (1800–${currentYear + 5}). Ergebnis möglicherweise unzuverlässig.`,
    );
  }
  if (input.wohnflaeche < 15) {
    validationHinweise.push(
      `Wohnfläche ${input.wohnflaeche} m² ist ungewöhnlich klein. Ergebnis möglicherweise unzuverlässig.`,
    );
  }
  if (input.wohnflaeche > 2000) {
    validationHinweise.push(
      `Wohnfläche ${input.wohnflaeche} m² ist ungewöhnlich groß. Ergebnis möglicherweise unzuverlässig.`,
    );
  }
  if (input.grundstuecksflaeche != null && input.grundstuecksflaeche > 50000) {
    validationHinweise.push(
      `Grundstücksfläche ${input.grundstuecksflaeche} m² ist ungewöhnlich groß. Ergebnis möglicherweise unzuverlässig.`,
    );
  }

  const istHaus = !input.art?.toLowerCase().includes('wohnung');
  const marktPreisProQm = selectMarktpreis(marktdaten, istHaus);

  // Gate: mindestens eine Datenquelle nötig
  if (!marktPreisProQm && (!brw || brw.wert <= 0)) return null;

  // Faktoren berechnen
  const faktoren: BewertungFaktoren = {
    baujahr: calcBaujahrFaktor(input.baujahr),
    modernisierung: calcModernisierungFaktor(input.modernisierung, input.baujahr),
    energie: calcEnergieFaktor(input.energie),
    ausstattung: calcAusstattungFaktor(input.ausstattung),
    objektunterart: calcObjektunterartFaktor(input.objektunterart),
    grundstueck: 0, // In Sachwert-lite über BRW abgedeckt
    neubau: calcNeubauFaktor(input.baujahr),
    stichtag_korrektur: calcStichtagKorrektur(brw, preisindex),
    gesamt: 0, // wird unten berechnet
  };

  // Gesamtfaktor: additiv (wie im Zapier-Code)
  // Hinweis: Overlap-Korrektur (Neubau + Modernisierung) folgt nach hinweise-Initialisierung
  faktoren.gesamt =
    faktoren.baujahr +
    faktoren.modernisierung +
    faktoren.energie +
    faktoren.ausstattung +
    faktoren.objektunterart +
    faktoren.neubau +
    faktoren.stichtag_korrektur;

  // Methode bestimmen
  const hasBRW = brw != null && brw.wert > 0;
  const grundflaeche = input.grundstuecksflaeche || 0;
  const bewertungsmethode: 'sachwert-lite' | 'marktpreis-indikation' =
    hasBRW && grundflaeche > 0 ? 'sachwert-lite' : 'marktpreis-indikation';

  let bodenwert = 0;
  let gebaeudewert = 0;
  let realistischerImmobilienwert = 0;
  const hinweise: string[] = [...validationHinweise];
  const datenquellen: string[] = [];

  // Überlapp-Korrektur: Neubau schließt positiven Modernisierungs-Bonus ein
  // (Ein Neubau >= 2020 ist per Definition neuwertig — kein zusätzlicher Kernsanierungs-Bonus)
  if (faktoren.neubau > 0 && faktoren.modernisierung > 0) {
    faktoren.modernisierung = 0;
    faktoren.gesamt =
      faktoren.baujahr +
      faktoren.energie +
      faktoren.ausstattung +
      faktoren.objektunterart +
      faktoren.neubau +
      faktoren.stichtag_korrektur;
    hinweise.push(
      'Neubau-Zuschlag schließt Modernisierungs-Bonus ein. Faktor-Überlapp wurde korrigiert.',
    );
  }

  if (bewertungsmethode === 'sachwert-lite') {
    // ─── Sachwert-lite: BRW + Grundstück + Marktdaten ───
    const brwKorrigiert = brw!.wert * (1 + faktoren.stichtag_korrektur);
    bodenwert = Math.round(brwKorrigiert * grundflaeche);

    if (marktPreisProQm) {
      const marktGesamt = marktPreisProQm * input.wohnflaeche * (1 + faktoren.gesamt);
      gebaeudewert = Math.round(Math.max(0, marktGesamt - bodenwert));
      if (marktGesamt - bodenwert < 0) {
        hinweise.push(
          'Bodenwert übersteigt Marktindikation. Grundstücksanteil dominiert den Gesamtwert.',
        );
      }
      datenquellen.push('BORIS/WFS Bodenrichtwert', 'ImmoScout24 Atlas Marktpreise');
    } else {
      // Kein Marktpreis: Gebäudewert über NHK 2010 berechnen (ImmoWertV Anlage 4)
      const istHaus = !input.art?.toLowerCase().includes('wohnung');
      const nhk = calcGebaeudewertNHK(
        input.wohnflaeche, input.baujahr,
        input.objektunterart, input.ausstattung, input.modernisierung,
        istHaus,
      );
      gebaeudewert = nhk.gebaeudewert;
      datenquellen.push('BORIS/WFS Bodenrichtwert', 'NHK 2010 (ImmoWertV 2022)');
      hinweise.push(...nhk.hinweise);
    }

    realistischerImmobilienwert = bodenwert + gebaeudewert;

    if (faktoren.stichtag_korrektur !== 0) {
      const vorzeichen = faktoren.stichtag_korrektur > 0 ? '+' : '';
      const quelle = preisindex && preisindex.length > 0
        ? 'Bundesbank Wohnimmobilienpreisindex'
        : 'pauschale Schätzung (+2,5%/Jahr)';
      hinweise.push(
        `BRW-Stichtag ${brw!.stichtag}: Marktanpassung ${vorzeichen}${(faktoren.stichtag_korrektur * 100).toFixed(1)}% (${quelle}).`,
      );
      if (preisindex && preisindex.length > 0) {
        datenquellen.push('Bundesbank Wohnimmobilienpreisindex');
      }
    }
  } else {
    // ─── Marktpreis-Indikation: nur ImmoScout-Daten ───
    if (!marktPreisProQm) return null;

    const korrigierterQmPreis = marktPreisProQm * (1 + faktoren.gesamt);
    realistischerImmobilienwert = Math.round(korrigierterQmPreis * input.wohnflaeche);

    if (hasBRW && grundflaeche > 0) {
      bodenwert = Math.round(brw!.wert * grundflaeche);
    }
    gebaeudewert = Math.round(Math.max(0, realistischerImmobilienwert - bodenwert));

    datenquellen.push('ImmoScout24 Atlas Marktpreise');
    if (!hasBRW) {
      hinweise.push('Kein Bodenrichtwert verfügbar. Bewertung basiert ausschließlich auf ImmoScout Marktdaten.');
    }
    if (!grundflaeche) {
      hinweise.push('Grundstücksfläche fehlt. Aufteilung in Boden-/Gebäudewert nicht möglich.');
    }
  }

  // m²-Preis
  const realistischerQmPreis = Math.round(realistischerImmobilienwert / input.wohnflaeche);

  // Konfidenz + Spanne
  const { konfidenz, spread } = determineConfidenceAndSpread(brw, bewertungsmethode);

  const qmPreisSpanne = {
    min: Math.round(realistischerQmPreis * (1 - spread)),
    max: Math.round(realistischerQmPreis * (1 + spread)),
  };
  const immobilienwertSpanne = {
    min: Math.round(realistischerImmobilienwert * (1 - spread)),
    max: Math.round(realistischerImmobilienwert * (1 + spread)),
  };

  // Cross-Validation
  if (marktPreisProQm && hasBRW) {
    const pureMarktWert = marktPreisProQm * input.wohnflaeche;
    const deviation = Math.abs(realistischerImmobilienwert - pureMarktWert) / pureMarktWert;
    if (deviation > 0.25) {
      hinweise.push(
        `Sachwert-Ergebnis weicht ${Math.round(deviation * 100)}% vom reinen Marktpreis ab. Manuelle Prüfung empfohlen.`,
      );
    }
  }

  // IRW Cross-Validation (nur NRW)
  if (irw && input.wohnflaeche > 0) {
    const irwGesamt = irw.irw * input.wohnflaeche;
    const abweichung = Math.abs(realistischerImmobilienwert - irwGesamt) / irwGesamt;
    datenquellen.push('BORIS-NRW Immobilienrichtwerte');
    if (abweichung > 0.25) {
      hinweise.push(
        `Abweichung zum NRW Immobilienrichtwert: ${Math.round(abweichung * 100)}% (IRW: ${irw.irw} €/m², Normobjekt ${irw.teilmarkt}). Manuelle Prüfung empfohlen.`,
      );
    } else {
      hinweise.push(
        `NRW Immobilienrichtwert bestätigt Bewertung (IRW: ${irw.irw} €/m², Abweichung ${Math.round(abweichung * 100)}%, Normobjekt ${irw.teilmarkt}).`,
      );
    }
  }

  // BRW Schätzwert Hinweis
  if (brw?.schaetzung) {
    datenquellen.push('ImmoScout24 Atlas (BRW-Schätzwert)');
    hinweise.push('Bodenrichtwert ist ein Schätzwert (kein offizieller BRW). Genauigkeit eingeschränkt.');
  }

  // Allgemeiner Hinweis zur Marktdaten-Granularität
  if (marktdaten?.stadtteil) {
    hinweise.push(
      `Marktpreise basieren auf Stadtteil-Daten für ${marktdaten.stadtteil} (ImmoScout24 Atlas).`,
    );
  } else {
    hinweise.push(
      'Marktpreise basieren auf Stadtdurchschnitt (ImmoScout24 Atlas). Lage-spezifische Abweichungen möglich.',
    );
  }

  return {
    realistischer_qm_preis: realistischerQmPreis,
    qm_preis_spanne: qmPreisSpanne,
    realistischer_immobilienwert: realistischerImmobilienwert,
    immobilienwert_spanne: immobilienwertSpanne,
    bodenwert,
    gebaeudewert,
    bewertungsmethode,
    konfidenz,
    faktoren,
    hinweise,
    datenquellen: [...new Set(datenquellen)],
  };
}
