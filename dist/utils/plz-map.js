/**
 * Statische PLZ → Bundesland Zuordnung.
 * Basiert auf den groben PLZ-Bereichen. Nicht 100% exakt an Grenzen,
 * aber ausreichend für Bundesland-Routing.
 *
 * Quelle: Deutsche Post PLZ-Verzeichnis
 */
// Grobe PLZ-Bereiche → Bundesland
// Hinweis: An Landesgrenzen gibt es Überlappungen, daher nur als Fallback nutzen
const PLZ_RANGES = [
    // Sachsen
    { from: 1000, to: 1999, state: 'Sachsen' },
    { from: 2000, to: 2999, state: 'Sachsen' },
    { from: 4000, to: 4999, state: 'Sachsen' },
    { from: 8000, to: 9999, state: 'Sachsen' },
    // Brandenburg / Berlin
    { from: 10000, to: 12999, state: 'Berlin' },
    { from: 13000, to: 13999, state: 'Berlin' }, // teils Brandenburg
    { from: 14000, to: 16999, state: 'Brandenburg' },
    { from: 17000, to: 17999, state: 'Mecklenburg-Vorpommern' },
    { from: 18000, to: 19999, state: 'Mecklenburg-Vorpommern' },
    // Hamburg / Schleswig-Holstein / Niedersachsen
    { from: 20000, to: 22999, state: 'Hamburg' },
    { from: 23000, to: 25999, state: 'Schleswig-Holstein' },
    { from: 26000, to: 28999, state: 'Niedersachsen' },
    { from: 29000, to: 29999, state: 'Niedersachsen' },
    // Niedersachsen / Bremen
    { from: 27500, to: 27999, state: 'Bremen' }, // Bremerhaven-Bereich
    { from: 28000, to: 28999, state: 'Bremen' },
    // Nordrhein-Westfalen
    { from: 30000, to: 31999, state: 'Niedersachsen' }, // Hannover
    { from: 32000, to: 33999, state: 'Nordrhein-Westfalen' },
    { from: 34000, to: 34999, state: 'Hessen' },
    { from: 35000, to: 35999, state: 'Hessen' },
    { from: 36000, to: 36999, state: 'Hessen' },
    { from: 37000, to: 37999, state: 'Niedersachsen' },
    { from: 38000, to: 39999, state: 'Niedersachsen' }, // auch Sachsen-Anhalt
    // Nordrhein-Westfalen Kern
    { from: 40000, to: 41999, state: 'Nordrhein-Westfalen' },
    { from: 42000, to: 42999, state: 'Nordrhein-Westfalen' },
    { from: 44000, to: 48999, state: 'Nordrhein-Westfalen' },
    { from: 49000, to: 49999, state: 'Niedersachsen' },
    { from: 50000, to: 53999, state: 'Nordrhein-Westfalen' },
    // Rheinland-Pfalz / Saarland
    { from: 54000, to: 56999, state: 'Rheinland-Pfalz' },
    { from: 57000, to: 57999, state: 'Nordrhein-Westfalen' },
    { from: 58000, to: 59999, state: 'Nordrhein-Westfalen' },
    // Hessen / Thüringen
    { from: 60000, to: 63999, state: 'Hessen' },
    { from: 64000, to: 65999, state: 'Hessen' },
    { from: 66000, to: 66999, state: 'Saarland' },
    { from: 67000, to: 67999, state: 'Rheinland-Pfalz' },
    { from: 68000, to: 69999, state: 'Baden-Württemberg' },
    // Baden-Württemberg
    { from: 70000, to: 76999, state: 'Baden-Württemberg' },
    { from: 77000, to: 79999, state: 'Baden-Württemberg' },
    // Bayern
    { from: 80000, to: 87999, state: 'Bayern' },
    { from: 88000, to: 89999, state: 'Baden-Württemberg' }, // teils Bayern
    { from: 90000, to: 97999, state: 'Bayern' },
    { from: 98000, to: 99999, state: 'Thüringen' },
    // Sachsen-Anhalt
    { from: 6000, to: 6999, state: 'Sachsen-Anhalt' },
    { from: 39000, to: 39999, state: 'Sachsen-Anhalt' },
    // Thüringen
    { from: 7000, to: 7999, state: 'Thüringen' },
    // 55xxx Rheinland-Pfalz (Simmern!)
    { from: 55000, to: 55999, state: 'Rheinland-Pfalz' },
];
/**
 * PLZ (als String, z.B. "55469") → Bundesland.
 * Gibt null zurück wenn keine Zuordnung gefunden.
 */
export function plzToState(plz) {
    const num = parseInt(plz, 10);
    if (isNaN(num))
        return null;
    // Exakteste Ranges zuerst (kleinere Ranges bevorzugen)
    const match = PLZ_RANGES
        .filter(r => num >= r.from && num <= r.to)
        .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
    return match?.state || null;
}
//# sourceMappingURL=plz-map.js.map