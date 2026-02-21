/**
 * Sachwert-lite Bewertungsmodul.
 *
 * Berechnet Immobilienwerte anhand von:
 *   - Bodenrichtwert (offiziell oder geschätzt)
 *   - ImmoScout-Marktpreise (Stadt- oder Stadtteil-Durchschnitt)
 *   - NHK 2010 Gebäudewert (ImmoWertV 2022 Anlage 4, mit MAF nach Anlage 25 BewG)
 *   - Ertragswertverfahren (ImmoWertV §§ 27-34) für MFH/Mietobjekte
 *   - Korrekturfaktoren (Baujahr, Modernisierung, Energie, Ausstattung, Objektunterart)
 *   - Baupreisindex (automatisch via Destatis Genesis API)
 *   - Bundesbank Wohnimmobilienpreisindex (Stichtag-Korrektur)
 *   - BORIS-NRW Immobilienrichtwerte (Cross-Validation)
 *
 * Ersetzt den bisherigen Zapier-JavaScript-Code + LLM "Sophia".
 */
import { calcIndexKorrektur } from './utils/bundesbank.js';
import { calcGebaeudewertNHK } from './utils/nhk.js';
import { calcErtragswert } from './utils/ertragswert.js';
function determineLageCluster(brw, marktPreisProQm) {
    const brwWert = brw?.wert ?? 0;
    const preis = marktPreisProQm ?? 0;
    // A-Lage: Premium-Standorte
    if (brwWert > 300 || preis > 5000)
        return 'A';
    // C-Lage: Strukturschwach / ländlich
    if ((brwWert > 0 && brwWert < 80) || (brwWert === 0 && preis > 0 && preis < 2000))
        return 'C';
    // B-Lage: Standard (Default)
    return 'B';
}
// ─── Korrekturfaktoren (regionalisiert nach Lage-Cluster) ───────────────────
function calcBaujahrFaktor(baujahr, lage = 'B') {
    if (baujahr == null)
        return 0;
    if (baujahr >= 2020)
        return 0; // Neubau-Faktor übernimmt den Zeitwertbonus
    // A-Lage: Altbau-Premium (Gründerzeit-Stuck, hohe Decken — Liebhaberwerte in Top-Lagen)
    // C-Lage: Stärkere Abschläge (Leerstandsrisiko, geringere Nachfrage bei Altbauten)
    if (lage === 'A') {
        if (baujahr < 1950)
            return -0.08; // Altbau-Premium statt -0.20
        if (baujahr <= 1969)
            return -0.06;
        if (baujahr <= 1979)
            return -0.05;
        if (baujahr <= 1994)
            return -0.03;
        if (baujahr <= 2004)
            return -0.02;
        if (baujahr <= 2010)
            return 0;
        return 0.03;
    }
    if (lage === 'C') {
        if (baujahr < 1950)
            return -0.25;
        if (baujahr <= 1969)
            return -0.20;
        if (baujahr <= 1979)
            return -0.16;
        if (baujahr <= 1994)
            return -0.10;
        if (baujahr <= 2004)
            return -0.05;
        if (baujahr <= 2010)
            return 0;
        return 0.03;
    }
    // B-Lage: Standard (unverändert)
    if (baujahr < 1950)
        return -0.20;
    if (baujahr <= 1969)
        return -0.15;
    if (baujahr <= 1979)
        return -0.12;
    if (baujahr <= 1994)
        return -0.08;
    if (baujahr <= 2004)
        return -0.04;
    if (baujahr <= 2010)
        return 0;
    return 0.03;
}
function calcModernisierungFaktor(modernisierung, baujahr, lage = 'B') {
    if (!modernisierung)
        return 0;
    // Numerischer Score: 5=Kernsanierung, 4=Umfassend, 3=Teilweise, 2=Einzelne, 1=Keine
    // Kontinuierliche Interpolation statt diskreter Stufen für sanftere Übergänge
    const score = Number(modernisierung);
    if (!isNaN(score) && String(modernisierung).trim() !== '') {
        const alter = baujahr ?? 2000;
        const clampedScore = Math.max(1, Math.min(5, score));
        // Eckpunkte: Score 5 = +0.02, Score 4 = 0, Score 1 = Floor (altersabhängig)
        const ceiling = 0.02; // Score 5: Kernsanierung/Neuwertig
        const neutral = 0; // Score 4: Umfassend modernisiert
        const floor = alter < 1970 ? -0.18 : alter < 1990 ? -0.12 : -0.06;
        let baseFaktor;
        if (clampedScore >= 4) {
            // Score 4–5: linear von 0 bis +0.02
            baseFaktor = neutral + (clampedScore - 4) * (ceiling - neutral);
        }
        else {
            // Score 1–4: linear von floor bis 0
            baseFaktor = floor + ((clampedScore - 1) / 3) * (neutral - floor);
        }
        baseFaktor = Math.round(baseFaktor * 100) / 100;
        return applyLageModernisierung(baseFaktor, lage);
    }
    const m = modernisierung.toLowerCase();
    if (m.includes('kernsanierung') || m.includes('neuwertig'))
        return 0.02;
    // Bug-Fix: "umfassend modernisiert" / "vollständig modernisiert" ebenfalls matchen
    if (m.includes('umfassend') || m.includes('vollständig') || m.includes('vollsaniert'))
        return 0;
    if (m.includes('teilweise') || m.includes('teilsaniert')) {
        const base = (baujahr && baujahr < 1970) ? -0.06 : (baujahr && baujahr < 1990) ? -0.04 : -0.04;
        return applyLageModernisierung(base, lage);
    }
    if (m.includes('nur einzelne') || m.includes('einzelne maßnahmen') || m.includes('einzelne')) {
        const base = (baujahr && baujahr < 1970) ? -0.10 : (baujahr && baujahr < 1990) ? -0.08 : -0.07;
        return applyLageModernisierung(base, lage);
    }
    if (m.includes('keine') || m.includes('unsaniert') || m.includes('unrenoviert')) {
        const base = (baujahr && baujahr < 1970) ? -0.18 : (baujahr && baujahr < 1990) ? -0.12 : -0.06;
        return applyLageModernisierung(base, lage);
    }
    // "mittel" / "normal" / "durchschnittlich" = Zustand durchschnittlich,
    // typisch für ältere Gebäude ohne umfassende Sanierung aber bewohnbar.
    // Entspricht Modernisierungsgrad 2.5–3 auf der Skala.
    if (m.includes('mittel') || m.includes('normal') || m.includes('durchschnittlich')) {
        if (baujahr && baujahr < 1970)
            return applyLageModernisierung(-0.08, lage);
        if (baujahr && baujahr < 1990)
            return applyLageModernisierung(-0.05, lage);
        return applyLageModernisierung(-0.02, lage);
    }
    return 0;
}
/**
 * Skaliert negative Modernisierungsfaktoren nach Lage-Cluster.
 * A-Lage: 30% milder (Premium-Standorte halten Wert trotz weniger Modernisierung)
 * C-Lage: 30% strenger (schwache Märkte bestrafen fehlende Modernisierung stärker)
 */
function applyLageModernisierung(baseFaktor, lage) {
    if (baseFaktor >= 0)
        return baseFaktor; // Positive Faktoren nicht skalieren
    if (lage === 'A')
        return Math.round(baseFaktor * 0.7 * 100) / 100;
    if (lage === 'C')
        return Math.round(baseFaktor * 1.3 * 100) / 100;
    return baseFaktor;
}
function calcEnergieFaktor(energie) {
    if (!energie)
        return 0;
    // Numerischer Score: 5=Sehr gut (A+/A), 4=Gut (B), 3=Durchschnittlich (C/D), 2=Eher schlecht (E/F), 1=Sehr schlecht (G/H)
    const score = Number(energie);
    if (!isNaN(score) && String(energie).trim() !== '') {
        if (score >= 5)
            return 0.03;
        if (score >= 4)
            return 0;
        if (score >= 3)
            return -0.01;
        if (score >= 2)
            return -0.03;
        return -0.06;
    }
    const e = energie.toLowerCase();
    if (e.includes('sehr gut'))
        return 0.03;
    if (e.includes('gut'))
        return 0;
    if (e.includes('durchschnittlich'))
        return -0.01;
    if (e.includes('eher schlecht'))
        return -0.03;
    if (e.includes('sehr schlecht') || e.includes('schlecht'))
        return -0.06;
    return 0;
}
function calcAusstattungFaktor(ausstattung) {
    if (!ausstattung)
        return 0;
    // Numerischer Score: 5=Stark gehoben, 4=Gehoben, 3=Mittel, 2=Einfach, 1=Schlecht
    const score = Number(ausstattung);
    if (!isNaN(score) && String(ausstattung).trim() !== '') {
        if (score >= 5)
            return 0.05;
        if (score >= 4)
            return 0.03;
        if (score >= 3)
            return 0;
        if (score >= 2)
            return -0.03;
        return -0.05;
    }
    const a = ausstattung.toLowerCase();
    if (a.includes('stark gehoben') || a.includes('luxus'))
        return 0.05;
    if (a.includes('gehoben'))
        return 0.03;
    if (a.includes('mittel') || a.includes('normal') || a.includes('standard'))
        return 0;
    if (a.includes('einfach'))
        return -0.03;
    if (a.includes('schlecht'))
        return -0.05;
    return 0;
}
function calcObjektunterartFaktor(objektunterart) {
    if (!objektunterart)
        return 0;
    const o = objektunterart.toLowerCase();
    if (o.includes('stadthaus') || o.includes('townhouse'))
        return 0.05;
    if (o.includes('bungalow'))
        return 0.02;
    if (o.includes('freistehend'))
        return 0;
    if (o.includes('zweifamilienhaus') || o === 'zfh')
        return -0.03;
    if (o.includes('reihenendhaus'))
        return -0.04;
    if (o.includes('mehrfamilienhaus') || o.includes('mfh'))
        return -0.04;
    if (o.includes('doppelhaushälfte') || o.includes('doppelhaushalfte') || o === 'dhh')
        return -0.05;
    if (o.includes('reihenmittelhaus'))
        return -0.08;
    if (o.includes('bauernhaus') || o.includes('resthof'))
        return -0.10;
    return 0;
}
function calcNeubauFaktor(baujahr) {
    if (baujahr != null && baujahr >= 2020)
        return 0.10;
    return 0;
}
function calcStichtagKorrektur(brw, preisindex) {
    if (!brw?.stichtag)
        return 0;
    // Versuch 1: Echter Bundesbank-Preisindex
    if (preisindex && preisindex.length > 0) {
        const indexKorrektur = calcIndexKorrektur(brw.stichtag, preisindex);
        if (indexKorrektur !== null)
            return indexKorrektur;
    }
    // Fallback: Pauschale +2.5%/Jahr nach 2-Jahres-Frist
    const stichtag = new Date(brw.stichtag);
    if (isNaN(stichtag.getTime()))
        return 0;
    const now = new Date();
    const diffYears = (now.getTime() - stichtag.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (diffYears <= 2)
        return 0;
    return Math.round(diffYears - 2) * 0.025;
}
// ─── Angebotspreis → Kaufpreis Korrektur ─────────────────────────────────────
/**
 * ImmoScout24-Daten sind Angebotspreise (Listing-Preise), keine Kaufpreise.
 * Empirisch liegt der Angebots-Kaufpreis-Abschlag bei 5–15 % je nach Markt
 * (vgl. empirica Preisdatenbank, Sprengnetter Marktwertmodell).
 *
 * Regionalisiert nach Lage-Cluster + dynamisch nach Marktzyklus:
 *   A-Lage (Verkäufermarkt): ~7% Abschlag (Käufer bieten nahe am Angebotspreis)
 *   B-Lage (ausgeglichen):   ~10% Abschlag (Standard)
 *   C-Lage (Käufermarkt):    ~13% Abschlag (mehr Verhandlungsspielraum)
 *
 * Marktzyklus-Anpassung via Bundesbank-Preisindex (YoY-Veränderung):
 *   Steigender Markt → Abschlag reduzieren (Verkäufermarkt: Preise nahe Angebot)
 *   Fallender Markt → Abschlag erhöhen (Käufermarkt: mehr Verhandlung)
 */
function calcAngebotspreisAbschlag(lage, preisindex) {
    const baseAbschlag = lage === 'A' ? 0.07 : lage === 'C' ? 0.13 : 0.10;
    // Marktzyklus-Anpassung: YoY-Trend aus Preisindex ableiten
    if (preisindex && preisindex.length >= 5) {
        const latest = preisindex[preisindex.length - 1];
        // Suche Eintrag ~4 Quartale zurück (YoY-Vergleich)
        const oneYearAgo = preisindex.length >= 5 ? preisindex[preisindex.length - 5] : null;
        if (oneYearAgo && latest.index > 0 && oneYearAgo.index > 0) {
            const yoyChange = (latest.index - oneYearAgo.index) / oneYearAgo.index;
            // Steigender Markt (yoyChange > 0): Abschlag senken; Fallender Markt: erhöhen
            // 50% des YoY-Signals als Anpassung, Clamp auf [3%, 18%]
            const adjustment = -yoyChange * 0.5;
            const adjustedAbschlag = Math.max(0.03, Math.min(0.18, baseAbschlag + adjustment));
            return 1 - adjustedAbschlag;
        }
    }
    return 1 - baseAbschlag;
}
// ─── Fallback-Konstanten ─────────────────────────────────────────────────────
/** Bundesdurchschnitt qm-Preise (konservativ, Stand 2024/2025) */
const NATIONAL_AVG_QM_PREIS = { haus: 2200, wohnung: 2800 };
/**
 * Landesweite Durchschnittspreise €/m² (Stand 2024/2025).
 * Quellen: Destatis, empirica Preisdatenbank, ImmoScout24 Atlas.
 * Wird als besserer Fallback statt Bundesdurchschnitt verwendet.
 */
const STATE_AVG_QM_PREIS = {
    'Baden-Württemberg': { haus: 3200, wohnung: 3800 },
    'Bayern': { haus: 3400, wohnung: 4200 },
    'Berlin': { haus: 3800, wohnung: 4500 },
    'Brandenburg': { haus: 2000, wohnung: 2400 },
    'Bremen': { haus: 2200, wohnung: 2600 },
    'Hamburg': { haus: 4200, wohnung: 5000 },
    'Hessen': { haus: 2800, wohnung: 3200 },
    'Mecklenburg-Vorpommern': { haus: 1800, wohnung: 2200 },
    'Niedersachsen': { haus: 2000, wohnung: 2400 },
    'Nordrhein-Westfalen': { haus: 2200, wohnung: 2600 },
    'Rheinland-Pfalz': { haus: 2000, wohnung: 2400 },
    'Saarland': { haus: 1600, wohnung: 2000 },
    'Sachsen': { haus: 2000, wohnung: 2200 },
    'Sachsen-Anhalt': { haus: 1400, wohnung: 1800 },
    'Schleswig-Holstein': { haus: 2400, wohnung: 2800 },
    'Thüringen': { haus: 1600, wohnung: 2000 },
};
/** Typische Wohnflächen nach Immobilienart (m²) */
const DEFAULT_WOHNFLAECHE = {
    efh: 130, zfh: 160, mfh: 300, etw: 75, dhh: 120, rmh: 110, reh: 115,
};
/**
 * Schätzt die Wohnfläche wenn nicht angegeben.
 * Priorität: grundfläche-basiert > art-basiert > pauschaler Default.
 */
function estimateWohnflaeche(input) {
    const istHaus = !input.art?.toLowerCase().includes('wohnung');
    // Aus Grundstücksfläche ableiten
    if (input.grundstuecksflaeche && input.grundstuecksflaeche > 0) {
        const faktor = istHaus ? 0.4 : 0.8;
        const wf = Math.round(input.grundstuecksflaeche * faktor);
        return {
            wohnflaeche: Math.max(wf, 30),
            hinweis: `Wohnfläche geschätzt (${wf} m² aus Grundstücksfläche × ${faktor}). Bitte exakte Wohnfläche angeben für präzisere Bewertung.`,
        };
    }
    // Aus Objektunterart / Art ableiten
    const art = (input.art ?? '').toLowerCase();
    const o = (input.objektunterart ?? '').toLowerCase();
    let key = 'efh'; // Default
    if (art.includes('wohnung') || o.includes('etw') || o.includes('eigentum'))
        key = 'etw';
    else if (o.includes('mehrfamilien') || o.includes('mfh'))
        key = 'mfh';
    else if (o.includes('zweifamilien') || o.includes('zfh'))
        key = 'zfh';
    else if (o.includes('doppelhaush') || o.includes('dhh'))
        key = 'dhh';
    else if (o.includes('reihenmittel') || o.includes('rmh'))
        key = 'rmh';
    else if (o.includes('reihenend') || o.includes('reh'))
        key = 'reh';
    const wf = DEFAULT_WOHNFLAECHE[key] ?? 120;
    return {
        wohnflaeche: wf,
        hinweis: `Wohnfläche geschätzt (${wf} m² basierend auf Immobilientyp). Bitte exakte Wohnfläche angeben für präzisere Bewertung.`,
    };
}
/**
 * Schätzt die Grundstücksfläche wenn nicht angegeben.
 * Häuser: Wohnfläche × 3, Wohnungen: Wohnfläche × 0.5 (Miteigentumsanteil).
 */
function estimateGrundstuecksflaeche(wohnflaeche, istHaus) {
    const faktor = istHaus ? 3 : 0.5;
    const gf = Math.round(wohnflaeche * faktor);
    return {
        grundflaeche: Math.max(gf, 50),
        hinweis: `Grundstücksfläche geschätzt (${gf} m² aus Wohnfläche × ${faktor}). Bitte exakte Grundstücksfläche angeben.`,
    };
}
// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────
function selectMarktpreis(marktdaten, istHaus) {
    if (!marktdaten)
        return null;
    if (istHaus) {
        return marktdaten.haus_kauf_preis ?? marktdaten.wohnung_kauf_preis;
    }
    return marktdaten.wohnung_kauf_preis ?? marktdaten.haus_kauf_preis;
}
function selectMarktpreisMin(marktdaten, istHaus) {
    if (!marktdaten)
        return null;
    if (istHaus) {
        return marktdaten.haus_kauf_min ?? marktdaten.wohnung_kauf_min;
    }
    return marktdaten.wohnung_kauf_min ?? marktdaten.haus_kauf_min;
}
function selectMarktpreisMax(marktdaten, istHaus) {
    if (!marktdaten)
        return null;
    if (istHaus) {
        return marktdaten.haus_kauf_max ?? marktdaten.wohnung_kauf_max;
    }
    return marktdaten.wohnung_kauf_max ?? marktdaten.haus_kauf_max;
}
/**
 * Berechnet den faktor-adjustierten €/m²-Preis mittels Min/Max-Interpolation.
 * Statt `median * (1 + faktoren)` wird die Position im [min, max]-Bereich
 * anhand der Faktorsumme bestimmt (ImmoWertV § 15 Vergleichswertverfahren).
 *
 * SCALE = 0.15: Bei Faktorsumme ±0.15 → voll bei min/max.
 *
 * Angebotspreis-Abschlag: ImmoScout-Daten sind Listing-Preise. Echte Kaufpreise
 * liegen ca. 10 % darunter (empirica / Sprengnetter).
 *
 * Extrapolation: Bei Faktoren jenseits SCALE darf der Preis sanft unter min
 * sinken (30 % der normalen Steigung), da reale Transaktionspreise unter dem
 * günstigsten Listing liegen können (ältere/schlechtere Objekte).
 */
function calcAdjustedQmPreis(median, min, max, faktorenGesamt, angebotspreisAbschlag = 0.90) {
    const SCALE = 0.15;
    // Angebotspreis → geschätzter Kaufpreis
    const adjMedian = median * angebotspreisAbschlag;
    const adjMin = min != null ? min * angebotspreisAbschlag : null;
    const adjMax = max != null ? max * angebotspreisAbschlag : null;
    if (adjMin != null && adjMax != null && adjMin < adjMedian && adjMax > adjMedian) {
        // Wide-spread detection: Wenn der Min/Max-Bereich >120% des Medians ist,
        // stammen die Daten aus einer breiten IS24-Suche (VVG/Landkreis-Level).
        // Min/Max sind dann nicht für einzelne Objekte repräsentativ.
        const rangeWidth = (adjMax - adjMin) / adjMedian;
        if (rangeWidth > 1.2) {
            return Math.max(adjMedian * (1 + faktorenGesamt), adjMedian * 0.25);
        }
        const tRaw = faktorenGesamt / SCALE; // unbounded
        const t = Math.max(-1, Math.min(1, tRaw));
        let price;
        if (t < 0) {
            price = adjMedian - Math.abs(t) * (adjMedian - adjMin);
        }
        else {
            price = adjMedian + t * (adjMax - adjMedian);
        }
        // Sanfte Extrapolation unter min (30 % Steigung) für stark negative Faktoren
        if (tRaw < -1) {
            const extraT = Math.abs(tRaw) - 1; // positiver Überschuss
            const extraSlope = 0.30; // gedämpfte Steigung jenseits min
            price -= extraT * extraSlope * (adjMedian - adjMin);
        }
        return Math.max(price, adjMedian * 0.25); // Untergrenze: 25 % des Medians
    }
    // Fallback: kein min/max (z.B. Atlas-Daten) → klassische Prozent-Methode + Abschlag
    return adjMedian * (1 + faktorenGesamt);
}
function selectMietpreis(marktdaten, istHaus) {
    if (!marktdaten)
        return null;
    if (istHaus) {
        return marktdaten.haus_miete_preis ?? marktdaten.wohnung_miete_preis;
    }
    return marktdaten.wohnung_miete_preis ?? marktdaten.haus_miete_preis;
}
/**
 * Bestimmt den Gebäudetyp für das Ertragswertverfahren.
 */
function mapToErtragswertTyp(art, objektunterart) {
    const a = (art ?? '').toLowerCase();
    const o = (objektunterart ?? '').toLowerCase();
    if (a.includes('wohnung') || o.includes('etw') || o.includes('eigentum'))
        return 'etw';
    if (o.includes('mehrfamilien') || o.includes('mfh'))
        return 'mfh';
    if (o.includes('zweifamilien') || o.includes('zfh'))
        return 'zfh';
    return 'efh';
}
function determineConfidenceAndSpread(brw, methode, hasErtragswert) {
    // Marktpreis-Indikation: basiert auf Stadtdurchschnitt → inhärente Unsicherheit ±15%
    if (methode === 'marktpreis-indikation') {
        return { konfidenz: 'mittel', spread: 0.15 };
    }
    // Vergleichswertverfahren (ImmoWertV § 15): direkte Marktpreise für ETW/Wohnungen
    if (methode === 'vergleichswert') {
        if (brw?.schaetzung)
            return { konfidenz: 'mittel', spread: 0.12 };
        if (hasErtragswert)
            return { konfidenz: 'hoch', spread: 0.06 };
        return { konfidenz: 'hoch', spread: 0.10 };
    }
    // Sachwert-lite: BRW-Qualität bestimmt die Konfidenz
    if (!brw || brw.wert <= 0)
        return { konfidenz: 'gering', spread: 0.20 };
    if (brw.schaetzung)
        return { konfidenz: 'mittel', spread: 0.15 };
    // Ertragswert als Cross-Validation erhöht die Konfidenz weiter
    if (hasErtragswert)
        return { konfidenz: 'hoch', spread: 0.06 };
    return { konfidenz: 'hoch', spread: 0.08 };
}
// ─── Hauptfunktion ───────────────────────────────────────────────────────────
export function buildBewertung(input, brw, marktdaten, preisindex, irw, baupreisindex, bundesland) {
    // ─── Wohnfläche Fallback ────────────────────────────────────────────────────
    const validationHinweise = [];
    let wohnflaeche = input.wohnflaeche ?? 0;
    let wohnflaecheGeschaetzt = false;
    if (!wohnflaeche || wohnflaeche <= 0) {
        const est = estimateWohnflaeche(input);
        wohnflaeche = est.wohnflaeche;
        wohnflaecheGeschaetzt = true;
        validationHinweise.push(est.hinweis);
    }
    // ─── Input-Plausibilitätsprüfung ────────────────────────────────────────────
    const currentYear = new Date().getFullYear();
    if (input.baujahr != null && (input.baujahr < 1800 || input.baujahr > currentYear + 5)) {
        validationHinweise.push(`Baujahr ${input.baujahr} liegt außerhalb des plausiblen Bereichs (1800–${currentYear + 5}). Ergebnis möglicherweise unzuverlässig.`);
    }
    if (wohnflaeche < 15 && !wohnflaecheGeschaetzt) {
        validationHinweise.push(`Wohnfläche ${wohnflaeche} m² ist ungewöhnlich klein. Ergebnis möglicherweise unzuverlässig.`);
    }
    if (wohnflaeche > 2000) {
        validationHinweise.push(`Wohnfläche ${wohnflaeche} m² ist ungewöhnlich groß. Ergebnis möglicherweise unzuverlässig.`);
    }
    if (input.grundstuecksflaeche != null && input.grundstuecksflaeche > 50000) {
        validationHinweise.push(`Grundstücksfläche ${input.grundstuecksflaeche} m² ist ungewöhnlich groß. Ergebnis möglicherweise unzuverlässig.`);
    }
    // ─── Immobilientyp erkennen ──────────────────────────────────────────────────
    // istWohnung = ETW, Etagenwohnung, Penthouse usw. — kein eigenes Grundstück
    const art = (input.art ?? '').toLowerCase();
    const uo = (input.objektunterart ?? '').toLowerCase();
    const istWohnung = art.includes('wohnung') ||
        uo.includes('etw') ||
        uo.includes('etagenwohnung') ||
        uo.includes('eigentumswohnung') ||
        uo.includes('erdgeschosswohnung') ||
        uo.includes('dachgeschoss') ||
        uo.includes('penthouse') ||
        uo.includes('maisonette') ||
        uo.includes('loft');
    const istHaus = !istWohnung;
    const marktPreisProQm = selectMarktpreis(marktdaten, istHaus);
    const marktPreisMin = selectMarktpreisMin(marktdaten, istHaus);
    const marktPreisMax = selectMarktpreisMax(marktdaten, istHaus);
    const mietPreisProQm = selectMietpreis(marktdaten, istHaus);
    // ─── Lage-Cluster bestimmen (für regionalisierte Faktoren) ────────────────
    const lageCluster = determineLageCluster(brw, marktPreisProQm);
    const angebotspreisAbschlag = calcAngebotspreisAbschlag(lageCluster, preisindex);
    // ─── Grundfläche: verwende Original oder schätze (NUR für Häuser) ───────────
    let grundflaeche = input.grundstuecksflaeche || 0;
    let grundflaecheGeschaetzt = false;
    // Faktoren berechnen
    const faktoren = {
        baujahr: calcBaujahrFaktor(input.baujahr, lageCluster),
        modernisierung: calcModernisierungFaktor(input.modernisierung, input.baujahr, lageCluster),
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
    // Gesamt-Deckelung: Kein Objekt verliert >30% durch Zustandsmerkmale allein.
    // Extreme Kumulierung (z.B. -16% Alter + -10% Modernisierung + -8% Typ + -3% Energie + -3% Ausstattung = -40%)
    // ist unrealistisch, da sich die Faktoren in der Praxis überlagern (diminishing effects).
    if (faktoren.gesamt < -0.30) {
        faktoren.gesamt = -0.30;
    }
    // Methode bestimmen
    const hasBRW = brw != null && brw.wert > 0;
    // Grundfläche schätzen NUR für Häuser — ETW hat kein eigenes Grundstück
    // (Miteigentumsanteil ist im Vergleichswert enthalten)
    if (!istWohnung && hasBRW && grundflaeche <= 0) {
        const est = estimateGrundstuecksflaeche(wohnflaeche, istHaus);
        grundflaeche = est.grundflaeche;
        grundflaecheGeschaetzt = true;
        validationHinweise.push(est.hinweis);
    }
    // Bewertungsmethode nach Immobilientyp:
    // - Wohnung + Marktpreise → Vergleichswertverfahren (ImmoWertV § 15)
    // - Haus + BRW + Grundfläche → Sachwert-lite (ImmoWertV § 35)
    // - Sonst → Marktpreis-Indikation / Bundesdurchschnitt
    const bewertungsmethode = istWohnung && marktPreisProQm ? 'vergleichswert'
        : !istWohnung && hasBRW && grundflaeche > 0 ? 'sachwert-lite'
            : 'marktpreis-indikation';
    let bodenwert = 0;
    let gebaeudewert = 0;
    let realistischerImmobilienwert = 0;
    let ertragswertErgebnis = null;
    const hinweise = [...validationHinweise];
    const datenquellen = [];
    // Lage-Cluster Info
    if (lageCluster !== 'B') {
        const lageLabel = lageCluster === 'A' ? 'A-Lage (Premium)' : 'C-Lage (ländlich/strukturschwach)';
        hinweise.push(`Lage-Cluster: ${lageLabel}. Korrekturfaktoren und Angebotspreis-Abschlag (${Math.round((1 - angebotspreisAbschlag) * 100)}%) regional angepasst.`);
    }
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
        hinweise.push('Neubau-Zuschlag schließt Modernisierungs-Bonus ein. Faktor-Überlapp wurde korrigiert.');
    }
    if (bewertungsmethode === 'vergleichswert') {
        // ─── Vergleichswertverfahren (ImmoWertV § 15): primäre Methode für ETW/Wohnungen ───
        // Marktwert = Wohnfläche × faktor-adjustierter Vergleichspreis
        // Min/Max-Interpolation: Faktoren positionieren innerhalb der realen Marktspanne
        // Bodenwertanteil ist im Vergleichswert enthalten (kein separater Abzug)
        const adjustedQmPreis = calcAdjustedQmPreis(marktPreisProQm, marktPreisMin, marktPreisMax, faktoren.gesamt, angebotspreisAbschlag);
        const vergleichswert = Math.round(adjustedQmPreis * wohnflaeche);
        // Ertragswert für Wohnungen (Gewichtung 80/20 wenn Mietdaten verfügbar)
        if (mietPreisProQm && mietPreisProQm > 0) {
            // Für Ertragswert: bodenwert-Proxy aus BRW; wenn kein BRW → 25% des Vergleichswerts (typisch ETW)
            const bodenwertProxy = hasBRW
                ? Math.round(brw.wert * (grundflaeche || wohnflaeche * 0.3))
                : Math.round(vergleichswert * 0.25);
            const brwProQmProxy = hasBRW ? brw.wert : 0;
            const ertragswertResult = calcErtragswert({
                wohnflaeche,
                mietpreisProQm: mietPreisProQm,
                bodenwert: bodenwertProxy,
                brwProQm: brwProQmProxy,
                baujahr: input.baujahr,
                gebaeudTyp: mapToErtragswertTyp(input.art, input.objektunterart),
                bundesland,
            });
            if (ertragswertResult && ertragswertResult.ertragswert > 0) {
                ertragswertErgebnis = ertragswertResult.ertragswert;
                // Gewichtete Kombination: 80% Vergleichswert + 20% Ertragswert
                realistischerImmobilienwert = Math.round(vergleichswert * 0.8 + ertragswertErgebnis * 0.2);
                datenquellen.push('Vergleichswertverfahren (ImmoWertV § 15)', 'ImmoScout24 Atlas Marktpreise', 'Ertragswertverfahren (ImmoWertV §§ 27-34)');
                hinweise.push(`Vergleichswert (${vergleichswert.toLocaleString('de-DE')} €) gewichtet mit Ertragswert ${ertragswertErgebnis.toLocaleString('de-DE')} € (80/20, LiZi ${(ertragswertResult.liegenschaftszins * 100).toFixed(1)}%).`);
            }
            else {
                realistischerImmobilienwert = vergleichswert;
                datenquellen.push('Vergleichswertverfahren (ImmoWertV § 15)', 'ImmoScout24 Atlas Marktpreise');
            }
        }
        else {
            realistischerImmobilienwert = vergleichswert;
            datenquellen.push('Vergleichswertverfahren (ImmoWertV § 15)', 'ImmoScout24 Atlas Marktpreise');
        }
        // Bodenwert: informativer Miteigentumsanteil-Anteil, nicht vom Marktwert subtrahiert
        bodenwert = hasBRW ? Math.round(brw.wert * (grundflaeche || wohnflaeche * 0.3)) : 0;
        gebaeudewert = Math.max(0, realistischerImmobilienwert - bodenwert);
        hinweise.push('Wohnung: Bodenwertanteil im Vergleichswert enthalten (Vergleichswertverfahren, ImmoWertV § 15).');
        if (hasBRW && faktoren.stichtag_korrektur !== 0) {
            hinweise.push(`BRW-Stichtag ${brw.stichtag} (informativer Wert, nicht in Vergleichswert eingerechnet).`);
        }
        if (hasBRW)
            datenquellen.push('BORIS/WFS Bodenrichtwert');
    }
    else if (bewertungsmethode === 'sachwert-lite') {
        // ─── Sachwert-lite: BRW + NHK + Marktdaten-Blend (für Häuser) ───
        //
        // Kernprinzip: NHK (Sachwertverfahren, ImmoWertV § 35) IMMER berechnen.
        // IS24-Marktdaten dienen als Kalibrierung, gewichtet nach Datengranularität.
        //
        // Gewichtung IS24 vs NHK:
        //   Stadtteil-Daten (hohe Auflösung):    60% IS24 / 40% NHK
        //   Stadt-Daten (Durchschnitt):           40% IS24 / 60% NHK
        //   Kein IS24 / VVG/Landkreis-Daten:      0% IS24 / 100% NHK
        //   Bei starker Divergenz (>40%): NHK-Gewicht +10pp (max 80%)
        const brwKorrigiert = brw.wert * (1 + faktoren.stichtag_korrektur);
        bodenwert = Math.round(brwKorrigiert * grundflaeche);
        // NHK IMMER berechnen (Sachwertverfahren ist primäre Methode für EFH lt. ImmoWertV)
        const externalBpi = baupreisindex ? {
            aktuell: baupreisindex.aktuell,
            basis_2010: baupreisindex.basis_2010,
            stand: baupreisindex.stand,
            quelle: baupreisindex.quelle,
        } : null;
        const nhk = calcGebaeudewertNHK(wohnflaeche, input.baujahr, input.objektunterart, input.ausstattung, input.modernisierung, istHaus, brw.wert, externalBpi, bundesland);
        const nhkSachwert = bodenwert + nhk.gebaeudewert;
        datenquellen.push('BORIS/WFS Bodenrichtwert', 'NHK 2010 (ImmoWertV 2022)');
        if (baupreisindex?.quelle === 'Destatis Genesis 61261-0002') {
            datenquellen.push('Destatis Baupreisindex');
        }
        if (marktPreisProQm) {
            // IS24-basierten Vergleichswert berechnen
            const adjustedQmPreisSachwert = calcAdjustedQmPreis(marktPreisProQm, marktPreisMin, marktPreisMax, faktoren.gesamt, angebotspreisAbschlag);
            const is24Gesamtwert = Math.round(adjustedQmPreisSachwert * wohnflaeche);
            // Gewichtung nach Datengranularität
            const hatStadtteil = !!marktdaten?.stadtteil;
            let nhkWeight = hatStadtteil ? 0.40 : 0.60;
            // Baujahr-basierte Anpassung: NHK ist weniger zuverlässig bei Altbauten und Neubauten
            const baujahr = input.baujahr;
            if (baujahr != null) {
                if (baujahr < 1970) {
                    // Altbauten: NHK unterschätzt systematisch (andere Bauweise, lineare AWM zu aggressiv)
                    nhkWeight = Math.max(0.25, nhkWeight - 0.10);
                }
                else if (baujahr > 2015) {
                    // Neubauten: NHK × hoher BPI-Faktor kann überschätzen
                    nhkWeight = Math.max(0.30, nhkWeight - 0.05);
                }
            }
            // Divergenz-Prüfung: Richtung + Datengranularität beachten
            const divergenz = Math.abs(nhkSachwert - is24Gesamtwert) / Math.max(nhkSachwert, is24Gesamtwert);
            if (divergenz > 0.40) {
                if (nhkSachwert > is24Gesamtwert) {
                    // NHK höher als IS24 → eher konservativ, NHK mehr gewichten
                    nhkWeight = Math.min(0.80, nhkWeight + 0.10);
                }
                else if (hatStadtteil) {
                    // NHK niedriger als IS24 + Stadtteil-Daten (hohe Präzision) → IS24 mehr vertrauen
                    nhkWeight = Math.max(0.25, nhkWeight - 0.10);
                }
                else {
                    // NHK niedriger als IS24 + nur Stadt-Durchschnitt → NHK trotzdem stärken
                    // (Stadt-Durchschnitt kann teures Zentrum vs. günstigen Vorort nicht unterscheiden)
                    nhkWeight = Math.min(0.80, nhkWeight + 0.10);
                }
                hinweise.push(`IS24-Marktpreis (${is24Gesamtwert.toLocaleString('de-DE')} €) weicht ${Math.round(divergenz * 100)}% vom NHK-Sachwert (${nhkSachwert.toLocaleString('de-DE')} €) ab. NHK-Gewichtung erhöht.`);
            }
            // Blend
            realistischerImmobilienwert = Math.round(is24Gesamtwert * (1 - nhkWeight) + nhkSachwert * nhkWeight);
            gebaeudewert = Math.round(Math.max(0, realistischerImmobilienwert - bodenwert));
            datenquellen.push('ImmoScout24 Atlas Marktpreise');
            hinweise.push(`Sachwert-Blend: ${Math.round(nhkWeight * 100)}% NHK (${nhkSachwert.toLocaleString('de-DE')} €) / ${Math.round((1 - nhkWeight) * 100)}% Markt (${is24Gesamtwert.toLocaleString('de-DE')} €)${hatStadtteil ? ' [Stadtteil-Daten]' : ' [Stadt-Durchschnitt]'}.`);
            if (is24Gesamtwert - bodenwert < 0) {
                hinweise.push('Bodenwert übersteigt Marktindikation. Grundstücksanteil dominiert den Gesamtwert.');
            }
        }
        else {
            // Kein Marktpreis: NHK-Sachwert verwenden, mit Landesdurchschnitt als Cross-Check
            gebaeudewert = nhk.gebaeudewert;
            realistischerImmobilienwert = nhkSachwert;
            hinweise.push(...nhk.hinweise);
            // Landesdurchschnitt als schwaches Kalibrierungssignal (30% Gewicht)
            // NHK allein tendiert zur Unterschätzung, da NHK 2010-Basiswerte konservativ sind.
            if (bundesland && wohnflaeche > 0) {
                const stateAvg = STATE_AVG_QM_PREIS[bundesland];
                if (stateAvg) {
                    const ref = istHaus ? stateAvg.haus : stateAvg.wohnung;
                    const stateRefWert = ref * wohnflaeche * (1 + faktoren.gesamt);
                    if (stateRefWert > nhkSachwert * 1.10) {
                        // NHK deutlich unter Landesdurchschnitt: 70% NHK / 30% Landesdurchschnitt
                        realistischerImmobilienwert = Math.round(nhkSachwert * 0.70 + stateRefWert * 0.30);
                        gebaeudewert = Math.max(0, realistischerImmobilienwert - bodenwert);
                        datenquellen.push(`Landesdurchschnitt ${bundesland}`);
                        hinweise.push(`NHK-Sachwert (${nhkSachwert.toLocaleString('de-DE')} €) liegt unter Landesdurchschnitt. Blend: 70% NHK / 30% Landesdurchschnitt (${Math.round(stateRefWert).toLocaleString('de-DE')} €).`);
                    }
                }
            }
        }
        if (faktoren.stichtag_korrektur !== 0) {
            const vorzeichen = faktoren.stichtag_korrektur > 0 ? '+' : '';
            const quelle = preisindex && preisindex.length > 0
                ? 'Bundesbank Wohnimmobilienpreisindex'
                : 'pauschale Schätzung (+2,5%/Jahr)';
            hinweise.push(`BRW-Stichtag ${brw.stichtag}: Marktanpassung ${vorzeichen}${(faktoren.stichtag_korrektur * 100).toFixed(1)}% (${quelle}).`);
            if (preisindex && preisindex.length > 0) {
                datenquellen.push('Bundesbank Wohnimmobilienpreisindex');
            }
        }
        if (grundflaecheGeschaetzt) {
            hinweise.push('Grundstücksfläche wurde geschätzt. Bitte exakte Grundstücksfläche für präzisere Bewertung angeben.');
        }
        // Ertragswert als Cross-Validation für Häuser (MFH)
        if (mietPreisProQm && mietPreisProQm > 0 && bodenwert > 0 && hasBRW) {
            const ertragswertResult = calcErtragswert({
                wohnflaeche,
                mietpreisProQm: mietPreisProQm,
                bodenwert,
                brwProQm: brw.wert,
                baujahr: input.baujahr,
                gebaeudTyp: mapToErtragswertTyp(input.art, input.objektunterart),
                bundesland,
            });
            if (ertragswertResult && ertragswertResult.ertragswert > 0) {
                ertragswertErgebnis = ertragswertResult.ertragswert;
                datenquellen.push('Ertragswertverfahren (ImmoWertV §§ 27-34)');
                const abweichung = Math.abs(realistischerImmobilienwert - ertragswertResult.ertragswert)
                    / ertragswertResult.ertragswert;
                if (abweichung > 0.30) {
                    hinweise.push(`Ertragswert (${ertragswertResult.ertragswert.toLocaleString('de-DE')} €) weicht ${Math.round(abweichung * 100)}% vom Sachwert ab. Ertragswert-Details: Rohertrag ${ertragswertResult.jahresrohertrag.toLocaleString('de-DE')} €/J., Liegenschaftszins ${(ertragswertResult.liegenschaftszins * 100).toFixed(1)}%.`);
                }
                else {
                    hinweise.push(`Ertragswert bestätigt Bewertung: ${ertragswertResult.ertragswert.toLocaleString('de-DE')} € (Abweichung ${Math.round(abweichung * 100)}%, LiZi ${(ertragswertResult.liegenschaftszins * 100).toFixed(1)}%, V=${ertragswertResult.vervielfaeltiger}).`);
                }
            }
        }
    }
    else {
        // ─── Marktpreis-Indikation / Bundesdurchschnitt-Fallback ───
        if (marktPreisProQm) {
            const korrigierterQmPreis = calcAdjustedQmPreis(marktPreisProQm, marktPreisMin, marktPreisMax, faktoren.gesamt, angebotspreisAbschlag);
            realistischerImmobilienwert = Math.round(korrigierterQmPreis * wohnflaeche);
            if (hasBRW && grundflaeche > 0) {
                bodenwert = Math.round(brw.wert * grundflaeche);
            }
            gebaeudewert = Math.round(Math.max(0, realistischerImmobilienwert - bodenwert));
            datenquellen.push('ImmoScout24 Atlas Marktpreise');
            if (!hasBRW) {
                hinweise.push('Kein Bodenrichtwert verfügbar. Bewertung basiert ausschließlich auf ImmoScout Marktdaten.');
            }
            if (!input.grundstuecksflaeche && !istWohnung) {
                hinweise.push('Grundstücksfläche fehlt. Aufteilung in Boden-/Gebäudewert nicht möglich.');
            }
        }
        else {
            // ─── Absoluter Fallback: Landesdurchschnitt → Bundesdurchschnitt ───
            const stateAvg = bundesland ? STATE_AVG_QM_PREIS[bundesland] : null;
            const avgQmPreis = stateAvg
                ? (istHaus ? stateAvg.haus : stateAvg.wohnung)
                : (istHaus ? NATIONAL_AVG_QM_PREIS.haus : NATIONAL_AVG_QM_PREIS.wohnung);
            const korrigierterQmPreis = avgQmPreis * (1 + faktoren.gesamt);
            realistischerImmobilienwert = Math.round(korrigierterQmPreis * wohnflaeche);
            gebaeudewert = realistischerImmobilienwert; // Ohne BRW → alles als Gebäudewert
            datenquellen.push(stateAvg
                ? `Landesdurchschnitt ${bundesland}`
                : 'Bundesdurchschnitt (Statistisches Bundesamt)');
            hinweise.push(stateAvg
                ? `Keine lokalen Marktdaten verfügbar. Bewertung basiert auf Landesdurchschnitt ${bundesland}. Lage-spezifische Abweichungen möglich.`
                : 'Keine lokalen Marktdaten verfügbar. Bewertung basiert auf Bundesdurchschnitt. Abweichungen je nach Lage möglich.');
        }
    }
    // m²-Preis
    const realistischerQmPreis = Math.round(realistischerImmobilienwert / wohnflaeche);
    // Konfidenz + Spanne
    // Geschätzte Inputs → immer "gering" mit breiter Spanne
    let konfidenz;
    let spread;
    // Bundesdurchschnitt-Fallback (kein lokaler Marktpreis) → immer "gering", egal ob BRW vorhanden
    if (wohnflaecheGeschaetzt || (!marktPreisProQm && !hasBRW) || (bewertungsmethode === 'marktpreis-indikation' && !marktPreisProQm)) {
        konfidenz = 'gering';
        spread = 0.25;
    }
    else if (grundflaecheGeschaetzt) {
        konfidenz = 'gering';
        spread = 0.20;
    }
    else if (bewertungsmethode === 'sachwert-lite' && !marktPreisProQm) {
        // NHK ohne IS24-Marktvergleich hat höhere Unsicherheit (~20-30%)
        konfidenz = 'mittel';
        spread = 0.12;
    }
    else {
        const cs = determineConfidenceAndSpread(brw, bewertungsmethode, ertragswertErgebnis != null);
        konfidenz = cs.konfidenz;
        spread = cs.spread;
    }
    const qmPreisSpanne = {
        min: Math.round(realistischerQmPreis * (1 - spread)),
        max: Math.round(realistischerQmPreis * (1 + spread)),
    };
    const immobilienwertSpanne = {
        min: Math.round(realistischerImmobilienwert * (1 - spread)),
        max: Math.round(realistischerImmobilienwert * (1 + spread)),
    };
    // Cross-Validation (Marktpreis ebenfalls um Angebotspreis-Abschlag korrigiert)
    if (marktPreisProQm && hasBRW) {
        const pureMarktWert = marktPreisProQm * angebotspreisAbschlag * wohnflaeche;
        const deviation = Math.abs(realistischerImmobilienwert - pureMarktWert) / pureMarktWert;
        if (deviation > 0.25) {
            hinweise.push(`Sachwert-Ergebnis weicht ${Math.round(deviation * 100)}% vom reinen Marktpreis ab. Manuelle Prüfung empfohlen.`);
        }
    }
    // IRW Cross-Validation (nur NRW)
    if (irw && wohnflaeche > 0) {
        const irwGesamt = irw.irw * wohnflaeche;
        const abweichung = Math.abs(realistischerImmobilienwert - irwGesamt) / irwGesamt;
        datenquellen.push('BORIS-NRW Immobilienrichtwerte');
        if (abweichung > 0.25) {
            hinweise.push(`Abweichung zum NRW Immobilienrichtwert: ${Math.round(abweichung * 100)}% (IRW: ${irw.irw} €/m², Normobjekt ${irw.teilmarkt}). Manuelle Prüfung empfohlen.`);
        }
        else {
            hinweise.push(`NRW Immobilienrichtwert bestätigt Bewertung (IRW: ${irw.irw} €/m², Abweichung ${Math.round(abweichung * 100)}%, Normobjekt ${irw.teilmarkt}).`);
        }
    }
    // BRW Schätzwert Hinweis
    if (brw?.schaetzung) {
        datenquellen.push('ImmoScout24 Atlas (BRW-Schätzwert)');
        hinweise.push('Bodenrichtwert ist ein Schätzwert (kein offizieller BRW). Genauigkeit eingeschränkt.');
    }
    // Allgemeiner Hinweis zur Marktdaten-Granularität
    if (marktdaten?.stadtteil) {
        hinweise.push(`Marktpreise basieren auf Stadtteil-Daten für ${marktdaten.stadtteil} (ImmoScout24 Atlas, ${Math.round((1 - angebotspreisAbschlag) * 100)}% Angebotspreis-Abschlag).`);
    }
    else if (marktdaten) {
        hinweise.push(`Marktpreise basieren auf Stadtdurchschnitt (ImmoScout24 Atlas, ${Math.round((1 - angebotspreisAbschlag) * 100)}% Angebotspreis-Abschlag). Lage-spezifische Abweichungen möglich.`);
    }
    // ─── Plausibilitätsprüfung + Auto-Korrektur ───────────────────────────────
    //
    // Iterative Validierungsschleife: prüft multiple Plausibilitätssignale und
    // korrigiert den Wert automatisch wenn nötig. Maximal 3 Iterationen.
    //
    // Signale:
    //   1. Gebäudewert/m² plausibel? (NHK-Kennwert-Bereich)
    //   2. Ertragswert als Cross-Check (wenn verfügbar)
    //   3. BRW-Bodenwertanteil plausibel? (nicht >70% für EFH, nicht >90% für ETW)
    //   4. Gesamt-qm-Preis im Landesrahmen? (±80% vom Landesdurchschnitt)
    let korrekturAngewandt = false;
    const appliedSignals = new Set();
    for (let iteration = 0; iteration < 3; iteration++) {
        let needsCorrection = false;
        // Signal 1: Gebäudewert/m² im plausiblen Bereich?
        // NHK 2010 Stufe 1-5: ~490-1260 €/m² BGF × BPI ≈ 910-2340 €/m² BGF aktuell
        // → Gebäudewert/m² Wohnfläche: ~650-3200 (mit BGF-Faktor und AWM)
        if (!appliedSignals.has(1) && istHaus && gebaeudewert > 0 && wohnflaeche > 0) {
            const gebWertProQm = gebaeudewert / wohnflaeche;
            const maxPlausibel = 4000; // Stark gehobener Neubau
            if (gebWertProQm > maxPlausibel) {
                const korrektur = maxPlausibel * wohnflaeche;
                hinweise.push(`Plausibilitätskorrektur: Gebäudewert/m² (${Math.round(gebWertProQm)} €) übersteigt Maximum (${maxPlausibel} €/m²). Korrigiert.`);
                gebaeudewert = Math.round(korrektur);
                realistischerImmobilienwert = bodenwert + gebaeudewert;
                appliedSignals.add(1);
                needsCorrection = true;
            }
        }
        // Signal 2: Ertragswert-Abgleich (stärkste Cross-Validation)
        // Wenn Ertragswert verfügbar und Abweichung >25%, graduiert in Richtung Ertragswert korrigieren
        if (!appliedSignals.has(2) && ertragswertErgebnis && ertragswertErgebnis > 0) {
            const ewAbweichung = (realistischerImmobilienwert - ertragswertErgebnis) / ertragswertErgebnis;
            if (Math.abs(ewAbweichung) > 0.25) {
                // Graduierte Korrektur: stärkere Divergenz → stärkerer Pull zum Ertragswert (max 40%)
                const pullStrength = Math.min(0.40, 0.25 + (Math.abs(ewAbweichung) - 0.25) * 0.30);
                const korrigiert = Math.round(realistischerImmobilienwert * (1 - pullStrength) + ertragswertErgebnis * pullStrength);
                hinweise.push(`Plausibilitätskorrektur: Sachwert weicht ${Math.round(ewAbweichung * 100)}% vom Ertragswert ab. Wert um ${Math.round(Math.abs(korrigiert - realistischerImmobilienwert) / 1000)}T€ korrigiert.`);
                realistischerImmobilienwert = korrigiert;
                gebaeudewert = Math.max(0, realistischerImmobilienwert - bodenwert);
                appliedSignals.add(2);
                needsCorrection = true;
            }
        }
        // Signal 3: Bodenwertanteil plausibel?
        if (!appliedSignals.has(3) && istHaus && realistischerImmobilienwert > 0 && bodenwert > 0) {
            const bodenwertAnteil = bodenwert / realistischerImmobilienwert;
            if (bodenwertAnteil > 0.70) {
                // Grundstück dominiert → Gebäudewert zu niedrig oder BRW zu hoch
                // Korrektur: Gesamtwert auf min. Bodenwert × 1.5 anheben (Gebäude hat Wert)
                const minGesamt = Math.round(bodenwert * 1.5);
                if (realistischerImmobilienwert < minGesamt) {
                    hinweise.push(`Plausibilitätskorrektur: Bodenwertanteil (${Math.round(bodenwertAnteil * 100)}%) zu hoch für bebautes Grundstück. Gesamtwert angehoben.`);
                    realistischerImmobilienwert = minGesamt;
                    gebaeudewert = Math.max(0, realistischerImmobilienwert - bodenwert);
                    appliedSignals.add(3);
                    needsCorrection = true;
                }
            }
        }
        // Signal 4: qm-Preis im Landesrahmen?
        // WICHTIG: Der Cap darf den Wert NIE unter den Bodenwert drücken.
        // Bei extrem hohen BRW (z.B. 8500 €/m² in Berlin-Mitte) übersteigt allein der
        // Bodenwert/m² Wohnfläche jeden sinnvollen Wohnpreis-Cap. In solchen Fällen
        // ist der Bodenwert der Mindestpreis — das Gebäude hat zusätzlichen Wert.
        if (!appliedSignals.has(4) && bundesland && realistischerImmobilienwert > 0 && wohnflaeche > 0) {
            const qmAktuell = realistischerImmobilienwert / wohnflaeche;
            const stateAvg = STATE_AVG_QM_PREIS[bundesland];
            if (stateAvg) {
                const ref = istHaus ? stateAvg.haus : stateAvg.wohnung;
                const untergrenze = ref * 0.20; // Absolutes Minimum
                const obergrenze = ref * 3.00; // Absolutes Maximum (Spitzenlagen)
                // Bodenwert-Floor: Gesamtwert darf nie unter Bodenwert + Mindest-Gebäudewert fallen
                const minGebaeudewert = wohnflaeche * 500; // 500 €/m² als absolutes Minimum für ein Gebäude
                const bodenwertFloor = bodenwert > 0 ? bodenwert + minGebaeudewert : 0;
                if (qmAktuell < untergrenze) {
                    const capWert = Math.round(untergrenze * wohnflaeche);
                    realistischerImmobilienwert = Math.max(capWert, bodenwertFloor);
                    gebaeudewert = Math.max(0, realistischerImmobilienwert - bodenwert);
                    hinweise.push(`Plausibilitätskorrektur: qm-Preis (${Math.round(qmAktuell)} €) unter Minimum für ${bundesland}. Auf ${Math.round(realistischerImmobilienwert / wohnflaeche)} €/m² angehoben.`);
                    appliedSignals.add(4);
                    needsCorrection = true;
                }
                else if (qmAktuell > obergrenze) {
                    const capWert = Math.round(obergrenze * wohnflaeche);
                    // Cap NICHT unter Bodenwert drücken
                    realistischerImmobilienwert = Math.max(capWert, bodenwertFloor);
                    gebaeudewert = Math.max(0, realistischerImmobilienwert - bodenwert);
                    if (realistischerImmobilienwert === bodenwertFloor) {
                        hinweise.push(`Plausibilitätskorrektur: qm-Preis (${Math.round(qmAktuell)} €) über Maximum für ${bundesland}, aber Bodenwert (${bodenwert.toLocaleString('de-DE')} €) bildet den Mindestpreis. Gebäudewert auf ${minGebaeudewert.toLocaleString('de-DE')} € geschätzt.`);
                    }
                    else {
                        hinweise.push(`Plausibilitätskorrektur: qm-Preis (${Math.round(qmAktuell)} €) über Maximum für ${bundesland}. Auf ${Math.round(obergrenze)} €/m² reduziert.`);
                    }
                    appliedSignals.add(4);
                    needsCorrection = true;
                }
            }
        }
        if (needsCorrection) {
            korrekturAngewandt = true;
        }
        else {
            break; // Keine weitere Korrektur nötig
        }
    }
    // ─── Finale Invariante: Gesamtwert ≥ Bodenwert + Mindest-Gebäudewert ────
    // Ein bebautes Grundstück kann nie weniger wert sein als das unbebaute.
    if (istHaus && bodenwert > 0 && realistischerImmobilienwert <= bodenwert) {
        const minGebaeude = Math.round(wohnflaeche * 500); // 500 €/m² absolutes Minimum
        realistischerImmobilienwert = bodenwert + minGebaeude;
        gebaeudewert = minGebaeude;
        korrekturAngewandt = true;
        hinweise.push(`Invariante-Korrektur: Gesamtwert (${realistischerImmobilienwert.toLocaleString('de-DE')} €) war unter Bodenwert (${bodenwert.toLocaleString('de-DE')} €). Mindest-Gebäudewert ${minGebaeude.toLocaleString('de-DE')} € addiert.`);
    }
    // Nach Korrekturen: qm-Preis und Spanne neu berechnen
    if (korrekturAngewandt) {
        const newQmPreis = Math.round(realistischerImmobilienwert / wohnflaeche);
        const newSpanne = {
            min: Math.round(realistischerImmobilienwert * (1 - spread)),
            max: Math.round(realistischerImmobilienwert * (1 + spread)),
        };
        datenquellen.push('Plausibilitätsprüfung (Auto-Korrektur)');
        return {
            realistischer_qm_preis: newQmPreis,
            qm_preis_spanne: {
                min: Math.round(newQmPreis * (1 - spread)),
                max: Math.round(newQmPreis * (1 + spread)),
            },
            realistischer_immobilienwert: realistischerImmobilienwert,
            immobilienwert_spanne: newSpanne,
            bodenwert,
            gebaeudewert,
            ertragswert: ertragswertErgebnis,
            bewertungsmethode,
            konfidenz,
            faktoren,
            hinweise,
            datenquellen: [...new Set(datenquellen)],
        };
    }
    return {
        realistischer_qm_preis: realistischerQmPreis,
        qm_preis_spanne: qmPreisSpanne,
        realistischer_immobilienwert: realistischerImmobilienwert,
        immobilienwert_spanne: immobilienwertSpanne,
        bodenwert,
        gebaeudewert,
        ertragswert: ertragswertErgebnis,
        bewertungsmethode,
        konfidenz,
        faktoren,
        hinweise,
        datenquellen: [...new Set(datenquellen)],
    };
}
//# sourceMappingURL=bewertung.js.map