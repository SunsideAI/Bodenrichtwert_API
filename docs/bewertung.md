# Bewertungsmethodik

Technische Dokumentation des Bewertungsmoduls (`src/bewertung.ts`).

Das Modul liefert das `bewertung`-Feld in der API-Response von `POST /api/enrich`. Es kombiniert Bodenrichtwerte (BORIS/WFS) mit ImmoScout24-Atlas-Marktpreisen und berechnet daraus einen realistischen Immobilienwert inklusive Wertspanne, Konfidenz und Hinweisen.

---

## Inhaltsverzeichnis

1. [Eingabeparameter](#1-eingabeparameter)
2. [Gate-Checks](#2-gate-checks)
3. [Methodenwahl](#3-methodenwahl)
4. [Korrekturfaktoren](#4-korrekturfaktoren)
5. [Overlap-Korrekturen](#5-overlap-korrekturen)
6. [Berechnungsformeln](#6-berechnungsformeln)
7. [Konfidenz & Spanne](#7-konfidenz--spanne)
8. [Cross-Validation](#8-cross-validation)
9. [Hinweise-System](#9-hinweise-system)
10. [Ausgabeformat](#10-ausgabeformat)

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

## 2. Gate-Checks

Die Bewertung gibt `null` zurück wenn:

1. **Wohnfläche fehlt** — `wohnflaeche` ist `null`, `undefined` oder `<= 0`
2. **Keine Datenquelle verfügbar** — weder Marktpreise (ImmoScout) noch Bodenrichtwert (BRW mit `wert > 0`) vorhanden

---

## 3. Methodenwahl

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

## 4. Korrekturfaktoren

Alle Faktoren werden **additiv** zum Gesamtfaktor summiert:

```
gesamt = baujahr + modernisierung + energie + ausstattung + objektunterart + neubau + stichtag_korrektur
```

Der Grundstücksfaktor ist immer 0, da der Bodenwert über den BRW abgebildet wird.

### 4.1 Baujahr

| Baujahr | Faktor |
|---------|--------|
| `>= 2020` | `0.00` (Neubau-Faktor übernimmt) |
| `< 1950` | `-0.10` |
| `1950–1979` | `-0.08` |
| `1980–1999` | `-0.04` |
| `2000–2010` | `0.00` |
| `2011–2019` | `+0.03` |
| `null` | `0.00` |

### 4.2 Modernisierung

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

### 4.3 Energie

| Score | Text | Faktor | Beispiel-Klassen |
|-------|------|--------|-----------------|
| 5 | `"sehr gut"` | `+0.03` | A+, A |
| 4 | `"gut"` | `0.00` | B |
| 3 | `"durchschnittlich"` | `-0.01` | C, D |
| 2 | `"eher schlecht"` | `-0.03` | E, F |
| 1 | `"sehr schlecht"`, `"schlecht"` | `-0.06` | G, H |
| — | Unbekannt | `0.00` | — |

### 4.4 Ausstattung

| Score | Text | Faktor |
|-------|------|--------|
| 5 | `"stark gehoben"`, `"luxus"` | `+0.05` |
| 4 | `"gehoben"` | `+0.03` |
| 3 | `"mittel"`, `"normal"`, `"standard"` | `0.00` |
| 2 | `"einfach"` | `-0.03` |
| 1 | `"schlecht"` | `-0.05` |
| — | Unbekannt | `0.00` |

### 4.5 Objektunterart

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

### 4.6 Neubau-Zuschlag

| Baujahr | Faktor |
|---------|--------|
| `>= 2020` | `+0.10` |
| `< 2020` oder `null` | `0.00` |

### 4.7 Stichtag-Korrektur

Korrigiert den BRW wenn der Stichtag mehr als 2 Jahre zurückliegt.

```
Alter in Jahren = (heute - BRW-Stichtag) / 365.25
Wenn Alter > 2: Korrektur = (Alter - 2) * 0.025
Sonst: Korrektur = 0
```

**Beispiel:** BRW-Stichtag 4 Jahre alt → `(4 - 2) × 0.025 = +0.05` (+5%)

---

## 5. Overlap-Korrekturen

### 5.1 Baujahr + Neubau

Für Baujahr >= 2020 gibt `calcBaujahrFaktor` `0` zurück, da der `calcNeubauFaktor` (+0.10) den Zeitwertbonus bereits vollständig abdeckt. Ohne diese Korrektur würden +0.03 (Baujahr > 2010) und +0.10 (Neubau) doppelt gezählt.

### 5.2 Neubau + Modernisierung

Ein Neubau (>= 2020) ist per Definition neuwertig. Wenn sowohl `neubau > 0` als auch `modernisierung > 0`, wird der Modernisierungs-Bonus auf 0 gesetzt und ein Hinweis erzeugt:

> „Neubau-Zuschlag schließt Modernisierungs-Bonus ein. Faktor-Überlapp wurde korrigiert."

Negative Modernisierungswerte (theoretischer Sonderfall) bleiben erhalten.

---

## 6. Berechnungsformeln

### 6.1 Sachwert-lite

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

**Gebäudewert (ohne Marktdaten):**
```
Gebäudewert = round(Bodenwert × 1.5 × (1 + Gesamtfaktor))
```
Basiert auf einem angenommenen Verhältnis von ca. 60:40 (Gebäude:Boden).

**Immobilienwert:**
```
Immobilienwert = Bodenwert + Gebäudewert
m²-Preis = round(Immobilienwert / Wohnfläche)
```

### 6.2 Marktpreis-Indikation

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

### 6.3 Wertspanne

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

## 7. Konfidenz & Spanne

Die Konfidenz-Stufe und der Spread hängen von Bewertungsmethode und BRW-Qualität ab.

| Methode | BRW-Qualität | Konfidenz | Spread |
|---------|-------------|-----------|--------|
| `sachwert-lite` | Offizieller BRW | `hoch` | ±8% |
| `sachwert-lite` | Geschätzter BRW (`schaetzung = true`) | `mittel` | ±15% |
| `sachwert-lite` | Kein BRW / ungültig | `gering` | ±20% |
| `marktpreis-indikation` | (irrelevant) | `mittel` | ±15% |

Bei der `marktpreis-indikation` ist die BRW-Qualität irrelevant, da der BRW nicht in die Berechnung einfließt. Der Stadtdurchschnitt aus ImmoScout hat eine inhärente Unsicherheit von ca. ±15%.

---

## 8. Cross-Validation

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

## 9. Hinweise-System

Automatisch generierte Warnungen im `hinweise[]`-Array:

| # | Bedingung | Hinweis |
|---|-----------|---------|
| 1 | Neubau (>= 2020) + Modernisierung positiv | „Neubau-Zuschlag schließt Modernisierungs-Bonus ein. Faktor-Überlapp wurde korrigiert." |
| 2 | Bodenwert > Markt-Gesamtwert (Sachwert-lite) | „Bodenwert übersteigt Marktindikation. Grundstücksanteil dominiert den Gesamtwert." |
| 3 | Kein Marktpreis bei Sachwert-lite | „Gebäudewert ohne Marktdaten geschätzt (Verhältnis 60:40)." |
| 4 | BRW-Stichtag > 2 Jahre alt | „BRW-Stichtag {Datum} liegt >2 Jahre zurück. Marktanpassung +{X}% angewandt." |
| 5 | Cross-Validation > 25% Abweichung | „Sachwert-Ergebnis weicht {X}% vom reinen Marktpreis ab. Manuelle Prüfung empfohlen." |
| 6 | BRW ist Schätzwert (`schaetzung = true`) | „Bodenrichtwert ist ein Schätzwert (kein offizieller BRW). Genauigkeit eingeschränkt." |
| 7 | Marktpreis-Indikation ohne BRW | „Kein Bodenrichtwert verfügbar. Bewertung basiert ausschließlich auf ImmoScout Marktdaten." |
| 8 | Marktpreis-Indikation ohne Grundstücksfläche | „Grundstücksfläche fehlt. Aufteilung in Boden-/Gebäudewert nicht möglich." |
| 9 | **Immer** (letzter Hinweis) | „Marktpreise basieren auf Stadtdurchschnitt (ImmoScout24 Atlas). Lage-spezifische Abweichungen möglich." |

---

## 10. Ausgabeformat

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
| `ImmoScout24 Atlas (BRW-Schätzwert)` | BRW ist ein geschätzter Wert |

Datenquellen werden dedupliziert ausgegeben.

---

## Ablaufdiagramm

```
POST /api/enrich (mit wohnflaeche, baujahr, etc.)
  │
  ├─ Gate: wohnflaeche vorhanden?  ──── Nein ──→ bewertung: null
  │
  ├─ Gate: Datenquelle verfügbar?  ──── Nein ──→ bewertung: null
  │
  ├─ Immobilienart erkennen (Haus vs. Wohnung)
  │
  ├─ Marktpreis wählen (haus_kauf_preis / wohnung_kauf_preis)
  │
  ├─ 7 Korrekturfaktoren berechnen
  │   ├─ Baujahr
  │   ├─ Modernisierung (baujahr-abhängig)
  │   ├─ Energie
  │   ├─ Ausstattung
  │   ├─ Objektunterart
  │   ├─ Neubau (>= 2020)
  │   └─ Stichtag-Korrektur (BRW-Alter)
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
  │
  ├─ Konfidenz + Spread bestimmen
  │
  ├─ Wertspannen berechnen (±spread)
  │
  ├─ Cross-Validation (wenn beide Quellen verfügbar)
  │
  └─ Hinweise sammeln → Bewertung zurückgeben
```
