# Bewertungsmethodik

Technische Dokumentation des Bewertungsmoduls (`src/bewertung.ts`).

Das Modul liefert das `bewertung`-Feld in der API-Response von `POST /api/enrich`. Es kombiniert bis zu 5 Datenquellen:

- **Bodenrichtwerte** (BORIS/WFS) — offiziell oder geschätzt
- **ImmoScout24 Atlas** — Marktpreise auf Stadt- oder Stadtteil-Ebene
- **NHK 2010** (ImmoWertV 2022 Anlage 4) — Normalherstellungskosten für den Gebäudewert
- **Bundesbank Wohnimmobilienpreisindex** — indexbasierte Stichtag-Korrektur
- **BORIS-NRW Immobilienrichtwerte** — amtliche Vergleichswerte (nur NRW)

---

## Inhaltsverzeichnis

1. [Eingabeparameter](#1-eingabeparameter)
2. [Input-Validierung](#2-input-validierung)
3. [Gate-Checks](#3-gate-checks)
4. [Methodenwahl](#4-methodenwahl)
5. [Korrekturfaktoren](#5-korrekturfaktoren)
6. [Overlap-Korrekturen](#6-overlap-korrekturen)
7. [Berechnungsformeln](#7-berechnungsformeln)
8. [NHK 2010 Gebäudewert](#8-nhk-2010-gebäudewert)
9. [Stichtag-Korrektur (Bundesbank)](#9-stichtag-korrektur-bundesbank)
10. [Stadtteil-Marktdaten](#10-stadtteil-marktdaten)
11. [Konfidenz & Spanne](#11-konfidenz--spanne)
12. [Cross-Validation](#12-cross-validation)
13. [NRW Immobilienrichtwerte](#13-nrw-immobilienrichtwerte)
14. [Hinweise-System](#14-hinweise-system)
15. [Ausgabeformat](#15-ausgabeformat)

---

## 1. Eingabeparameter

Die Bewertung wird aus dem `BewertungInput`-Objekt berechnet, das aus dem Request-Body extrahiert wird.

| Feld | Typ | Pflicht | Beschreibung | Beispiel |
|------|-----|---------|-------------|----------|
| `art` | `string \| null` | Nein | Immobilienart | `"Einfamilienhaus"`, `"Wohnung"` |
| `grundstuecksflaeche` | `number \| null` | Nein* | Grundstücksfläche in m² | `500` |
| `wohnflaeche` | `number \| null` | **Ja** | Wohnfläche in m² | `140` |
| `baujahr` | `number \| null` | Nein | Baujahr | `1985` |
| `objektunterart` | `string \| null` | Nein | Objekttyp | `"Doppelhaushälfte"` |
| `modernisierung` | `string \| null` | Nein | Modernisierungsgrad (Text oder Score 1–5) | `"Teilweise modernisiert"` oder `"3"` |
| `energie` | `string \| null` | Nein | Energieeffizienz (Text oder Score 1–5) | `"Gut"` oder `"4"` |
| `ausstattung` | `string \| null` | Nein | Ausstattungsniveau (Text oder Score 1–5) | `"Gehoben"` oder `"4"` |

\* Ohne `grundstuecksflaeche` kann die Methode `sachwert-lite` nicht verwendet werden.

### Numerische Scores (1–5)

Die Felder `modernisierung`, `energie` und `ausstattung` akzeptieren neben Text-Beschreibungen auch numerische Scores von 1 (schlecht) bis 5 (sehr gut). Die genaue Zuordnung ist im Endpoint `GET /api/optionen` abrufbar.

---

## 2. Input-Validierung

Nach dem Wohnfläche-Gate werden Eingabewerte auf Plausibilität geprüft. Unplausible Werte führen **nicht** zur Ablehnung, sondern zu Warnhinweisen im `hinweise[]`-Array:

| Bedingung | Hinweis |
|-----------|---------|
| `baujahr < 1800` oder `baujahr > aktuelles_Jahr + 5` | „Baujahr X liegt außerhalb des plausiblen Bereichs (1800–Y)." |
| `wohnflaeche < 15` | „Wohnfläche X m² ist ungewöhnlich klein." |
| `wohnflaeche > 2000` | „Wohnfläche X m² ist ungewöhnlich groß." |
| `grundstuecksflaeche > 50000` | „Grundstücksfläche X m² ist ungewöhnlich groß." |

---

## 3. Gate-Checks

Die Bewertung gibt `null` zurück wenn:

1. **Wohnfläche fehlt** — `wohnflaeche` ist `null`, `undefined` oder `<= 0`
2. **Keine Datenquelle verfügbar** — weder Marktpreise (ImmoScout) noch Bodenrichtwert (BRW mit `wert > 0`) vorhanden

---

## 4. Methodenwahl

### Bewertungsmethode

| Methode | Bedingung | Beschreibung |
|---------|-----------|--------------|
| `sachwert-lite` | BRW vorhanden (`wert > 0`) **und** Grundstücksfläche bekannt | Bodenwert + Gebäudewert getrennt berechnet |
| `marktpreis-indikation` | Kein BRW **oder** keine Grundstücksfläche | Rein marktbasiert über ImmoScout-Daten |

### Marktpreis-Selektion

Je nach Immobilienart wird der passende Marktpreis aus ImmoScout gewählt:

| Immobilienart | Primärer Preis | Fallback |
|---------------|----------------|----------|
| Haus (Standard) | `haus_kauf_preis` | `wohnung_kauf_preis` |
| Wohnung (`art` enthält "wohnung") | `wohnung_kauf_preis` | `haus_kauf_preis` |

---

## 5. Korrekturfaktoren

Alle Faktoren werden **additiv** zum Gesamtfaktor summiert:

```
gesamt = baujahr + modernisierung + energie + ausstattung + objektunterart + neubau + stichtag_korrektur
```

Der Grundstücksfaktor ist immer 0, da der Bodenwert über den BRW abgebildet wird.

### 5.1 Baujahr

| Baujahr | Faktor |
|---------|--------|
| `>= 2020` | `0.00` (Neubau-Faktor übernimmt) |
| `< 1950` | `-0.10` |
| `1950–1979` | `-0.08` |
| `1980–1999` | `-0.04` |
| `2000–2010` | `0.00` |
| `2011–2019` | `+0.03` |
| `null` | `0.00` |

### 5.2 Modernisierung

Akzeptiert numerische Scores (1–5) oder Text-Beschreibungen. Der Faktor hängt zusätzlich vom Baujahr ab.

**Numerische Scores:**

| Score | Stufe | Baujahr < 1970 | Baujahr < 1990 | Baujahr >= 1990 |
|-------|-------|----------------|----------------|-----------------|
| 5 | Kernsanierung / Neuwertig | `+0.02` | `+0.02` | `+0.02` |
| 4 | Umfassend modernisiert | `0.00` | `0.00` | `0.00` |
| 3 | Teilweise modernisiert | `-0.06` | `-0.04` | `-0.02` |
| 2 | Nur einzelne Maßnahmen | `-0.10` | `-0.08` | `-0.05` |
| 1 | Keine Modernisierungen | `-0.18` | `-0.12` | `-0.02` |

**Text-Matching (case-insensitive):**

| Text (enthält) | Faktor |
|----------------|--------|
| `"kernsanierung"`, `"neuwertig"` | `+0.02` |
| `"umfassend"`, `"vollständig"`, `"vollsaniert"` | `0.00` |
| `"teilweise"`, `"teilsaniert"` | `-0.02` bis `-0.06` (nach Alter) |
| `"nur einzelne"`, `"einzelne maßnahmen"`, `"einzelne"` | `-0.05` bis `-0.10` (nach Alter) |
| `"keine"`, `"unsaniert"`, `"unrenoviert"` | `-0.02` bis `-0.18` (nach Alter) |
| Unbekannt | `0.00` |

### 5.3 Energie

| Score | Text | Faktor | Beispiel-Klassen |
|-------|------|--------|-----------------|
| 5 | `"sehr gut"` | `+0.03` | A+, A |
| 4 | `"gut"` | `0.00` | B |
| 3 | `"durchschnittlich"` | `-0.01` | C, D |
| 2 | `"eher schlecht"` | `-0.03` | E, F |
| 1 | `"sehr schlecht"`, `"schlecht"` | `-0.06` | G, H |
| — | Unbekannt | `0.00` | — |

### 5.4 Ausstattung

| Score | Text | Faktor |
|-------|------|--------|
| 5 | `"stark gehoben"`, `"luxus"` | `+0.05` |
| 4 | `"gehoben"` | `+0.03` |
| 3 | `"mittel"`, `"normal"`, `"standard"` | `0.00` |
| 2 | `"einfach"` | `-0.03` |
| 1 | `"schlecht"` | `-0.05` |
| — | Unbekannt | `0.00` |

### 5.5 Objektunterart

| Objektunterart | Faktor |
|----------------|--------|
| Stadthaus / Townhouse | `+0.05` |
| Bungalow | `+0.02` |
| Freistehendes EFH (Standard) | `0.00` |
| Zweifamilienhaus (ZFH) | `-0.03` |
| Reihenendhaus | `-0.04` |
| Mehrfamilienhaus (MFH) | `-0.04` |
| Doppelhaushälfte (DHH) | `-0.05` |
| Reihenmittelhaus | `-0.08` |
| Bauernhaus / Resthof | `-0.10` |
| Unbekannt | `0.00` |

### 5.6 Neubau-Zuschlag

| Baujahr | Faktor |
|---------|--------|
| `>= 2020` | `+0.10` |
| `< 2020` oder `null` | `0.00` |

### 5.7 Stichtag-Korrektur

Korrigiert den BRW basierend auf der Marktentwicklung seit dem Stichtag.

**Stufe 1: Bundesbank Wohnimmobilienpreisindex** (bevorzugt)

Wenn Preisindex-Daten verfügbar sind (`src/utils/bundesbank.ts`):
```
Korrektur = (Index_aktuell / Index_stichtag) - 1
```
Quelle: Deutsche Bundesbank SDMX API (`BBK01/BBSRI`), quartalsweise, Basis 2015=100.
Cache: 30 Tage TTL.

**Stufe 2: Pauschale Schätzung** (Fallback)

Wenn kein Preisindex verfügbar:
```
Alter in Jahren = (heute - BRW-Stichtag) / 365.25
Wenn Alter > 2: Korrektur = (Alter - 2) * 0.025
Sonst: Korrektur = 0
```

**Beispiel:** BRW-Stichtag 2020-01-01, Index damals 100, heute 122 → Korrektur = +22%

---

## 6. Overlap-Korrekturen

### 6.1 Baujahr + Neubau

Für Baujahr >= 2020 gibt `calcBaujahrFaktor` `0` zurück, da der `calcNeubauFaktor` (+0.10) den Zeitwertbonus bereits vollständig abdeckt. Ohne diese Korrektur würden +0.03 (Baujahr > 2010) und +0.10 (Neubau) doppelt gezählt.

### 6.2 Neubau + Modernisierung

Ein Neubau (>= 2020) ist per Definition neuwertig. Wenn sowohl `neubau > 0` als auch `modernisierung > 0`, wird der Modernisierungs-Bonus auf 0 gesetzt und ein Hinweis erzeugt:

> „Neubau-Zuschlag schließt Modernisierungs-Bonus ein. Faktor-Überlapp wurde korrigiert."

Negative Modernisierungswerte (theoretischer Sonderfall) bleiben erhalten.

---

## 7. Berechnungsformeln

### 7.1 Sachwert-lite

Wird verwendet wenn BRW (`wert > 0`) und Grundstücksfläche vorhanden sind.

**Bodenwert:**
```
Bodenwert = round(BRW × (1 + stichtag_korrektur) × Grundstücksfläche)
```

**Gebäudewert (mit Marktdaten):**
```
Markt-Gesamtwert = Marktpreis_pro_m² × Wohnfläche × (1 + Gesamtfaktor)
Gebäudewert = round(max(0, Markt-Gesamtwert - Bodenwert))
```

**Gebäudewert (ohne Marktdaten) — NHK 2010:**

Wenn kein Marktpreis verfügbar, wird der Gebäudewert nach NHK 2010 berechnet (siehe [Abschnitt 8](#8-nhk-2010-gebäudewert)).

**Immobilienwert:**
```
Immobilienwert = Bodenwert + Gebäudewert
m²-Preis = round(Immobilienwert / Wohnfläche)
```

### 7.2 Marktpreis-Indikation

Wird verwendet wenn kein BRW oder keine Grundstücksfläche vorhanden.

```
korrigierter_m²_Preis = Marktpreis_pro_m² × (1 + Gesamtfaktor)
Immobilienwert = round(korrigierter_m²_Preis × Wohnfläche)
```

Falls BRW und Grundstücksfläche vorhanden (aber Methode trotzdem Marktpreis):
```
Bodenwert = round(BRW × Grundstücksfläche)
Gebäudewert = round(max(0, Immobilienwert - Bodenwert))
```

### 7.3 Wertspanne

Die Spanne wird symmetrisch um den realistischen Wert berechnet:

```
m²-Preis-Spanne:
  min = round(m²-Preis × (1 - spread))
  max = round(m²-Preis × (1 + spread))

Immobilienwert-Spanne:
  min = round(Immobilienwert × (1 - spread))
  max = round(Immobilienwert × (1 + spread))
```

Der `spread`-Wert wird durch die Konfidenz bestimmt (siehe nächster Abschnitt).

---

## 8. NHK 2010 Gebäudewert

Wenn im Sachwert-lite-Pfad kein Marktpreis verfügbar ist, wird der Gebäudewert über die **Normalherstellungskosten 2010** (ImmoWertV 2022 Anlage 4) berechnet.

Implementierung: `src/utils/nhk.ts`

### Formel

```
Gebäudewert = NHK_2010 × BGF × (BPI_aktuell / BPI_2010) × (RND / GND)
```

### NHK 2010 Kostenkennwerte (EUR/m² BGF, Preisstand 2010)

| Gebäudetyp | Stufe 1 | Stufe 2 | Stufe 3 | Stufe 4 | Stufe 5 |
|------------|---------|---------|---------|---------|---------|
| EFH freistehend | 655 | 725 | 835 | 1.005 | 1.260 |
| DHH / Reihenendhaus | 610 | 675 | 775 | 935 | 1.170 |
| Reihenmittelhaus | 575 | 640 | 735 | 885 | 1.110 |
| ZFH | 690 | 760 | 875 | 1.055 | 1.325 |
| MFH / ETW | 490 | 545 | 625 | 755 | 945 |

Quelle: ImmoWertV 2022 Anlage 4, Gebäudeart 1.01 (EFH), andere abgeleitet.

### BGF-Schätzung (Wohnfläche → Brutto-Grundfläche)

| Typ | Faktor |
|-----|--------|
| EFH freistehend | 1,35 |
| DHH / Reihenendhaus | 1,25 |
| Reihenmittelhaus | 1,20 |
| ZFH | 1,30 |
| MFH / ETW | 1,25 |

### Baupreisindex-Anpassung

```
BPI-Faktor = BPI_aktuell / BPI_2010
```
- BPI 2010 = 90,4 (Destatis, Basis 2015=100)
- BPI aktuell = 168,2 (Q3/2025)

### Alterswertminderung (linear)

```
Restnutzungsdauer (RND) = max(0, GND - Gebäudealter)
Alterswertminderung = RND / GND
```

Gesamtnutzungsdauer (GND): 80 Jahre für alle Wohngebäude (SW-RL Anlage 3).

### Modernisierungs-Modifikation

Modernisierung verlängert die Restnutzungsdauer (SW-RL Anlage 4):

| Modernisierung | Mindest-RND (% der GND) |
|----------------|------------------------|
| Kernsanierung / Neuwertig (Score 5) | 65% |
| Umfassend modernisiert (Score 4) | 50% |
| Teilweise modernisiert (Score 3) | 35% |
| Einzelne / Keine | Keine Änderung |

---

## 9. Stichtag-Korrektur (Bundesbank)

Die Stichtag-Korrektur nutzt den **Deutschen Bundesbank Wohnimmobilienpreisindex** (SDMX API) für eine indexbasierte Marktanpassung.

Implementierung: `src/utils/bundesbank.ts`

### Datenquelle

- API: `https://api.statistiken.bundesbank.de/rest/data/BBK01/BBSRI`
- Format: SDMX-JSON
- Basis: 2015 = 100
- Aktualisierung: Quartalsweise
- Cache: 30 Tage TTL (In-Memory)

### Berechnungslogik

1. Stichtag-Quartal und aktuelles Quartal bestimmen
2. Nächstliegenden Indexwert für beide Quartale suchen
3. Korrektur = `(Index_aktuell / Index_stichtag) - 1`
4. Fallback bei API-Fehler: Pauschale +2,5%/Jahr nach 2-Jahres-Frist

---

## 10. Stadtteil-Marktdaten

ImmoScout-Marktdaten werden wenn möglich auf Stadtteil-Ebene abgerufen.

### Ablauf

1. **City-Level**: `scrapeImmoScoutAtlas(bundesland, stadt)` → Stadtdurchschnitt
2. **District-Level**: `scrapeImmoScoutDistricts(bundesland, stadt)` → Stadtteil-Liste
3. **Matching** gegen `geo.district` (aus Nominatim):
   - Exakter Match (Stadtteil-Name identisch)
   - Partial Match (Stadtteil-Name enthalten)
   - Fallback auf City-Level

### Nominatim-Felder für District

```
district = address.suburb || address.city_district || address.quarter || ''
```

### Hinweis in der Response

- Mit Stadtteil-Match: „Marktpreise basieren auf Stadtteil-Daten für {Name}."
- Ohne Match: „Marktpreise basieren auf Stadtdurchschnitt. Lage-spezifische Abweichungen möglich."

---

## 11. Konfidenz & Spanne

Die Konfidenz-Stufe und der Spread hängen von Bewertungsmethode und BRW-Qualität ab.

| Methode | BRW-Qualität | Konfidenz | Spread |
|---------|-------------|-----------|--------|
| `sachwert-lite` | Offizieller BRW | `hoch` | ±8% |
| `sachwert-lite` | Geschätzter BRW (`schaetzung = true`) | `mittel` | ±15% |
| `sachwert-lite` | Kein BRW / ungültig | `gering` | ±20% |
| `marktpreis-indikation` | (irrelevant) | `mittel` | ±15% |

Bei der `marktpreis-indikation` ist die BRW-Qualität irrelevant, da der BRW nicht in die Berechnung einfließt. Der Stadtdurchschnitt aus ImmoScout hat eine inhärente Unsicherheit von ca. ±15%.

---

## 12. Cross-Validation

Wenn **beide** Datenquellen verfügbar sind (BRW + ImmoScout), wird eine Plausibilitätsprüfung durchgeführt:

```
reiner_Marktwert = Marktpreis_pro_m² × Wohnfläche
Abweichung = |Immobilienwert - reiner_Marktwert| / reiner_Marktwert
```

Bei Abweichung > 25% wird ein Hinweis erzeugt:

> „Sachwert-Ergebnis weicht X% vom reinen Marktpreis ab. Manuelle Prüfung empfohlen."

**Beispiel:**
| Reiner Marktwert | Berechneter Wert | Abweichung | Warnung? |
|------------------|------------------|------------|----------|
| 400.000 € | 450.000 € | 12,5% | Nein |
| 400.000 € | 520.000 € | 30% | Ja |

---

## 13. NRW Immobilienrichtwerte

Für Adressen in Nordrhein-Westfalen wird der **BORIS-NRW Immobilienrichtwert** (IRW) als zusätzliche Cross-Validation abgerufen.

Implementierung: `src/utils/nrw-irw.ts`

### Datenquelle

- WMS: `https://www.wms.nrw.de/boris/wms_nw_irw` (aktueller Jahrgang)
- Fallback: `https://www.wms.nrw.de/boris/wms-t_nw_irw` (ab 2011)
- Lizenz: Datenlizenz Deutschland – Zero – Version 2.0
- Format: GetFeatureInfo (XML, HTML, JSON)

### Was sind IRW?

IRW sind georeferenzierte, amtliche Durchschnittswerte für Immobilien in EUR/m² Wohnfläche, bezogen auf ein standorttypisches **Normobjekt**. Sie umfassen Boden + Gebäude.

### Teilmärkte

| Kürzel | Beschreibung |
|--------|-------------|
| EFH | Ein-/Zweifamilienhäuser |
| RDH | Reihen-/Doppelhäuser |
| ETW | Eigentumswohnungen |
| MFH | Mehrfamilienhäuser |

### Cross-Validation

```
IRW-Gesamtwert = IRW_pro_m² × Wohnfläche
Abweichung = |Immobilienwert - IRW-Gesamtwert| / IRW-Gesamtwert
```

| Abweichung | Hinweis |
|------------|---------|
| ≤ 25% | „NRW Immobilienrichtwert bestätigt Bewertung." |
| > 25% | „Erhebliche Abweichung zum NRW Immobilienrichtwert. Manuelle Prüfung empfohlen." |

### Einschränkungen

- Nur für NRW-Adressen (`geo.state === 'Nordrhein-Westfalen'`)
- WMS-Endpoint kann langsam oder nicht erreichbar sein → Timeout 10s, blockiert nie die Haupt-Response
- Nicht alle Gemeinden haben IRW-Daten

---

## 14. Hinweise-System

Automatisch generierte Warnungen im `hinweise[]`-Array:

| # | Bedingung | Hinweis |
|---|-----------|---------|
| 1 | Input-Validierung (Baujahr, Wohnfläche, Grundstück) | „{Feld} liegt außerhalb des plausiblen Bereichs. Ergebnis möglicherweise unzuverlässig." |
| 2 | Neubau (>= 2020) + Modernisierung positiv | „Neubau-Zuschlag schließt Modernisierungs-Bonus ein. Faktor-Überlapp wurde korrigiert." |
| 3 | Bodenwert > Markt-Gesamtwert (Sachwert-lite) | „Bodenwert übersteigt Marktindikation. Grundstücksanteil dominiert den Gesamtwert." |
| 4 | Kein Marktpreis, NHK 2010 berechnet | NHK-Berechnungsdetails (Kostenkennwert, BGF, BPI, RND/GND). |
| 5 | Modernisierung verlängert RND | „Modernisierung verlängert Restnutzungsdauer von X auf Y Jahre." |
| 6 | BRW-Stichtag mit Bundesbank-Index korrigiert | „BRW-Stichtag {Datum}: Marktanpassung +{X}% (Bundesbank Wohnimmobilienpreisindex)." |
| 7 | BRW-Stichtag mit Pauschale korrigiert | „BRW-Stichtag {Datum}: Marktanpassung +{X}% (pauschale Schätzung +2,5%/Jahr)." |
| 8 | Cross-Validation > 25% Abweichung | „Sachwert-Ergebnis weicht {X}% vom reinen Marktpreis ab. Manuelle Prüfung empfohlen." |
| 9 | NRW IRW Cross-Validation | „NRW Immobilienrichtwert bestätigt/weicht ab (IRW: X €/m²)." |
| 10 | BRW ist Schätzwert (`schaetzung = true`) | „Bodenrichtwert ist ein Schätzwert. Genauigkeit eingeschränkt." |
| 11 | Marktpreis-Indikation ohne BRW | „Kein Bodenrichtwert verfügbar. Bewertung basiert ausschließlich auf ImmoScout Marktdaten." |
| 12 | Marktpreis-Indikation ohne Grundstücksfläche | „Grundstücksfläche fehlt. Aufteilung in Boden-/Gebäudewert nicht möglich." |
| 13 | Stadtteil-Daten vorhanden | „Marktpreise basieren auf Stadtteil-Daten für {Name}." |
| 14 | Kein Stadtteil → Stadtdurchschnitt | „Marktpreise basieren auf Stadtdurchschnitt. Lage-spezifische Abweichungen möglich." |

---

## 15. Ausgabeformat

### Bewertung-Objekt

```typescript
interface Bewertung {
  realistischer_qm_preis: number;                          // €/m²
  qm_preis_spanne: { min: number; max: number };           // €/m² Bereich
  realistischer_immobilienwert: number;                    // Gesamtwert in €
  immobilienwert_spanne: { min: number; max: number };     // Gesamtwert-Bereich in €
  bodenwert: number;                                       // Bodenwert in €
  gebaeudewert: number;                                    // Gebäudewert in €
  bewertungsmethode: 'sachwert-lite' | 'marktpreis-indikation';
  konfidenz: 'hoch' | 'mittel' | 'gering';
  faktoren: BewertungFaktoren;                            // Alle Korrekturfaktoren
  hinweise: string[];                                      // Warnungen/Hinweise
  datenquellen: string[];                                  // Verwendete Datenquellen
}
```

### Beispiel-Response (Sachwert-lite)

```json
{
  "bewertung": {
    "realistischer_qm_preis": 3150,
    "qm_preis_spanne": { "min": 2898, "max": 3402 },
    "realistischer_immobilienwert": 441000,
    "immobilienwert_spanne": { "min": 405720, "max": 476280 },
    "bodenwert": 125000,
    "gebaeudewert": 316000,
    "bewertungsmethode": "sachwert-lite",
    "konfidenz": "hoch",
    "faktoren": {
      "baujahr": -0.04,
      "modernisierung": -0.04,
      "energie": -0.01,
      "ausstattung": 0,
      "objektunterart": 0,
      "grundstueck": 0,
      "neubau": 0,
      "stichtag_korrektur": 0,
      "gesamt": -0.09
    },
    "hinweise": [
      "Marktpreise basieren auf Stadtdurchschnitt (ImmoScout24 Atlas). Lage-spezifische Abweichungen möglich."
    ],
    "datenquellen": [
      "BORIS/WFS Bodenrichtwert",
      "ImmoScout24 Atlas Marktpreise"
    ]
  }
}
```

### Datenquellen

| Quelle | Wann verwendet |
|--------|---------------|
| `BORIS/WFS Bodenrichtwert` | BRW vorhanden und genutzt (Sachwert-lite) |
| `ImmoScout24 Atlas Marktpreise` | Marktpreise verfügbar |
| `NHK 2010 (ImmoWertV 2022)` | Gebäudewert ohne Marktdaten berechnet |
| `Bundesbank Wohnimmobilienpreisindex` | Stichtag-Korrektur mit echtem Index |
| `BORIS-NRW Immobilienrichtwerte` | IRW Cross-Validation (nur NRW) |
| `ImmoScout24 Atlas (BRW-Schätzwert)` | BRW ist ein geschätzter Wert |

Datenquellen werden dedupliziert ausgegeben.

---

## Ablaufdiagramm

```
POST /api/enrich (mit wohnflaeche, baujahr, etc.)
  │
  ├─ Parallel starten:
  │   ├─ ImmoScout City → District Marktdaten
  │   ├─ Bundesbank Preisindex
  │   └─ NRW IRW (nur Nordrhein-Westfalen)
  │
  ├─ Gate: wohnflaeche vorhanden?  ──── Nein ──→ bewertung: null
  │
  ├─ Input-Validierung (Hinweise für Extremwerte)
  │
  ├─ Gate: Datenquelle verfügbar?  ──── Nein ──→ bewertung: null
  │
  ├─ Immobilienart erkennen (Haus vs. Wohnung)
  │
  ├─ Marktpreis wählen (haus_kauf_preis / wohnung_kauf_preis)
  │   └─ Stadtteil-Daten bevorzugt (→ City-Fallback)
  │
  ├─ 7 Korrekturfaktoren berechnen
  │   ├─ Baujahr
  │   ├─ Modernisierung (baujahr-abhängig)
  │   ├─ Energie
  │   ├─ Ausstattung
  │   ├─ Objektunterart
  │   ├─ Neubau (>= 2020)
  │   └─ Stichtag-Korrektur (Bundesbank-Index → Pauschale)
  │
  ├─ Overlap-Korrekturen (Neubau vs. Baujahr/Modernisierung)
  │
  ├─ Gesamtfaktor summieren
  │
  ├─ Methode wählen
  │   ├─ BRW + Grundstück → Sachwert-lite
  │   └─ Sonst → Marktpreis-Indikation
  │
  ├─ Immobilienwert berechnen
  │   └─ Ohne Marktdaten: NHK 2010 Gebäudewert
  │
  ├─ Konfidenz + Spread bestimmen
  │
  ├─ Wertspannen berechnen (±spread)
  │
  ├─ Cross-Validation (Marktpreis + NRW IRW)
  │
  └─ Hinweise sammeln → Bewertung zurückgeben
```
