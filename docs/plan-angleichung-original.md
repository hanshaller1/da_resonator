# Bauplan: Angleichung an das Original (v3)

Stand: 10.10.2026. Grundlage ist das Handbuch V1, Abgleich in [abgleich-original.md](abgleich-original.md).

> **Zurückgestellt (10.10.2026):** Dieser Plan wird derzeit nicht umgesetzt. nukular hat entschieden, dass im aktuellen Schritt nur das Design neu gebaut wird; Klangkern, Engine und Parameter bleiben unverändert.
Ziel: Bedienung und Klangverhalten so nah wie möglich an der Resonant Filterbank. Was das Original nicht hat, entfällt.
Annahmen, die auch das Handbuch offen lässt, sind mit **(Annahme)** markiert.

## 1. Zielmodell

### 1.1 Parameter

**Stereo:** Jeder Parameter existiert für L und R (Handbuch S. 19/20: MIDI IN L CH / R CH). Ausnahmen sind Mix und Spread (MONO) sowie die analogen Regler Input und Volume. Die Oberfläche bearbeitet L und R gemeinsam, außer im FB CH-SELECT.

**Universell, pro Kanal:**

| Parameter | Bereich |
|---|---|
| `res` | Attenuverter −1 … +1 |
| `fb1` … `fb10` | Schalter |
| `fbAll` | Schalter |

**Universell, mono:**

| Parameter | Bereich |
|---|---|
| `mix` | 0 … 1 |
| `spread` | −1 … +1, Mitte = 12 Uhr |

**Analog** (nicht MIDI, nicht im Snapshot):

| Parameter | Bereich |
|---|---|
| `inputGain` | 0 … +24 dB |
| `volume` | Ausgangspegel |
| `bypass` | per Fußschalter |

**Modus:** `mode` = FB, FILTER, CLK oder DYN.

**FB, pro Kanal:**
- `band1` … `band10`: 0 … 1, Mitte 0,5 = flach.
- Pegelgesetz **(Annahme)**: oben +12 dB, unten stumm, Amplitude (2n)² in der unteren Hälfte.
- Gruppen BAND LOW/MID/HIGH/ALL als virtuelle Regler über die Bänder 1–3, 4–7, 8–10 und alle **(Annahme)**.

**FILTER, pro Kanal:**

| Parameter | Bereich / Werte |
|---|---|
| `cutoff` | Hz |
| `slope` | dB/Okt. |
| `width` | Hz |
| `type` | LP, HP, BP, BR |
| `gain` | 0 … 100 % |
| `offset` | 0 … 100 % |

Dazu Sperren für Band 1–10.

**CLK, pro Kanal:**

| Parameter | Bereich / Werte |
|---|---|
| `gain` | |
| `wave` | sine, square, triangle, saw, random |
| `freq` | |
| `dir` | fwd, bwd, ping-pong, random |
| `rate` | interner Takt bis 10 000 BPM bzw. MIDI-Faktor |
| `offset` | |
| `invR` | Schalter |

Dazu Sperren und die Taktquelle.

**DYN, pro Kanal:**

| Parameter | Bereich / Werte |
|---|---|
| `threshold` | |
| `decay` | |
| `attack` | |
| `delay` | |
| `filter` | OFF oder Frequenz |
| `source` | IN, OUT |
| `offset` | |

Dazu Sperren.

**Config, global, nicht im Snapshot:**
- Spread-Funktion: CLASSIC oder FB CH-SELECT.
- Resonanz-Kennlinie.
- MIDI-Kanäle IN, IN L, IN R und OUT-Modus.
- Fußschalter: Aktion für kurz und für Halten.
- Emulation: Toleranzen und Drift, der bisherige Regler „Analog“.

### 1.2 Klangkern (DSP)

**Bänder:**
- Pro Kanal 10 TPT-Bandpässe mit fester Güte **Q = 0,7**. Das entspricht 16,9 dB eine Dekade neben der Mitte, also den 17 dB/Dekade des Handbuchs.
- Form mit konstantem Peak.
- Die Summe aller Bänder in Mittelstellung ist +7,6 dB bei ±0,7 dB Welligkeit (50 Hz … 9 kHz). Ein fester Ausgleich von −7,6 dB macht die Mittelstellung flach.

**Bandpegel:** Ein VCA pro Band und Kanal, pro Sample geglättet.

**Feedback nach Blockschaltbild S. 8:**
- `fbSig = N · Σ (fb_k + fbAll) · a_k · y_k`, mit N = Summenausgleich und a_k = Bandpegel.
- Das Signal läuft zurück in den **gemeinsamen** Eingang: `u = sat(x + R · fbSig)`.
- Die Schleife wird verzögerungsfrei gelöst, damit die Eigenschwingung exakt auf der Bandmitte liegt.
- Liegt die augenblickliche Schleifenverstärkung zu nahe an 1, wird R begrenzt. Sonst wäre die Gleichung nicht lösbar. Die Schleife schwingt in diesem Fall trotzdem.

**Resonanz-Regler:** `R = Rmax · kurve(p)`.
- Die Kennlinie „balanced“ ist eine S-Kurve (Screen S. 19): `0,5·p + 0,5·p³`.
- Rmax = 2,45. Damit setzt die Eigenschwingung bei 15 Uhr ein (p = 0,6), wenn alle Bänder auf Feedback und in der Mitte stehen. Ganz links dämpft das invertierte Feedback um etwa −11 dB.
- Weitere Kennlinien: linear, log, exp, only highs (nur rechte Hälfte wirkt), only lows (nur linke Hälfte) **(Annahme)**.
- Grundeinstellung **(Annahme)**: alle 10 Bandschalter an, ALL aus.

**Eingangsstufe:** bis +24 dB mit sanfter Sättigung, wie bisher.

**Ausgang:** Dry/Wet, Volume, Schutz-Clipper.

**Modus-Engine:** Pro Block berechnet der aktive Modus die Zielpegel der 10 Bänder pro Kanal. Spread wirkt je nach Modus.

| Modus | Wirkung von Spread |
|---|---|
| FB CLASSIC | Pegelversatz eines Kanals **(Annahme)** |
| FILTER | Frequenzversatz für R |
| CLK | Verzögerung des LFO auf L bzw. R |
| DYN | Verzögerung der Hüllkurve auf L bzw. R |

**Morph:** Beim Snapshot-Wechsel mit Morph werden die resultierenden Bandpegel, Resonanz, Mix und Spread vom alten zum neuen Stand überblendet. Das funktioniert auch zwischen verschiedenen Modi **(Annahme)**.

### 1.3 Modulation (S. 6, 13, 14)

**Grundprinzip:**
- Pro Ziel höchstens ein LFO und ein Envelope Follower, beide addiert im normierten Raum.
- Insgesamt höchstens 20 LFOs und 20 Follower.
- Ziele: die stetigen Parameter des aktiven Modus sowie `res`, `mix` und `spread`.

**LFO:**
- Wave: sine, triangle, square, saw, random **(Annahme: Liste wie im CLK-Modus)**.
- Gain.
- Source: FREE, Master-Takt oder MIDI-Clock.
- Freq in Hz bzw. Teilerfaktor.
- Phase in 15°-Schritten.
- An/aus; L und R je ON, INV oder OFF.

**Envelope Follower:**
- Attack, Decay, Delay (Verzögerung vor dem Attack), Gain.
- Source: L IN, R IN, L OUT oder R OUT.
- An/aus; L und R je ON, INV oder OFF.

**Master-Takt:** ein interner Takt in BPM für LFO-Sync, CLK-Modus, PLAY und das Wackeln der FB-Tasten, oder MIDI-Clock.

### 1.4 Bedienung (Web-Umsetzung der Hardware)

**Aufbau des Bedienfelds:**
- Display-Bereich mit dem Screen des aktiven Modus bzw. Menüs.
- Regler: INPUT GAIN, RESONANCE, DRY/WET, SPREAD, VOLUME.
- Tastenreihe: FB, FILTER, CLK MOD, DYNAMIC EQ, MACRO, ENV MOD, LFO MOD, PLAY/LOAD, SPECTR, CONFIG.
- SHIFT und BACK, darunter 10 Funktionstasten und 10 Fader mit Mittelrastung.

**Rollen der Fader und Tasten:** Sie kommen aus dem aktiven Screen, wie im Handbuch beschrieben.

| Screen | Fader | Funktionstasten |
|---|---|---|
| FB | Bandpegel | Wackeln |
| FILTER | 1–4 und 9–10 = Parameter | Sperren |
| CLK | 1–3 und 7–10 | Sperren |
| DYN | 1–3 und 7–10 | Sperren |

Mit SHIFT schalten die Tasten das Feedback pro Band, BACK schaltet den ALL-Loop.

**Eingaben am Bildschirm:**
- Was auf der Hardware Encoder und SHIFT erledigen, geht direkt per Klick.
- Tastaturkürzel sind als Ergänzung vorgesehen. Die Leertaste dient als Fußschalter.

## 2. Arbeitspakete

### Phase F: Fundament (seriell, ich selbst)

| Paket | Inhalt |
|---|---|
| F1 | Parameter v3 mit Stereo-Parametern, Config-Speicher, Nachrichten, Snapshot-Format v3. Migration von v2: Bandpegel werden übernommen, der Rest startet neu. |
| F2 | Klangkern nach 1.2 mit Modus-Schnittstelle, FB-Modus, Modulations-Engine v3, Morph und Taps. Offline-Tests: Frequenzen, Flachheit in der Mitte, Einsatz der Eigenschwingung, Dämpfung links, Stabilität, Leistung. |
| F3 | Bedienfeld-Gerüst nach 1.4: Screen-Router, Zuordnung von Fadern und Tasten zu Rollen, FB-Screen mit Feedback-Ansicht. Alte Panels, Matrix, Pre/Post-Filter und Clock-Mods werden entfernt. |

### Phase X: Funktionen (parallel, Subagenten, nach F)

| Paket | Inhalt |
|---|---|
| A | FILTER-Modus: Bandpegel aus Cutoff, Slope, Width, Type, Gain und Offset; Sperren; Spread-Frequenzversatz; Screen mit Kurve |
| B | CLK MOD: LFO mit Sample & Hold im Takt, Richtung, Mittelpegel, R invertiert, Sperren, Spread-Verzögerung, Taktquelle, Reset |
| C | DYNAMIC EQ: Analyse der Quelle mit Eingangsfilter, Absenkung über dem Threshold, Attack, Decay, Delay, Offset, Sperren, Spread-Verzögerung |
| D | LFO MOD und ENV MOD: Menüs pro Ziel, Grenze von 20, L/R ON/INV/OFF, Anzeige |
| E | MACRO: 10 Fader frei zuweisbar (UNLINK, MODE inkl. Gruppen, LFO- und ENV-Parameter), im Snapshot gespeichert |
| F | LOAD/SAVE/INIT, Pools und PLAY mit Morph, 128 Plätze, Zufallsnamen, Sicherung als Datei |
| G | SPECTR: zwei Kanäle plus Lissajous, Paare wählbar, Spitzenhaltung |
| H | CONFIG und MIDI: Spread-Funktion, Kennlinie, Fußschalter, Emulation; Web MIDI mit CC-Tabelle S. 20, Kanälen für beide/L/R, CC-Out, Clock und Program Change |

### Phase I: Zusammenführen (seriell)

| Paket | Inhalt |
|---|---|
| I1 | Integration, Gesamttest im Browser |
| P | Werks-Snapshots: eigene Einstellungen im Geist der Beschreibungen auf S. 21–22, mit eigenen Namen, weil die Originalwerte unbekannt sind |
| DOC | README und Abgleich aktualisieren, neue Version veröffentlichen |

## 3. Reihenfolge

```
F1 ─► F2 ─► F3 ─┬─ A FILTER ─────┐
                ├─ B CLK MOD ────┤
                ├─ C DYN EQ ─────┤
                ├─ D LFO/ENV ────┼─► I1 ─► P ─► DOC
                ├─ E MACRO ──────┤
                ├─ F SNAPSHOTS ──┤
                ├─ G SPECTR ─────┤
                └─ H CONFIG/MIDI ┘
```

- **Seriell:** F1 → F2 → F3 → … → I1 → P. Ohne das Parametermodell und den Klangkern hat kein Modus etwas, worauf er aufsetzen kann.
- **Parallel nach F3:** A bis H. Jede Funktion besitzt eigene Dateien. Gemeinsame Dateien ändert nur das Fundament.

## 4. Bekannte Grenzen

- Web MIDI funktioniert in Chrome und Edge. In der eingebetteten Vorschau kann der Browser MIDI sperren; lokal gestartet geht es.
- Den Fußschalter ersetzt eine Taste bzw. ein Knopf auf dem Bildschirm.
- Display-Einstellungen, Firmware und USB-Backup der Hardware entfallen. Snapshots werden stattdessen als Datei gesichert.
