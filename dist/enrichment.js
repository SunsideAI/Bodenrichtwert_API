/**
 * Business Logic: Erstindikation berechnen.
 * Prüft Immobilienart, berechnet Erbbauzins-Spannen.
 */
/**
 * Erstindikation basierend auf BRW, Immobilienart und Grundstücksfläche berechnen.
 */
export function buildEnrichment(brwPerM2, art, grundstuecksflaeche) {
    const istHaus = !art?.toLowerCase().includes('wohnung');
    const flaeche = grundstuecksflaeche || null;
    // Kein BRW verfügbar
    if (!brwPerM2) {
        return {
            ist_haus: istHaus,
            grundstuecksflaeche_bekannt: !!flaeche,
            hinweis: 'Kein Bodenrichtwert verfügbar – Erstindikation nicht möglich.',
        };
    }
    // Wohnung → Erbbaurecht nicht direkt möglich
    if (!istHaus) {
        return {
            ist_haus: false,
            grundstuecksflaeche_bekannt: !!flaeche,
            hinweis: 'Erbbaurecht nur bei Häusern mit eigenem Grundstück möglich. Bei Wohnungen ggf. Teilverkauf oder Rückmietverkauf prüfen.',
            beispielrechnung_haus: calcBeispiel(brwPerM2, 500),
        };
    }
    // Haus mit bekannter Grundstücksfläche → exakte Berechnung
    if (flaeche) {
        return {
            ist_haus: true,
            grundstuecksflaeche_bekannt: true,
            hinweis: 'Erbbaurecht-Erstindikation verfügbar.',
            rechnung: calcBeispiel(brwPerM2, flaeche),
        };
    }
    // Haus ohne Grundstücksfläche → Beispielrechnungen
    return {
        ist_haus: true,
        grundstuecksflaeche_bekannt: false,
        hinweis: 'Grundstücksfläche fehlt im Formular. Beispielrechnungen mit 400/600/800 m².',
        beispielrechnungen: {
            '400m2': calcBeispiel(brwPerM2, 400),
            '600m2': calcBeispiel(brwPerM2, 600),
            '800m2': calcBeispiel(brwPerM2, 800),
        },
    };
}
/**
 * Erbbauzins-Berechnung für gegebene Fläche und BRW.
 */
function calcBeispiel(brw, flaeche) {
    const grundstueckswert = brw * flaeche;
    return {
        grundstueck_m2: flaeche,
        brw_eur_m2: brw,
        grundstueckswert,
        erbbauzins_3pct_jaehrlich: Math.round(grundstueckswert * 0.03),
        erbbauzins_3pct_monatlich: Math.round(grundstueckswert * 0.03 / 12),
        erbbauzins_4pct_jaehrlich: Math.round(grundstueckswert * 0.04),
        erbbauzins_4pct_monatlich: Math.round(grundstueckswert * 0.04 / 12),
        erbbauzins_5_5pct_jaehrlich: Math.round(grundstueckswert * 0.055),
        erbbauzins_5_5pct_monatlich: Math.round(grundstueckswert * 0.055 / 12),
    };
}
//# sourceMappingURL=enrichment.js.map