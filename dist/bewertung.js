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
// ─── Korrekturfaktoren (1:1 aus Zapier-Code) ────────────────────────────────
function calcBaujahrFaktor(baujahr) {
    if (baujahr == null)
        return 0;
    if (baujahr >= 2020)
        return 0; // Neubau-Faktor übernimmt den Zeitwertbonus
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
function calcModernisierungFaktor(modernisierung, baujahr) {
    if (!modernisierung)
        return 0;
    // Numerischer Score: 5=Kernsanierung, 4=Umfassend, 3=Teilweise, 2=Einzelne, 1=Keine
    const score = Number(modernisierung);
    if (!isNaN(score) && String(modernisierung).trim() !== '') {
        const alter = baujahr ?? 2000;
        if (score >= 5)
            return 0.02;
        if (score >= 4)
            return 0;
        if (score >= 3)
            return alter < 1970 ? -0.06 : alter < 1990 ? -0.04 : -0.04;
        if (score >= 2)
            return alter < 1970 ? -0.10 : alter < 1990 ? -0.08 : -0.07;
        return alter < 1970 ? -0.18 : alter < 1990 ? -0.12 : -0.06;
    }
    const m = modernisierung.toLowerCase();
    if (m.includes('kernsanierung') || m.includes('neuwertig'))
        return 0.02;
    // Bug-Fix: "umfassend modernisiert" / "vollständig modernisiert" ebenfalls matchen
    if (m.includes('umfassend') || m.includes('vollständig') || m.includes('vollsaniert'))
        return 0;
    if (m.includes('teilweise') || m.includes('teilsaniert')) {
        if (baujahr && baujahr < 1970)
            return -0.06;
        if (baujahr && baujahr < 1990)
            return -0.04;
        return -0.04;
    }
    if (m.includes('nur einzelne') || m.includes('einzelne maßnahmen') || m.includes('einzelne')) {
        if (baujahr && baujahr < 1970)
            return -0.10;
        if (baujahr && baujahr < 1990)
            return -0.08;
        return -0.07;
    }
    if (m.includes('keine') || m.includes('unsaniert') || m.includes('unrenoviert')) {
        if (baujahr && baujahr < 1970)
            return -0.18;
        if (baujahr && baujahr < 1990)
            return -0.12;
        return -0.06;
    }
    // "mittel" / "normal" / "durchschnittlich" = Zustand durchschnittlich,
    // typisch für ältere Gebäude ohne umfassende Sanierung aber bewohnbar.
    // Entspricht Modernisierungsgrad 2.5–3 auf der Skala.
    if (m.includes('mittel') || m.includes('normal') || m.includes('durchschnittlich')) {
        if (baujahr && baujahr < 1970)
            return -0.08;
        if (baujahr && baujahr < 1990)
            return -0.05;
        return -0.02;
    }
    return 0;
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
 * Wir verwenden 10 % als konservativen Mittelwert.
 */
const ANGEBOTSPREIS_ABSCHLAG = 0.90;
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
function calcAdjustedQmPreis(median, min, max, faktorenGesamt) {
    const SCALE = 0.15;
    // Angebotspreis → geschätzter Kaufpreis
    const adjMedian = median * ANGEBOTSPREIS_ABSCHLAG;
    const adjMin = min != null ? min * ANGEBOTSPREIS_ABSCHLAG : null;
    const adjMax = max != null ? max * ANGEBOTSPREIS_ABSCHLAG : null;
    if (adjMin != null && adjMax != null && adjMin < adjMedian && adjMax > adjMedian) {
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
    // ─── Grundfläche: verwende Original oder schätze (NUR für Häuser) ───────────
    let grundflaeche = input.grundstuecksflaeche || 0;
    let grundflaecheGeschaetzt = false;
    // Faktoren berechnen
    const faktoren = {
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
        const adjustedQmPreis = calcAdjustedQmPreis(marktPreisProQm, marktPreisMin, marktPreisMax, faktoren.gesamt);
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
        // ─── Sachwert-lite: BRW + Grundstück + Marktdaten (für Häuser) ───
        const brwKorrigiert = brw.wert * (1 + faktoren.stichtag_korrektur);
        bodenwert = Math.round(brwKorrigiert * grundflaeche);
        if (marktPreisProQm) {
            const adjustedQmPreisSachwert = calcAdjustedQmPreis(marktPreisProQm, marktPreisMin, marktPreisMax, faktoren.gesamt);
            const marktGesamt = adjustedQmPreisSachwert * wohnflaeche;
            gebaeudewert = Math.round(Math.max(0, marktGesamt - bodenwert));
            if (marktGesamt - bodenwert < 0) {
                hinweise.push('Bodenwert übersteigt Marktindikation. Grundstücksanteil dominiert den Gesamtwert.');
            }
            datenquellen.push('BORIS/WFS Bodenrichtwert', 'ImmoScout24 Atlas Marktpreise');
        }
        else {
            // Kein Marktpreis: Gebäudewert über NHK 2010 berechnen (ImmoWertV Anlage 4 + MAF)
            const externalBpi = baupreisindex ? {
                aktuell: baupreisindex.aktuell,
                basis_2010: baupreisindex.basis_2010,
                stand: baupreisindex.stand,
                quelle: baupreisindex.quelle,
            } : null;
            const nhk = calcGebaeudewertNHK(wohnflaeche, input.baujahr, input.objektunterart, input.ausstattung, input.modernisierung, istHaus, brw.wert, externalBpi);
            gebaeudewert = nhk.gebaeudewert;
            datenquellen.push('BORIS/WFS Bodenrichtwert', 'NHK 2010 (ImmoWertV 2022)');
            if (baupreisindex?.quelle === 'Destatis Genesis 61261-0002') {
                datenquellen.push('Destatis Baupreisindex');
            }
            hinweise.push(...nhk.hinweise);
        }
        realistischerImmobilienwert = bodenwert + gebaeudewert;
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
            const korrigierterQmPreis = calcAdjustedQmPreis(marktPreisProQm, marktPreisMin, marktPreisMax, faktoren.gesamt);
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
        const pureMarktWert = marktPreisProQm * ANGEBOTSPREIS_ABSCHLAG * wohnflaeche;
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
        hinweise.push(`Marktpreise basieren auf Stadtteil-Daten für ${marktdaten.stadtteil} (ImmoScout24 Atlas, ${Math.round((1 - ANGEBOTSPREIS_ABSCHLAG) * 100)}% Angebotspreis-Abschlag).`);
    }
    else if (marktdaten) {
        hinweise.push(`Marktpreise basieren auf Stadtdurchschnitt (ImmoScout24 Atlas, ${Math.round((1 - ANGEBOTSPREIS_ABSCHLAG) * 100)}% Angebotspreis-Abschlag). Lage-spezifische Abweichungen möglich.`);
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