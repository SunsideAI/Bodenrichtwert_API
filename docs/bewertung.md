# Bewertungsmethodik

Technische Dokumentation des Bewertungsmoduls (`src/bewertung.ts`) und der KI-Validierungsschicht (`src/llm-validator.ts`).

Das Modul liefert die Felder `bewertung`, `validation` und `bericht` in der API-Response von `POST /api/enrich`. Es kombiniert bis zu 9 Datenquellen:

- **Bodenrichtwerte** (BORIS/WFS) — offiziell oder geschätzt
- **ImmoScout24 Atlas** — Marktpreise auf Stadt- oder Stadtteil-Ebene
- **NHK 2010** (ImmoWertV 2022 Anlage 4) — Normalherstellungskosten für den Gebäudewert
- **Ertragswertverfahren** (ImmoWertV §§ 27-34) — Renditewert als Cross-Validation
- **Bundesbank Wohnimmobilienpreisindex** — indexbasierte Stichtag-Korrektur
- **Destatis Baupreisindex** — Baukosten-Hochrechnung von 2010 auf heute
- **BORIS-NRW Immobilienrichtwerte** — amtliche Vergleichswerte (nur NRW)
- **KI-Recherche** (Claude + Web-Search) — automatische Datenrecherche bei schlechter Datenlage
- **KI-Validierung** (Claude Sonnet) — LLM-basierte Plausibilitätsprüfung + Auto-Korrektur

---

## Inhaltsverzeichnis

1. [Eingabeparameter](#1-eingabeparameter)
2. [Input-Validierung](#2-input-validierung)
3. [Gate-Checks](#3-gate-checks)
4. [Lage-Cluster](#4-lage-cluster)
5. [Methodenwahl](#5-methodenwahl)
6. [Korrekturfaktoren](#6-korrekturfaktoren)
7. [Overlap-Korrekturen](#7-overlap-korrekturen)
8. [Berechnungsformeln](#8-berechnungsformeln)
9. [NHK 2010 Gebäudewert](#9-nhk-2010-gebäudewert)
10. [NHK-IS24 Blend (Sachwert-lite)](#10-nhk-is24-blend-sachwert-lite)
11. [Ertragswertverfahren](#11-ertragswertverfahren)
12. [Stichtag-Korrektur (Bundesbank)](#12-stichtag-korrektur-bundesbank)
13. [Stadtteil-Marktdaten](#13-stadtteil-marktdaten)
14. [Konfidenz & Spanne](#14-konfidenz--spanne)
15. [Plausibilitätsprüfung (4-Signal)](#15-plausibilitätsprüfung-4-signal)
16. [KI-Recherche bei schlechter Datenlage](#16-ki-recherche-bei-schlechter-datenlage)
17. [KI-Validierung (LLM)](#17-ki-validierung-llm)
18. [KI-Auto-Korrektur](#18-ki-auto-korrektur)
19. [Cross-Validation](#19-cross-validation)
20. [NRW Immobilienrichtwerte](#20-nrw-immobilienrichtwerte)
21. [Hinweise-System](#21-hinweise-system)
22. [Bericht-Objekt (PDFMonkey)](#22-bericht-objekt-pdfmonkey)
23. [Ausgabeformat](#23-ausgabeformat)

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

\* Ohne `grundstuecksflaeche` wird sie aus Objekttyp geschätzt oder die Methode fällt auf `marktpreis-indikation` zurück.

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

## 4. Lage-Cluster

Korrekturfaktoren werden nach Lagequalität regionalisiert. Das System ordnet jede Adresse einem von drei Clustern zu:

| Cluster | Bedingung | Beschreibung | Beispiele |
|---------|-----------|--------------|-----------|
| **A-Lage** | BRW > 300 €/m² oder Hauspreis > 5.000 €/m² | Premium-Standorte | München, Hamburg-Eppendorf, Frankfurt |
| **B-Lage** | BRW 80–300 €/m² oder Hauspreis 2.000–5.000 €/m² | Standard-Mittelstädte | Aachen, Baesweiler, Gifhorn |
| **C-Lage** | BRW < 80 €/m² oder Hauspreis < 2.000 €/m² | Ländlich / strukturschwach | Eifel, Sachsen-Anhalt (ländlich) |

### Auswirkung auf Korrekturfaktoren

- **A-Lage**: Altbau-Premium (Gründerzeit hat Liebhaberwerte), schwächere Abschläge
- **B-Lage**: Standard-Abschläge (Referenz)
- **C-Lage**: Stärkere Abschläge für Alter/Zustand (Leerstandsrisiko)

---

## 5. Methodenwahl

### Bewertungsmethode

| Methode | Bedingung | Beschreibung |
|---------|-----------|--------------|
| `vergleichswert` | Wohnung/ETW **und** Marktdaten vorhanden | ImmoWertV § 15: Vergleichswertverfahren für ETW |
| `sachwert-lite` | Haus, BRW vorhanden (`wert > 0`) **und** Grundstücksfläche bekannt | NHK + IS24 Blend, Bodenwert + Gebäudewert getrennt |
| `marktpreis-indikation` | Kein BRW **oder** keine Grundstücksfläche | Rein marktbasiert über ImmoScout-Daten |

### Marktpreis-Selektion

Je nach Immobilienart wird der passende Marktpreis aus ImmoScout gewählt:

| Immobilienart | Primärer Preis | Fallback |
|---------------|----------------|----------|
| Haus (Standard) | `haus_kauf_preis` | `wohnung_kauf_preis` |
| Wohnung (`art` enthält "wohnung") | `wohnung_kauf_preis` | `haus_kauf_preis` |

---

## 6. Korrekturfaktoren

Alle Faktoren werden **additiv** zum Gesamtfaktor summiert:

```
gesamt = baujahr + modernisierung + energie + ausstattung + objektunterart + neubau + stichtag_korrektur
```

Der Grundstücksfaktor ist immer 0, da der Bodenwert über den BRW abgebildet wird.

### 6.1 Baujahr (lage-abhängig)

| Baujahr | A-Lage | B-Lage | C-Lage |
|---------|--------|--------|--------|
| `>= 2020` | `0.00` | `0.00` | `0.00` |
| `2011–2019` | `+0.03` | `+0.03` | `+0.03` |
| `2005–2010` | `0.00` | `0.00` | `0.00` |
| `1995–2004` | `-0.02` | `-0.04` | `-0.05` |
| `1980–1994` | `-0.03` | `-0.08` | `-0.10` |
| `1970–1979` | `-0.05` | `-0.12` | `-0.16` |
| `1950–1969` | `-0.06` | `-0.15` | `-0.20` |
| `< 1950` | `-0.08` | `-0.20` | `-0.25` |
| `null` | `0.00` | `0.00` | `0.00` |

**A-Lage-Effekt:** Altbauten < 1950 bekommen nur −8% statt −20% (Gründerzeit-Stuck, hohe Decken → Liebhaberwerte in Top-Lagen).

### 6.2 Modernisierung (kontinuierlich interpoliert)

Akzeptiert numerische Scores (1–5) oder Text-Beschreibungen. Zwischen den Eckpunkten wird **linear interpoliert** (keine diskreten Stufen).

**Eckpunkte:**

| Score | Stufe | Faktor (Baujahr < 1970) | Faktor (Baujahr < 1990) | Faktor (Baujahr >= 1990) |
|-------|-------|-------------------------|-------------------------|--------------------------|
| 5 | Kernsanierung / Neuwertig | `+0.02` | `+0.02` | `+0.02` |
| 4 | Umfassend modernisiert | `0.00` | `0.00` | `0.00` |
| 3 | Teilweise modernisiert | `-0.06` | `-0.04` | `-0.02` |
| 2 | Nur einzelne Maßnahmen | `-0.10` | `-0.08` | `-0.05` |
| 1 | Keine Modernisierungen | `-0.18` | `-0.12` | `-0.02` |

Zwischenwerte (z.B. Score 3.5) werden per linearer Interpolation berechnet.

### 6.3 Energie

| Score | Text | Faktor | Beispiel-Klassen |
|-------|------|--------|-----------------|
| 5 | `"sehr gut"` | `+0.03` | A+, A |
| 4 | `"gut"` | `0.00` | B |
| 3 | `"durchschnittlich"` | `-0.01` | C, D |
| 2 | `"eher schlecht"` | `-0.03` | E, F |
| 1 | `"sehr schlecht"`, `"schlecht"` | `-0.06` | G, H |
| — | Unbekannt | `0.00` | — |

### 6.4 Ausstattung

| Score | Text | Faktor |
|-------|------|--------|
| 5 | `"stark gehoben"`, `"luxus"` | `+0.05` |
| 4 | `"gehoben"` | `+0.03` |
| 3 | `"mittel"`, `"normal"`, `"standard"` | `0.00` |
| 2 | `"einfach"` | `-0.03` |
| 1 | `"schlecht"` | `-0.05` |
| — | Unbekannt | `0.00` |

### 6.5 Objektunterart

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

### 6.6 Neubau-Zuschlag

| Baujahr | Faktor |
|---------|--------|
| `>= 2020` | `+0.10` |
| `< 2020` oder `null` | `0.00` |

### 6.7 Stichtag-Korrektur

Korrigiert den BRW basierend auf der Marktentwicklung seit dem Stichtag.

**Stufe 1: Bundesbank Wohnimmobilienpreisindex** (bevorzugt)

```
Korrektur = (Index_aktuell / Index_stichtag) - 1
```

**Stufe 2: Pauschale Schätzung** (Fallback)

```
Alter in Jahren = (heute - BRW-Stichtag) / 365.25
Wenn Alter > 2: Korrektur = (Alter - 2) * 0.025
Sonst: Korrektur = 0
```

---

## 7. Overlap-Korrekturen

### 7.1 Baujahr + Neubau

Für Baujahr >= 2020 gibt `calcBaujahrFaktor` `0` zurück, da der `calcNeubauFaktor` (+0.10) den Zeitwertbonus bereits vollständig abdeckt.

### 7.2 Neubau + Modernisierung

Ein Neubau (>= 2020) ist per Definition neuwertig. Wenn sowohl `neubau > 0` als auch `modernisierung > 0`, wird der Modernisierungs-Bonus auf 0 gesetzt.

---

## 8. Berechnungsformeln

### 8.1 Vergleichswert (Wohnungen/ETW)

Wird verwendet für Wohnungen mit Marktdaten (ImmoWertV § 15).

```
Adjustierter qm-Preis = Marktpreis × (1 + Gesamtfaktor) × Angebotsabschlag
Vergleichswert = round(Adjustierter qm-Preis × Wohnfläche)
```

Bei vorhandenem Ertragswert (Mietdaten):
```
Immobilienwert = 80% Vergleichswert + 20% Ertragswert
```

### 8.2 Sachwert-lite (Häuser)

Wird verwendet wenn BRW (`wert > 0`) und Grundstücksfläche vorhanden sind.

**Bodenwert:**
```
Bodenwert = round(BRW × (1 + stichtag_korrektur) × Grundstücksfläche)
```

**Gebäudewert:** NHK 2010 berechnet + IS24 Blend (siehe [Abschnitt 10](#10-nhk-is24-blend-sachwert-lite))

**Immobilienwert:**
```
Immobilienwert = Bodenwert + Gebäudewert
```

### 8.3 Marktpreis-Indikation (Fallback)

```
korrigierter_m²_Preis = Marktpreis × (1 + Gesamtfaktor) × Angebotsabschlag
Immobilienwert = round(korrigierter_m²_Preis × Wohnfläche)
```

Falls kein Marktpreis verfügbar → Landesdurchschnitt → Bundesdurchschnitt als Fallback.

### 8.4 Wertspanne

```
Immobilienwert-Spanne:
  min = round(Immobilienwert × (1 - spread))
  max = round(Immobilienwert × (1 + spread))
```

Der `spread`-Wert wird durch die Konfidenz bestimmt (siehe [Abschnitt 14](#14-konfidenz--spanne)).

---

## 9. NHK 2010 Gebäudewert

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
- BPI aktuell wird live über Destatis Genesis API abgerufen (`src/utils/destatis.ts`)

### Alterswertminderung (linear)

```
Restnutzungsdauer (RND) = max(0, GND - Gebäudealter)
Alterswertminderung = RND / GND
```

Gesamtnutzungsdauer (GND): 80 Jahre für alle Wohngebäude (SW-RL Anlage 3).

### Modernisierungs-Modifikation

| Modernisierung | Mindest-RND (% der GND) |
|----------------|------------------------|
| Kernsanierung / Neuwertig (Score 5) | 65% |
| Umfassend modernisiert (Score 4) | 50% |
| Teilweise modernisiert (Score 3) | 35% |
| Einzelne / Keine | Keine Änderung |

---

## 10. NHK-IS24 Blend (Sachwert-lite)

Kernprinzip: **NHK (Sachwert) wird IMMER berechnet.** IS24-Marktdaten dienen als Kalibrierung.

### Basis-Gewichtung nach Datengranularität

| Datenlage | NHK-Gewicht | IS24-Gewicht |
|-----------|-------------|--------------|
| Stadtteil-Daten (hohe Auflösung) | 40% | 60% |
| Stadt-Durchschnitt | 60% | 40% |
| Kein IS24 / Landkreis-Fallback | 100% | 0% |

### Baujahr-basierte Anpassung

| Baujahr | Anpassung | Grund |
|---------|-----------|-------|
| < 1970 | NHK-Gewicht −10pp (min 25%) | NHK unterschätzt systematisch bei Altbauten |
| > 2015 | NHK-Gewicht −5pp (min 30%) | NHK × hoher BPI kann überschätzen |
| 1970–2015 | keine Anpassung | Standard-Verhalten |

### Divergenz-Korrektur

Wenn NHK-Sachwert und IS24-Gesamtwert > 40% auseinanderliegen:

| Situation | Anpassung |
|-----------|-----------|
| NHK > IS24 (konservativ) | NHK-Gewicht +10pp (max 80%) |
| NHK < IS24 + Stadtteil-Daten | NHK-Gewicht −10pp (min 25%) |
| NHK < IS24 + nur Stadt-Durchschnitt | NHK-Gewicht +10pp (max 80%) |

### Blend-Formel

```
Immobilienwert = IS24-Gesamtwert × (1 - nhkWeight) + NHK-Sachwert × nhkWeight
```

### Landesdurchschnitt-Kalibrierung (ohne IS24)

Wenn kein Marktpreis verfügbar und NHK > 10% unter Landesdurchschnitt:
```
Immobilienwert = 70% NHK-Sachwert + 30% Landesdurchschnitt
```

---

## 11. Ertragswertverfahren

Implementierung: `src/utils/ertragswert.ts`

Das Ertragswertverfahren (ImmoWertV §§ 27-34) berechnet den Renditewert basierend auf Mieteinnahmen. Es dient als **Cross-Validation** und wird nicht direkt als Hauptmethode verwendet.

### Wann wird es berechnet?

- Mietdaten vorhanden (`haus_miete_preis` oder `wohnung_miete_preis` aus ImmoScout)
- Bodenwert berechenbar (BRW vorhanden)

### Formel

```
Jahresrohertrag = Mietpreis/m² × 12 × Wohnfläche
Bewirtschaftungskosten = Rohertrag × BewKostenQuote (II. BV §26)
Jahresreinertrag = Rohertrag - Bewirtschaftungskosten
Bodenwertverzinsung = Bodenwert × Liegenschaftszins
Gebäudereinertrag = Reinertrag - Bodenwertverzinsung
Gebäudeertragswert = Gebäudereinertrag × Vervielfältiger
Ertragswert = Bodenwert + Gebäudeertragswert
```

### Liegenschaftszinssätze (BRW-abhängig)

Die Zinssätze basieren auf BewG § 256 und werden nach BRW interpoliert:

| Gebäudetyp | Bereich | Hoher BRW (>200) | Niedriger BRW (<60) |
|------------|---------|------------------|---------------------|
| EFH/ZFH | 1,5–3,5% | Unteres Ende | Oberes Ende |
| ETW | 2,0–4,0% | Unteres Ende | Oberes Ende |
| MFH | 3,0–5,5% | Unteres Ende | Oberes Ende |

### Verwendung im Bewertungsflow

- **Wohnungen**: 80% Vergleichswert + 20% Ertragswert
- **Häuser**: Ertragswert als Cross-Check gegen Sachwert-Blend (siehe [Plausibilitätsprüfung](#15-plausibilitätsprüfung-4-signal), Signal 2)

---

## 12. Stichtag-Korrektur (Bundesbank)

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

## 13. Stadtteil-Marktdaten

ImmoScout-Marktdaten werden wenn möglich auf Stadtteil-Ebene abgerufen.

### IS24-Fallback-Kette

```
1. Stadt-Atlas (normalisierter Stadtname) → Hit? → fertig
2. Slug-Varianten (Bad/Sankt/Neustadt) → Hit? → fertig
3. Landkreis-Atlas → Hit? → fertig
4. IS24-Listing-Suche → Hit? → fertig
5. null (kein Marktpreis)
```

### Stadtnamen-Normalisierung

Nominatim liefert offizielle Präfixe, die IS24 nicht kennt. Funktion `normalizeCityForIS24()` entfernt:

- "Hansestadt Lübeck" → "Lübeck"
- "Universitätsstadt Tübingen" → "Tübingen"
- "Bundesstadt Bonn" → "Bonn"
- "Landeshauptstadt München" → "München"

### District-Level Matching

1. `scrapeImmoScoutDistricts(bundesland, stadt)` → Stadtteil-Liste
2. Matching gegen `geo.district` (aus Nominatim):
   - Exakter Match → Stadtteil-Daten
   - Partial Match → Stadtteil-Daten
   - Kein Match → City-Level

---

## 14. Konfidenz & Spanne

| Methode | BRW-Qualität | Konfidenz | Spread |
|---------|-------------|-----------|--------|
| `sachwert-lite` | Offizieller BRW | `hoch` | ±8% |
| `sachwert-lite` | Geschätzter BRW | `mittel` | ±15% |
| `vergleichswert` | (irrelevant) | `mittel` | ±12% |
| `marktpreis-indikation` | (irrelevant) | `mittel` | ±15% |
| Fallback (kein IS24) | (irrelevant) | `gering` | ±20% |

---

## 15. Plausibilitätsprüfung (4-Signal)

Nach der Hauptberechnung läuft eine **iterative Validierungsschleife** (max. 3 Iterationen), die den Wert automatisch korrigiert.

### Signal 1: Gebäudewert/m² im NHK-Bereich?

```
Wenn Gebäudewert/m² > 4.000 €/m² → auf Maximum deckeln
```

### Signal 2: Ertragswert-Abgleich (stärkstes Signal)

```
Wenn Sachwert > 25% vom Ertragswert abweicht:
  Pull-Stärke = min(40%, 25% + (Abweichung - 25%) × 30%)
  Korrektur = Sachwert × (1 - Pull) + Ertragswert × Pull
```

Graduierte Korrektur: Je stärker die Abweichung, desto stärker der Pull zum Ertragswert (max. 40%).

### Signal 3: Bodenwertanteil plausibel?

```
Wenn Bodenwertanteil > 70% (Haus):
  Gesamtwert mindestens 1,5× Bodenwert
```

### Signal 4: qm-Preis im Landesrahmen?

```
Untergrenze = Landesdurchschnitt × 20%
Obergrenze = Landesdurchschnitt × 300%
Werte außerhalb werden auf die Grenze geclampt.
```

**Bodenwert-Floor:** Der Cap darf den Gesamtwert **nie unter den Bodenwert** drücken. Bei extrem hohen BRW (z.B. 8.500 €/m² in Berlin-Mitte) übersteigt allein der Bodenwert/m² Wohnfläche jeden sinnvollen Wohnpreis-Cap.

```
Mindest-Gebäudewert = Wohnfläche × 500 €/m² (absolutes Minimum)
Bodenwert-Floor = Bodenwert + Mindest-Gebäudewert
Gesamtwert = max(Cap-Wert, Bodenwert-Floor)
```

Landesdurchschnitte sind für alle 16 Bundesländer hinterlegt (getrennt nach Haus/Wohnung).

### Finale Invariante: Gesamtwert ≥ Bodenwert

Nach der 4-Signal-Schleife wird sichergestellt, dass ein bebautes Grundstück nie weniger wert sein kann als das unbebaute:

```
Wenn istHaus UND Bodenwert > 0 UND Gesamtwert ≤ Bodenwert:
  Mindest-Gebäudewert = Wohnfläche × 500 €/m²
  Gesamtwert = Bodenwert + Mindest-Gebäudewert
```

**Beispiel Berlin-Mitte (BRW 8.500 €/m², 450 m² Grundstück, 138 m² Wohnfläche):**

| Schritt | Vorher (Bug) | Nachher (Fix) |
|---------|-------------|---------------|
| Bodenwert | 3.825.000 € | 3.825.000 € |
| Signal 3 hebt auf | 5.737.500 € | 5.737.500 € |
| Signal 4 deckelt auf | 1.580.952 € | 3.894.340 € (Floor!) |
| Gebäudewert | 0 € | 69.340 € |

---

## 16. KI-Recherche bei schlechter Datenlage

Implementierung: `src/utils/ai-research.ts`

Wenn die Datenlage schlecht ist, wird automatisch eine KI-gestützte Web-Recherche gestartet, um fehlende Bodenrichtwerte und Marktdaten zu ergänzen.

### Trigger-Bedingungen

| Trigger | Beispiel |
|---------|----------|
| Kein BORIS-BRW | Bayern, Baden-Württemberg |
| Keine IS24-Marktdaten | Kleine Gemeinden < 10.000 Einwohner |
| Fallback-Adapter aktiv | Bundesland ohne WFS-Dienst |

### Recherche-Ablauf

1. **Claude + Web-Search** recherchiert synchron (Timeout: 20s):
   - Lokale Bodenrichtwerte (Gutachterausschuss-Berichte, Gemeinde-Websites)
   - Vergleichsobjekte (ImmoScout/Immowelt Listings)
   - Lokale Marktberichte (Sparkassen, IVD, Gutachterausschuss-Jahresberichte)
   - Gemeinde-spezifische Faktoren (Einwohnerzahl, Infrastruktur)

2. **Synthetische Daten** werden aus den Recherche-Ergebnissen erstellt:
   - Synthetischer BRW (wenn kein offizieller verfügbar)
   - Synthetische Marktdaten (Vergleichspreise pro m²)

### Konfiguration

| Env-Variable | Default | Beschreibung |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | API-Key (ohne Key → Recherche deaktiviert) |
| `RESEARCH_MODEL` | `claude-sonnet-4-5-20250929` | Modell für Recherche |
| `RESEARCH_TIMEOUT_MS` | `20000` | Timeout (max 5 Web-Suchen) |

### Confidence-Level

Recherche-basierte Daten erhalten `confidence: "research"` in der Response (statt `"high"` für offizielle oder `"estimated"` für IS24-basierte Daten).

---

## 17. KI-Validierung (LLM)


Implementierung: `src/llm-validator.ts`

Nach der deterministischen Bewertung + Plausibilitätsprüfung wird das Ergebnis an **Claude Sonnet** gesendet, der als KI-Sachverständiger die Plausibilität prüft.

### Architektur

```
buildBewertung()        → Deterministische Bewertung
     ↓
validateBewertung()     → Claude prüft Ergebnis
     ↓
applyLLMCorrection()    → Auto-Korrektur bei Auffälligkeiten
     ↓
Response mit bewertung + validation
```

### Prompt-Design

Das LLM erhält:
- Alle Eingabedaten (Adresse, Bundesland, Objektdaten)
- Bodenrichtwert (Wert, Stichtag, offiziell/geschätzt)
- Bewertungsergebnis (Wert, Spanne, Methode, Konfidenz)
- Alle Korrekturfaktoren
- Bestehende Hinweise

Rollenpriming: *"Du bist ein erfahrener Immobilien-Sachverständiger (§ 198 BewG, ImmoWertV 2022)."*

### Bewertungsstufen

| Status | Bedeutung | Schwelle |
|--------|-----------|----------|
| `plausibel` | Wert im erwartbaren Bereich für Lage/Alter/Zustand | < 10% Abweichung |
| `auffaellig` | Leichte Abweichung, könnte noch stimmen | 10–25% |
| `unplausibel` | Starke Abweichung, widerspricht Marktkenntnis | > 25% |

### ValidationResult-Objekt

```typescript
interface ValidationResult {
  status: 'plausibel' | 'auffaellig' | 'unplausibel' | 'fehler' | 'deaktiviert';
  confidence: number;           // 0.0 – 1.0
  bewertung_angemessen: boolean;
  abweichung_einschaetzung: string | null;
  empfohlener_wert: number | null;
  hinweise: string[];           // Max 3
  modell: string;
  dauer_ms: number;
}
```

### Konfiguration

| Env-Variable | Default | Beschreibung |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | API-Key (ohne Key → Validierung deaktiviert) |
| `LLM_MODEL` | `claude-sonnet-4-5-20250929` | Modell |
| `LLM_TIMEOUT_MS` | `8000` | Timeout in ms |

### Sicherheitsnetze

- **Kein API-Key** → `status: "deaktiviert"`, Bewertung unverändert
- **Timeout** → `status: "fehler"`, Bewertung unverändert
- **API-Fehler** → `status: "fehler"`, Bewertung unverändert
- **24h In-Memory-Cache** → gleiche Input+Ergebnis-Kombination nur einmal geprüft

### Kosten

~0.6–0.8 Cent pro Validierung (Sonnet 4.5: ~1.000 Input-Tokens, ~200 Output-Tokens).

---

## 18. KI-Auto-Korrektur

Wenn das LLM eine Auffälligkeit erkennt **und** einen `empfohlener_wert` liefert, wird der Bewertungswert automatisch korrigiert.

### Korrektur-Regeln

| LLM-Status | Min. Confidence | Blend-Stärke | Beschreibung |
|---|---|---|---|
| `plausibel` | — | 0% | Keine Korrektur |
| `auffaellig` | ≥ 0.70 | **30%** Richtung LLM | Leichte Anpassung |
| `unplausibel` | ≥ 0.75 | **50%** Richtung LLM | Stärkere Anpassung |
| `fehler` / `deaktiviert` | — | 0% | Keine Korrektur |

### Blend-Formel

```
korrigierter_Wert = Original × (1 - blendWeight) + LLM-Empfehlung × blendWeight
```

### Sicherheitsnetze

| Bedingung | Verhalten |
|-----------|-----------|
| Kein `empfohlener_wert` | Keine Korrektur |
| LLM-Wert < 20% oder > 500% des Originals | Ignoriert (Sanity-Check) |
| Confidence unter Schwelle | Keine Korrektur |

### Transparenz

Bei Korrektur wird ein Hinweis hinzugefügt:

> „KI-Korrektur (auffaellig): Wert um 12% angehoben (300.000 → 336.000 €, Blend 30% LLM-Empfehlung, Confidence 85%)."

Und `KI-Validierung (claude-sonnet-4-5-20250929)` wird zu den Datenquellen hinzugefügt.

### Beispiel

```
Deterministische Bewertung:  300.000 €
LLM-Empfehlung:              380.000 € (status: "unplausibel", confidence: 0.88)
Blend (50%):                  300k × 0.5 + 380k × 0.5 = 340.000 €
→ Response: 340.000 € mit transparentem Hinweis
```

---

## 19. Cross-Validation

Wenn **beide** Datenquellen verfügbar sind (BRW + ImmoScout), wird eine Plausibilitätsprüfung durchgeführt:

```
reiner_Marktwert = Marktpreis_pro_m² × Wohnfläche
Abweichung = |Immobilienwert - reiner_Marktwert| / reiner_Marktwert
```

Bei Abweichung > 25%:

> „Sachwert-Ergebnis weicht X% vom reinen Marktpreis ab. Manuelle Prüfung empfohlen."

---

## 20. NRW Immobilienrichtwerte

Für Adressen in Nordrhein-Westfalen wird der **BORIS-NRW Immobilienrichtwert** (IRW) als zusätzliche Cross-Validation abgerufen.

Implementierung: `src/utils/nrw-irw.ts`

### Datenquelle

- WMS: `https://www.wms.nrw.de/boris/wms_nw_irw`
- Fallback: `https://www.wms.nrw.de/boris/wms-t_nw_irw` (ab 2011)
- Lizenz: Datenlizenz Deutschland – Zero – Version 2.0

### Cross-Validation

| Abweichung | Hinweis |
|------------|---------|
| ≤ 25% | „NRW Immobilienrichtwert bestätigt Bewertung." |
| > 25% | „Erhebliche Abweichung zum NRW Immobilienrichtwert. Manuelle Prüfung empfohlen." |

---

## 21. Hinweise-System

Automatisch generierte Warnungen im `hinweise[]`-Array:

| # | Quelle | Bedingung | Hinweis |
|---|--------|-----------|---------|
| 1 | Input | Baujahr/Wohnfläche/Grundstück unplausibel | „{Feld} liegt außerhalb des plausiblen Bereichs." |
| 2 | Overlap | Neubau + Modernisierung positiv | „Neubau-Zuschlag schließt Modernisierungs-Bonus ein." |
| 3 | Sachwert | Bodenwert > Markt-Gesamtwert | „Grundstücksanteil dominiert den Gesamtwert." |
| 4 | NHK | Kein Marktpreis → NHK berechnet | NHK-Berechnungsdetails |
| 5 | NHK | Modernisierung verlängert RND | „Restnutzungsdauer von X auf Y Jahre verlängert." |
| 6 | Blend | NHK-IS24 Divergenz > 40% | „IS24-Marktpreis weicht X% vom NHK-Sachwert ab." |
| 7 | Blend | Blend-Gewichtung | „Sachwert-Blend: X% NHK / Y% Markt." |
| 8 | Stichtag | BRW mit Bundesbank-Index korrigiert | „Marktanpassung +X% (Bundesbank)." |
| 9 | Cross | Sachwert vs. Marktpreis > 25% | „Manuelle Prüfung empfohlen." |
| 10 | NRW | IRW Cross-Validation | „NRW Immobilienrichtwert bestätigt/weicht ab." |
| 11 | Ertragswert | Ertragswert berechnet | Details zu Rohertrag, LiZi, Vervielfältiger |
| 12 | Plausibilität | 4-Signal-Korrektur angewandt | „Plausibilitätskorrektur: {Details}." |
| 13 | Plausibilität | Bodenwert-Floor in Signal 4 aktiv | „Bodenwert bildet den Mindestpreis. Gebäudewert auf X € geschätzt." |
| 14 | Invariante | Gesamtwert ≤ Bodenwert | „Invariante-Korrektur: Mindest-Gebäudewert X € addiert." |
| 15 | KI | LLM-Korrektur angewandt | „KI-Korrektur ({status}): Wert um X% {richtung}." |
| 16 | Stadtteil | Stadtteil-Match vorhanden | „Marktpreise basieren auf Stadtteil-Daten." |
| 17 | Stadtteil | Kein Match → Stadtdurchschnitt | „Lage-spezifische Abweichungen möglich." |

---

## 22. Bericht-Objekt (PDFMonkey)

Implementierung: `buildBericht()` in `src/index.ts`

Das `bericht`-Objekt wird **nach allen Korrekturschleifen** (Plausibilität + KI-Validierung) erzeugt und enthält die finalen Werte in einem flachen Format, das direkt in PDFMonkey-Templates gemappt werden kann.

### Warum ein separates Objekt?

Die detaillierten `bewertung`-, `bodenrichtwert`- und `input_echo`-Objekte sind verschachtelt und enthalten Debug-Informationen. Für den PDF-Report braucht Zapier ein **flaches** Objekt mit lesbaren Werten — ohne Nesting, ohne Score-Nummern, ohne Null-Checks.

### Alle Felder

| Feld | Typ | Beschreibung | Beispiel |
|------|-----|-------------|----------|
| **Adresse** | | | |
| `Strasse` | `string` | Straße + Hausnummer | `"Unter den Linden 1"` |
| `PLZ` | `string` | Postleitzahl | `"10117"` |
| `Ort` | `string` | Stadt/Gemeinde | `"Berlin"` |
| `Bundesland` | `string` | Bundesland | `"Berlin"` |
| `Stadtteil` | `string` | Stadtteil (wenn verfügbar) | `"Mitte"` |
| `Standortbeschreibung` | `string` | Fließtext mit Lage + Marktdaten-Quelle | `"Mitte, Berlin. Marktdaten: ..."` |
| **Immobilie** | | | |
| `Immobilienart` | `string` | Art der Immobilie | `"Haus"` |
| `Objektunterart` | `string` | Objekttyp | `"Einfamilienhaus"` |
| `Baujahr` | `number \| null` | Baujahr | `1985` |
| `Wohnflaeche` | `number \| null` | Wohnfläche in m² | `138.68` |
| `Grundstuecksflaeche` | `number \| null` | Grundstücksfläche in m² | `450` |
| `Modernisierung` | `string` | Lesbarer Text (aus Score konvertiert) | `"Kernsanierung / Neuwertig"` |
| `Energie` | `string` | Lesbarer Text | `"Sehr gut"` |
| `Ausstattung` | `string` | Lesbarer Text | `"Gehoben"` |
| **Preise pro m²** | | | |
| `Preis_qm` | `number` | Realistischer qm-Preis | `2121` |
| `QMSpanne_Untergrenze` | `number` | Min qm-Preis | `1909` |
| `QMSpanne_Mittelwert` | `number` | = `Preis_qm` | `2121` |
| `QMSpanne_Obergrenze` | `number` | Max qm-Preis | `2333` |
| **Gesamtpreise** | | | |
| `Preis` | `number` | Realistischer Gesamtwert | `275000` |
| `Spanne_Untergrenze` | `number` | Min Gesamtwert | `247500` |
| `Spanne_Mittelwert` | `number` | = `Preis` | `275000` |
| `Spanne_Obergrenze` | `number` | Max Gesamtwert | `302500` |
| **Wertkomponenten** | | | |
| `Bodenwert` | `number` | BRW × Grundstücksfläche | `42500` |
| `Gebaeudewert` | `number` | Gesamtwert − Bodenwert | `232500` |
| `Ertragswert` | `number \| null` | Ertragswert (wenn berechnet) | `289000` |
| **Bodenrichtwert** | | | |
| `Bodenrichtwert` | `number` | BRW in €/m² | `85` |
| `Bodenrichtwert_Stichtag` | `string` | Stichtag des BRW | `"2024-01-01"` |
| `Bodenrichtwert_Zone` | `string` | BRW-Zone | `"Simmern Kernstadt"` |
| `Bodenrichtwert_Nutzungsart` | `string` | Nutzungsart | `"Wohnbaufläche"` |
| `Bodenrichtwert_Quelle` | `string` | Datenquelle | `"BORIS-RP"` |
| `Bodenrichtwert_Confidence` | `string` | Lesbarer Confidence-Text | `"Offiziell (BORIS)"` |
| **Qualität** | | | |
| `BKI_Ampelklasse` | `string` | Farbcode für Report | `"gruen"` / `"gelb"` / `"rot"` |
| `Konfidenz` | `string` | Konfidenz-Level | `"hoch"` / `"mittel"` / `"gering"` |
| `Bewertungsmethode` | `string` | Verwendete Methode | `"sachwert-lite"` |

### Score-zu-Label Konvertierung

Scores (1-5) werden automatisch in lesbare Texte umgewandelt:

| Score | Modernisierung | Energie | Ausstattung |
|-------|---------------|---------|-------------|
| 5 | Kernsanierung / Neuwertig | Sehr gut | Stark gehoben |
| 4 | Umfassend modernisiert | Gut | Gehoben |
| 3 | Teilweise modernisiert | Durchschnittlich | Mittel |
| 2 | Nur einzelne Maßnahmen | Eher schlecht | Einfach |
| 1 | Keine Modernisierungen | Sehr schlecht | Schlecht |

Werden Text-Beschreibungen statt Scores gesendet, werden diese direkt übernommen.

### BKI_Ampelklasse Mapping

| Konfidenz | Ampelfarbe | Bedeutung |
|-----------|-----------|-----------|
| `hoch` | `gruen` | Gute Datenlage, hohe Zuverlässigkeit |
| `mittel` | `gelb` | Eingeschränkte Daten oder Schätzwerte |
| `gering` | `rot` | Geschätzte Werte, Vorsicht geboten |

### Bodenrichtwert_Confidence

| Quelle | Label |
|--------|-------|
| Offizieller BORIS-WFS | `"Offiziell (BORIS)"` |
| ImmoScout-basierte Schätzung | `"Schätzwert (ImmoScout-basiert)"` |
| KI-Recherche via Web-Suche | `"KI-Recherche (geschätzt)"` |
| Kein BRW verfügbar | `"Nicht verfügbar"` |

### Zapier-Mapping

In Zapier kann jedes Feld direkt gemappt werden:

```
PDFMonkey-Variable  →  Zapier-Path
Preis               →  bericht.Preis
QMSpanne_Untergrenze→  bericht.QMSpanne_Untergrenze
Modernisierung      →  bericht.Modernisierung
BKI_Ampelklasse     →  bericht.BKI_Ampelklasse
Bodenrichtwert      →  bericht.Bodenrichtwert
...
```

Alle Felder sind **immer** vorhanden (mit Fallback-Werten wie `""`, `0` oder `"Nicht angegeben"`), sodass Zapier-Mappings nie fehlschlagen.

---

## 23. Ausgabeformat

### Bewertung-Objekt

```typescript
interface Bewertung {
  realistischer_qm_preis: number;
  qm_preis_spanne: { min: number; max: number };
  realistischer_immobilienwert: number;
  immobilienwert_spanne: { min: number; max: number };
  bodenwert: number;
  gebaeudewert: number;
  ertragswert: number | null;
  bewertungsmethode: 'sachwert-lite' | 'marktpreis-indikation' | 'vergleichswert';
  konfidenz: 'hoch' | 'mittel' | 'gering';
  faktoren: BewertungFaktoren;
  hinweise: string[];
  datenquellen: string[];
}
```

### Validation-Objekt

```typescript
interface ValidationResult {
  status: 'plausibel' | 'auffaellig' | 'unplausibel' | 'fehler' | 'deaktiviert';
  confidence: number;
  bewertung_angemessen: boolean;
  abweichung_einschaetzung: string | null;
  empfohlener_wert: number | null;
  hinweise: string[];
  modell: string;
  dauer_ms: number;
}
```

### Beispiel-Response (Sachwert-lite + KI-Validierung)

```json
{
  "bewertung": {
    "realistischer_qm_preis": 2179,
    "qm_preis_spanne": { "min": 2005, "max": 2353 },
    "realistischer_immobilienwert": 305000,
    "immobilienwert_spanne": { "min": 280600, "max": 329400 },
    "bodenwert": 50400,
    "gebaeudewert": 254600,
    "ertragswert": 289000,
    "bewertungsmethode": "sachwert-lite",
    "konfidenz": "hoch",
    "faktoren": {
      "baujahr": -0.12,
      "modernisierung": -0.02,
      "energie": -0.01,
      "ausstattung": 0,
      "objektunterart": -0.05,
      "grundstueck": 0,
      "neubau": 0,
      "stichtag_korrektur": 0.03,
      "gesamt": -0.17
    },
    "hinweise": [
      "Sachwert-Blend: 50% NHK (278.000 €) / 50% Markt (332.000 €) [Stadt-Durchschnitt].",
      "Ertragswert bestätigt Bewertung: 289.000 € (Abweichung 5%, LiZi 3.2%)."
    ],
    "datenquellen": [
      "BORIS/WFS Bodenrichtwert",
      "NHK 2010 (ImmoWertV 2022)",
      "Destatis Baupreisindex",
      "ImmoScout24 Atlas Marktpreise",
      "Ertragswertverfahren (ImmoWertV §§ 27-34)",
      "Bundesbank Wohnimmobilienpreisindex"
    ]
  },
  "validation": {
    "status": "plausibel",
    "confidence": 0.92,
    "bewertung_angemessen": true,
    "abweichung_einschaetzung": null,
    "empfohlener_wert": null,
    "hinweise": [
      "Wert liegt im erwartbaren Bereich für eine DHH BJ1986 in B-Lage NRW."
    ],
    "modell": "claude-sonnet-4-5-20250929",
    "dauer_ms": 1847
  }
}
```

### Datenquellen (vollständige Liste)

| Quelle | Wann verwendet |
|--------|---------------|
| `BORIS/WFS Bodenrichtwert` | BRW vorhanden und genutzt |
| `ImmoScout24 Atlas Marktpreise` | Marktpreise verfügbar |
| `NHK 2010 (ImmoWertV 2022)` | Gebäudewert berechnet |
| `Destatis Baupreisindex` | BPI live abgerufen |
| `Bundesbank Wohnimmobilienpreisindex` | Stichtag-Korrektur mit echtem Index |
| `Ertragswertverfahren (ImmoWertV §§ 27-34)` | Ertragswert berechnet |
| `Vergleichswertverfahren (ImmoWertV § 15)` | Vergleichswert für Wohnungen |
| `BORIS-NRW Immobilienrichtwerte` | IRW Cross-Validation (nur NRW) |
| `Landesdurchschnitt {Bundesland}` | NHK-Kalibrierung ohne IS24 |
| `Plausibilitätsprüfung (Auto-Korrektur)` | 4-Signal-Korrektur angewandt |
| `KI-Recherche (Web-Suche)` | Synthetischer BRW/Marktdaten aus Web-Recherche |
| `KI-Validierung (claude-sonnet-4-5-20250929)` | LLM-Korrektur angewandt |

---

## Ablaufdiagramm

```
POST /api/enrich (mit wohnflaeche, baujahr, etc.)
  │
  ├─ Geocoding (Nominatim) → lat/lon + Bundesland + Stadt + Stadtteil
  │
  ├─ Parallel starten:
  │   ├─ BRW: State Router → WFS-Adapter → Bodenrichtwert
  │   ├─ IS24: Stadt-Atlas → Slug-Varianten → Landkreis → IS24-Suche → District
  │   ├─ Bundesbank Preisindex
  │   ├─ Destatis Baupreisindex
  │   └─ NRW IRW (nur Nordrhein-Westfalen)
  │
  ├─ KI-Recherche (wenn BRW oder IS24 fehlen)
  │   └─ Claude + Web-Search → Synthetischer BRW + Marktdaten
  │
  ├─ Gate: wohnflaeche vorhanden?  ──── Nein ──→ bewertung: null
  │
  ├─ Input-Validierung (Hinweise für Extremwerte)
  │
  ├─ Gate: Datenquelle verfügbar?  ──── Nein ──→ bewertung: null
  │
  ├─ Immobilienart erkennen (Haus vs. Wohnung)
  ├─ Lage-Cluster bestimmen (A/B/C)
  │
  ├─ Marktpreis wählen (haus_kauf / wohnung_kauf)
  │   └─ Stadtteil-Daten bevorzugt (→ City-Fallback)
  │
  ├─ 7 Korrekturfaktoren berechnen (lage-abhängig)
  ├─ Overlap-Korrekturen (Neubau vs. Baujahr/Modernisierung)
  ├─ Gesamtfaktor summieren
  │
  ├─ Methode wählen
  │   ├─ Wohnung + Marktdaten → Vergleichswert (ggf. +20% Ertragswert)
  │   ├─ Haus + BRW + Grundstück → Sachwert-lite (NHK-IS24 Blend)
  │   └─ Sonst → Marktpreis-Indikation
  │
  ├─ Ertragswert berechnen (wenn Mietdaten vorhanden)
  │
  ├─ Plausibilitätsprüfung (4 Signale, max 3 Iterationen)
  │   ├─ Signal 1: Gebäudewert/m² im NHK-Bereich?
  │   ├─ Signal 2: Ertragswert-Abgleich (graduierter Pull)
  │   ├─ Signal 3: Bodenwertanteil < 70%?
  │   └─ Signal 4: qm-Preis im Landesrahmen? (mit Bodenwert-Floor)
  │
  ├─ Finale Invariante: Gesamtwert ≥ Bodenwert + Mindest-Gebäudewert
  │
  ├─ Cross-Validation (Marktpreis + NRW IRW)
  │
  ├─ Konfidenz + Spread bestimmen
  ├─ Wertspannen berechnen (±spread)
  │
  ├─ KI-Validierung (Claude Sonnet)
  │   ├─ Cache-Hit? → Ergebnis sofort
  │   └─ API-Aufruf → JSON-Antwort parsen
  │
  ├─ KI-Auto-Korrektur (wenn auffällig/unplausibel + empfohlener_wert)
  │   └─ Graduierter Blend (30% oder 50% Richtung LLM)
  │
  ├─ buildBericht() → flaches PDFMonkey-Objekt mit finalen Werten
  │
  └─ Response: bewertung + validation + bericht + research
```
