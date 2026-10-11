# Plan: LFO, Clock-Mod, Envelope Follower, Dynamic EQ, Makros, Presets, Filter

**Bestätigt am 09.10.2026:** Modulation läuft im Audio-Thread (E1). Dynamic EQ ist die Dynamik direkt auf den 10 Resonator-Bändern, wie im Original (E7).

Stand: 09.10.2026 · Grundlage ist der Code in `da_resonator/` (Stand nach dem Resonanz-Fix).
Nur Planung, noch keine Implementierung.

---

## 1. Ausgangslage im Code (was schon da ist, was fehlt)

| Baustein | Ist-Zustand | Problem für die neuen Features |
|---|---|---|
| `shared/params.ts` | 40 statische Parameter (10 global + 10 × 3 Band), ein Float32Array an das Worklet | Neue Module brauchen eigene Parameter (LFO-Rate, Filter-Cutoff …). Die Liste ist fest verdrahtet. |
| `core/modulation/ModulationMatrix.ts` | Quellen → Resonator-Parameter, additive Offsets im Normraum, 200 Hz | Ziele können nur Resonator-Parameter sein. Quellen können sich nicht gegenseitig modulieren. Keine Auswertungsreihenfolge, keine Zyklusprüfung, keine Trigger. |
| Control-Loop in `AudioEngine.tick()` | `setInterval` auf dem Main-Thread, Zeit aus `performance.now()` | Browser drosseln `setInterval` in Hintergrund-Tabs auf ca. 1 Hz: LFOs würden dann stottern, während das Audio weiterläuft. Timing ist nicht an die Audio-Uhr gebunden (Clock-Mod jittert). |
| Meter (`MeterFrame`) | 30 Hz, Band-RMS nach dem Fader | Für einen Envelope Follower viel zu langsam (33 ms Raster) und für Dynamic EQ unbrauchbar. |
| `core/Clock.ts` | BPM, Beats, `phase()`, 24-PPQN-Eingang | Läuft auf dem Main-Thread mit derselben Drosselung; keine Trigger/Events. |
| `core/InsertChain.ts` | AudioNode-Ketten vor/nach dem Worklet | Eigene AudioNodes pro Filter hätten jeweils eine eigene Parameter-Übertragung und keinen Zugriff auf die Modulation im Worklet. |
| `getState()/setState()` | Nur Basiswerte der 40 Parameter | Kein Modul-Zustand, keine Routen, keine Versionierung. |
| Panel-Registry | `registerPanel()` mit Region `dock` | Passt. Fehlt nur ein gemeinsames UI für Modulationszuweisung. |

**Folgerung:** Bevor die sieben Features gebaut werden, muss das Fundament (Parameter-Registry, Modulations-Engine, DSP-Kette, State-Format) einmal seriell umgebaut werden. Danach können die Features weitgehend parallel entstehen.

---

## 2. Architektur-Entscheidungen (Empfehlung, als Default gesetzt)

**E1 – Modulation läuft im AudioWorklet, nicht auf dem Main-Thread.**
Die Mod-Engine rechnet pro Audio-Block (128 Samples ≈ 375 Hz bei 48 kHz) im Worklet. Vorteile: keine Hintergrund-Drosselung, Clock ist sampelgenau an die Audio-Uhr gebunden, Envelope Follower und Dynamic EQ sehen das echte Audiosignal statt 30-Hz-Meter. Der Main-Thread schickt nur noch Konfiguration (Basiswerte, Routen, Modul-Einstellungen) und bekommt mit ca. 60 Hz Readouts für die UI (Mod-Ringe, Scopes).
*Alternative:* Matrix bleibt auf dem Main-Thread (weniger Umbau). Dann bleiben Drosselung, Jitter und die langsame Hüllkurve. Nicht empfohlen.

**E2 – Eine DSP-Kette in einem Worklet.**
Pre-Filter, Resonator (mit Banddynamik) und Post-Filter laufen als interne Stufen desselben `AudioWorkletProcessor`. Damit gibt es ein Parameter-Array, eine Mod-Engine und Abgriffpunkte (Taps) für die Envelope Follower an jeder Stelle. `InsertChain` bleibt für externe Web-Audio-Nodes bestehen, wird aber für die eigenen Module nicht mehr gebraucht. CPU ist unkritisch: die DSP läuft derzeit ca. 40× schneller als Echtzeit.

**E3 – Alles ist ein Parameter.**
Jeder einstellbare Wert bekommt eine ID im Schema `modul.parameter` (z. B. `lfo1.rate`, `filterPre.cutoff`, `dyn.threshold`, `band2.dyn`, `route.r7.depth`). Auch Routentiefen sind Parameter, damit Makros und LFOs sie modulieren können und Presets sie automatisch speichern.

**E4 – Feste Slots statt beliebig vieler Instanzen.**
4 LFOs, 2 Clock-Mods, 4 Envelope Follower, 8 Makros, Banddynamik auf allen 10 Bändern, 2 Filter (Pre und Post), max. 64 Routen. Jeder Slot hat einen An/Aus-Schalter. Das hält Parameter-Indizes stabil, Presets einfach und den CPU-Worst-Case berechenbar.

**E5 – Der Modulationsgraph ist azyklisch (DAG).**
Eine Route, die einen Zyklus erzeugen würde (A moduliert B, B moduliert A, oder eine Quelle sich selbst), wird beim Anlegen abgelehnt; die UI graut solche Ziele aus. Feedback über den *Audioweg* (z. B. Envelope Follower am Ausgang moduliert die Resonanz) ist erlaubt, weil der Follower immer den vorherigen Block liest.

**E6 – Zwei Signalarten: Werte und Trigger.**
Quellen liefern einen kontinuierlichen Wert (bipolar −1…1 oder unipolar 0…1) und optional Trigger-Events (z. B. Clock-Mod-Schritt). Trigger-Routen sind ein eigener Routentyp und können LFO-Phase, Clock-Mod-Position oder Follower-Hold zurücksetzen.

**E7 – Dynamic EQ = Dynamik auf den 10 Resonator-Bändern (bestätigt).**
Jedes Band bekommt einen eigenen Detektor und eine eigene Gain-Stufe, sampelgenau im Worklet. Sitz im Band: nach der bandeigenen Feedback-Schleife, vor Resonanz-Makeup und Fader. Damit bleibt die Eigenschwingung eines Bands unverändert, ihr Pegel wird aber geregelt; weil FB All die Bandsumme abgreift, wirkt die Dynamik auch auf die FB-All-Schleife und zähmt sie.
Parameter: global `dyn.on`, `dyn.threshold`, `dyn.ratio` (über 1 = Kompression, unter 1 = Expansion), `dyn.attack`, `dyn.release`, `dyn.range` (max. Regelweg in dB); pro Band `bandN.dyn` (Anteil 0…1, 0 = Band ungeregelt). Die Gain-Reduction jedes Bands ist eine Mod-Quelle (10 Werte), und der Bandfader zeigt sie als Overlay im LED-Meter.
Offen: Falls das Original pro Band eigene Threshold-Werte hat statt eines Anteils, wird `bandN.dyn` dazu umgedeutet. Das ändert nur die Parameterbedeutung, nicht die Architektur.

---

## 3. Signalfluss (Audio) – was wen beeinflusst

```
Quelle ─► [Pre-Filter] ─► RESONATOR ─────────────────────────────────────────► [Post-Filter] ─► Output
             │             Input-Gain, Sättigung,
             │             10 × [ Band-SVF + eigenes FB ─► DYNAMIK ─► Makeup ─► Fader ]
             │             FB-All-Schleife (greift die Bandsumme ab), Spread, Mix
             ▼                  ▼             ▼              ▼                       ▼
          Tap IN           Tap BAND 1…10  Tap DYN-GR 1…10  Tap RES-OUT            Tap OUT
             └──────────────────┴──────────┴──────────┬───────────┴───────────────┘
                                                      ▼
                                           Envelope Follower 1–4  (lesen Block n−1)
```

- **Pre-Filter** formt, was in die Bänder kommt: ein Tiefpass vor dem Resonator nimmt den oberen Bändern das Material, sie klingen dann nur noch über Feedback.
- **Resonator** bleibt wie er ist. Dry für den Mix wird weiterhin vor dem Input-Gain abgegriffen, also *nach* dem Pre-Filter.
- **Dynamik (Dynamic EQ)** sitzt in jedem Band nach dessen Feedback-Schleife. Sie zähmt die Spitzen, die hohe Resonanz und Feedback erzeugen, und regelt über die Bandsumme auch die FB-All-Schleife mit.
- **Post-Filter** formt das Gesamtergebnis (inkl. Dry-Anteil).

---

## 4. Modulation – wer darf wen modulieren

### 4.1 Quellen

| Quelle | Slots | Ausgang | Trigger-Ausgang | Eigene modulierbare Parameter |
|---|---|---|---|---|
| Makro | 8 | unipolar 0…1 | – | keine (nur Hand, Preset, später MIDI-CC) |
| LFO | 4 | bipolar | Zyklus-Start | Rate (frei oder Sync), Phase, Form-Morph, Smooth, Level |
| Clock-Mod | 2 | uni/bipolar je Modus | Schritt/Gate | Teiler/Multiplikator, Steps, Euklid-Pulse, Wahrscheinlichkeit, Swing, Slew, Level |
| Envelope Follower | 4 | unipolar | Schwellwert-Überschreitung | Tap (diskret), Attack, Release, Gain, Threshold, Level |
| Dynamik-GR | 10 (je Band) | unipolar (nur lesen) | – | – (Einstellungen gehören zur Dynamik) |
| Clock | 1 | – (liefert Phase/Beats an LFO-Sync und Clock-Mod) | Beat, 1/16 | BPM |

### 4.2 Erlaubnis-Matrix

✓ = erlaubt · ✗ = verboten · (s) = nur andere Slots, nicht sich selbst

| Quelle ↓ / Ziel → | Resonator | Filter | Dynamik | LFO-Param. | Clock-Mod-Param. | EF-Param. | Routentiefe | Makro | BPM |
|---|---|---|---|---|---|---|---|---|---|
| **Makro** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| **LFO** | ✓ | ✓ | ✓ | ✓ (s) | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Clock-Mod** | ✓ | ✓ | ✓ | ✓ | ✓ (s) | ✓ | ✓ | ✗ | ✗ |
| **Env Follower** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (s) | ✓ | ✗ | ✗ |
| **Dynamik-GR** | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |

Zusätzliche Regeln:

1. **Zyklen sind immer verboten** (E5), auch über Umwege: LFO1 → LFO2.rate und LFO2 → LFO1.rate geht nicht. Prüfung beim Anlegen per Tiefensuche im Graphen.
2. **Makros sind die Wurzel** des Graphen. Sie werden nie moduliert, damit ein Preset mit Makros immer gleich reagiert.
3. **BPM** darf nur ein Makro verändern. Externe Clock (Tap, später MIDI) überschreibt das.
4. **Dynamik-GR moduliert keine Dynamik-Parameter** (Regelkreis über die eigene Regelung würde pumpen). Auf `bandN.gain` ist sie erlaubt, die UI warnt aber, weil das wie eine zweite Kompression wirkt.
5. **Diskrete Parameter** (LFO-Form, Filtertyp, Clock-Teiler, EF-Tap) sind nur durch Makro und Clock-Mod erreichbar und werden quantisiert. Kontinuierliche Quellen würden hier nur flattern.
6. **Schalter** (Bypass, FB-All an/aus, Modul an/aus) sind nicht modulierbar, nur Hand und Preset.
7. **Trigger-Routen:** Clock-Mod → LFO-Reset, Clock-Mod → EF-Hold, LFO-Zyklus → Clock-Mod-Reset, EF-Schwelle → LFO-Reset / Clock-Mod-Schritt. Gleiche Zyklusregel wie bei Werten.
8. **Verrechnung** bleibt wie heute: Effektivwert = Basis + Σ(Quelle × Tiefe) im Normraum 0…1, danach begrenzt. Unipolare Quellen gehen in eine Richtung, bipolare um den Basiswert. Routentiefe −1…1.

### 4.3 Auswertungsreihenfolge pro Audio-Block

```
1. Clock vorrücken (Sample-Zähler), Beat-/Step-Trigger erzeugen
2. Makros lesen (Basiswerte vom Main-Thread)
3. Restliche Quellen in topologischer Reihenfolge des DAG:
     für jede Quelle: eigene Parameter = Basis + eingehende Modulation,
                      dann Ausgangswert und Trigger berechnen
   (Envelope Follower und Dynamik-GR liefern den Wert aus Block n−1)
4. Für jedes Audio-Ziel: Effektivwert = Basis + Σ Routen → Glättungsziel
5. Audio: Pre-Filter → Resonator (inkl. Banddynamik) → Post-Filter, pro Sample geglättet;
   Detektoren an den Taps aktualisieren dabei die Hüllkurven
6. Alle ~16 ms: Readout an die UI (Quellwerte, Effektivwerte modulierter Parameter, Meter)
```

Die topologische Reihenfolge wird nur bei Routenänderungen neu berechnet, nicht pro Block.
Die Glättung modulierter Resonator-Parameter wird von 20 ms auf ca. 3 ms verkürzt, sonst kommen schnelle LFOs (> 8 Hz) gedämpft an. Unmodulierte Parameter behalten 20 ms.

---

## 5. Arbeitspakete

### Phase 0 – Fundament (seriell, muss zuerst fertig sein)

| ID | Paket | Inhalt | Abnahme |
|---|---|---|---|
| **F1** | Parameter-Registry v2 | Namensräume `modul.param`, Registrierung pro Modul, feste Slot-Indizes (E4), Typen `continuous` / `discrete` / `toggle`, Metadaten „modulierbar durch welche Quellklassen“. Resonator-Parameter behalten ihre IDs, damit vorhandene Zustände gültig bleiben. | Typecheck grün, alle bestehenden DSP-Tests grün, UI unverändert. |

F1 ist der einzige echte Flaschenhals: alles andere hängt an den Parameter-IDs.

### Phase 1 – Fundament, drei parallele Stränge (nach F1)

| ID | Paket | Besitzt diese Dateien | Abnahme |
|---|---|---|---|
| **F2** | Mod-Engine im Worklet | `src/shared/mod/*` (neu): `ModSourceDsp`-Interface, Routen (Wert + Trigger), DAG mit Zyklusprüfung, Topo-Sortierung, Erlaubnis-Matrix aus 4.2, Clock mit Audio-Zeit und Tap/24-PPQN-Eingang, Nachrichtenprotokoll v2 (Config rein, Readouts raus). | Unit-Tests: Reihenfolge, Zyklus-Ablehnung, Erlaubnisregeln, Determinismus, Clock-Genauigkeit über 10 min < 1 Sample Drift. |
| **F3** | DSP-Kette im Worklet | `src/dsp/*`: Stufen-Interface (`process(block)`, Parameter-Slice), feste Reihenfolge Pre-Filter → Resonator → Post-Filter (Filter zunächst als Durchreicher), Einschubpunkt für die Banddynamik im Resonator-Band (zunächst Gain 1), Tap-Punkte, gemeinsamer `EnvelopeDetector` (Peak/RMS, Attack/Release), verkürzte Glättung für modulierte Parameter, Aufruf der Mod-Engine pro Block. | DSP-Tests grün, Klang bitgleich zum heutigen Stand bei leerer Modulation, CPU-Messung. |
| **F4** | State & Modulations-UI | `src/core/state/*`, `src/ui/mod/*`: `StateProvider`-Interface (jedes Modul liefert `getState/setState`), versioniertes Gesamtformat mit Migration v1→v2, gemeinsame UI: Quelle wählen → Ziel-Regler anklicken bzw. ziehen, Routenliste, Tiefe am Mod-Ring ziehen, ausgegraute Ziele bei verbotenen Routen, generisches Modul-Panel. Arbeitet gegen ein Mock der Mod-Engine. | Bisherige Zustände laden weiter, Routen per UI anlegen/löschen funktioniert im Mock. |

**I0 – Integration Fundament (seriell, kurz):** F2 + F3 + F4 zusammenführen, Referenz-LFO aus `LfoSource.ts` auf die neue Engine portieren, Main-Thread-Matrix und `setInterval`-Loop entfernen. Abnahme: ein LFO moduliert `band3.res` im Browser, auch im Hintergrund-Tab gleichmäßig.

### Phase 2 – Features, sieben parallele Stränge (nach I0)

Jedes Feature lebt in `src/modules/<name>/` (`params.ts`, `dsp.ts`, `panel.ts`, `index.ts`). Gemeinsame Dateien werden nur um eine Zeile ergänzt (`src/modules/registry.dsp.ts` für das Worklet, `src/modules/registry.ui.ts` für die Panels). Dadurch stören sich die Stränge nicht.

| ID | Feature | Inhalt | Abhängig von | Abnahme |
|---|---|---|---|---|
| **A** | LFO | 4 Slots; Formen Sinus/Dreieck/Säge/Rechteck/S&H/Smooth-Random mit Morph; Rate frei 0,01–40 Hz oder Sync (1/64 … 8 Takte, punktiert/triolisch); Phase, Retrigger, Level; Scope im Panel. | I0 | Frequenzgenauigkeit, Sync phasenstarr zur Clock, keine Sprünge bei Rate-Modulation. |
| **B** | Clock-Mod | Interne Clock-UI (BPM, Tap, Start/Stop); 2 Slots mit Modi Teiler/Multiplikator, Step-Sequenzer (bis 16 Steps), Euklid, Random-S&H; Swing, Wahrscheinlichkeit, Slew; Trigger-Ausgänge. | I0 | Trigger sampelgenau, Teiler/Multiplikator korrekt bei BPM-Wechsel. |
| **C** | Envelope Follower | 4 Slots; Tap-Auswahl (IN, Band 1–10, RES-OUT, OUT); Attack 0,1–500 ms, Release 5 ms–5 s, Gain, Threshold, Kurve; Schwellen-Trigger. | I0 (nutzt `EnvelopeDetector` aus F3) | Zeitkonstanten stimmen, Hinweis in der UI bei Audio-Rückkopplung (Tap hinter dem Ziel). |
| **D** | Filter | Pre- und Post-Filter, multimode SVF (LP/BP/HP/Notch, 12/24 dB), Cutoff, Resonanz, Drive, Mix; Frequenzgang im Spektrum-Panel. | I0 | Stabil bei voller Modulation, Cutoff-Genauigkeit, keine Zipper bei schneller Modulation. |
| **E** | Makros | 8 Makro-Regler in einem eigenen Panel, Namen editierbar, Anzeige der zugewiesenen Ziele; optional Bereich min/max pro Route statt Tiefe. | I0 | Ein Makro bewegt mehrere Ziele mit unterschiedlichen Tiefen, auch Routentiefen anderer Quellen. |
| **F** | Preset-System | Speichern/Laden (IndexedDB), Export/Import als JSON-Datei, Preset-Browser mit Kategorien, A/B-Vergleich, „Init“-Preset, Migrationen. Unabhängig vom konkreten Modul, da jedes Modul über `StateProvider` angebunden ist. | F4 (kann schon parallel zu I0 starten) | Rundreise speichern → laden ist verlustfrei für alle Module und Routen; altes Format lädt. |
| **G** | Dynamic EQ (Banddynamik) | Detektor + Gain-Stufe in allen 10 Bändern (E7); globale Threshold/Ratio/Attack/Release/Range, Anteil pro Band; GR-Overlay im Fader-Meter; 10 GR-Werte als Mod-Quellen. Besitzt den Band-Teil von `resonator.worklet.ts`. | I0 (nutzt `EnvelopeDetector`) | Kompression misst ±0,5 dB genau; Eigenschwingung bleibt in der Tonhöhe stabil; FB All bei Betrag 1 bleibt mit aktiver Dynamik begrenzt; CPU-Mehrlast gemessen. |

### Phase 3 – Zusammenführen (seriell)

| ID | Paket | Inhalt |
|---|---|---|
| **I1** | Integration & Querprüfung | Alle Module zusammen: Querwirkungen testen (LFO → Filter-Cutoff, EF → Dynamik-Threshold, Makro → Routentiefe, Clock-Mod → LFO-Reset, EF am OUT → Band-Resonanz), Worst-Case-CPU (alle Slots an, 64 Routen), Bedienung im Dock-Bereich ordnen. |
| **P** | Werks-Presets | 10–20 Presets, die die Module zeigen. Erst jetzt sinnvoll, weil alle Parameter feststehen. |
| **DOC** | Doku | README und Andock-Tabelle auf den neuen Stand. |

---

## 6. Ablauf auf einen Blick

```
F1 ─► ┬─ F2 (Mod-Engine) ──┐
      ├─ F3 (DSP-Kette) ───┼─► I0 ─► ┬─ A  LFO ──────────┐
      └─ F4 (State + UI) ──┘         ├─ B  Clock-Mod ────┤
                │                    ├─ C  Env Follower ─┤
                │                    ├─ D  Filter ───────┼─► I1 ─► P ─► Doku
                │                    ├─ E  Makros ───────┤
                └──────────────────► ├─ F  Presets ──────┤
                                     └─ G  Banddynamik ──┘
```

**Seriell (muss nacheinander):** F1 → (F2, F3, F4) → I0 → … → I1 → P.
**Parallel:** F2 ∥ F3 ∥ F4; danach A ∥ B ∥ C ∥ D ∥ E ∥ F ∥ G. Das Preset-System F darf schon nach F4 starten.
**Kritischer Pfad:** F1 → F3 → I0 → G (die Banddynamik greift in den Kern der Resonator-DSP ein und braucht die gründlichsten Tests) → I1 → P.

Warum nicht mehr parallel: Vor F1 gibt es keine stabilen Parameter-IDs, gegen die irgendein Modul gebaut werden könnte, und vor I0 gibt es keine Laufzeit, in der eine Quelle tatsächlich etwas moduliert. Jedes Feature, das vorher startet, müsste danach umgebaut werden.

Warum Werks-Presets zuletzt: Jede Parameteränderung in einem Modul würde fertige Presets ungültig machen.

---

## 7. Offene Punkte (mit gesetztem Default)

| Frage | Default in diesem Plan |
|---|---|
| Dynamic EQ | Entschieden: Dynamik auf den 10 Bändern (E7), ein gemeinsamer Threshold, pro Band ein Anteil (wie im Original, kein Threshold pro Band). |
| Modulation im Worklet statt Main-Thread? | Entschieden: ja (E1). |
| Anzahl Slots | 4 LFO, 2 Clock-Mod, 4 EF, 8 Makros, Banddynamik ×10, 2 Filter, 64 Routen. |
| MIDI (Clock-Eingang, CC auf Makros) | Nicht in diesem Plan; Clock-Eingang und Makros sind dafür vorbereitet. |
| Preset-Morphing zwischen zwei Presets | Später; das Zustandsformat erlaubt es. |

---

## 8. Umsetzungsstand (9. Oktober 2026)

Alle Pakete F1–F4, I0, A–G, I1 und P sind umgesetzt, in der Reihenfolge aus Abschnitt 6 (Fundament seriell, die sieben Feature-Stränge parallel, danach Zusammenführung).

- Tests: `npm test` startet alle zehn Testsuiten (99 Tests: DSP, Modulation, LFO, Clock-Mod, EF, Filter, Banddynamik, Mod-UI, Presets, Integration).
- Leistung: Worst Case mit allen Modulen und 64 Routen läuft offline mit etwa 14-facher Echtzeit. Bei ausgeschalteter Banddynamik klingt der Resonator bitgenau wie vorher.
- Werks-Presets: 12 Stück in `src/presets/factory.ts`.
- Bedienung: Quellen-Chip anklicken (Assign-Modus), dann einen Regler anklicken oder ziehen, um die Tiefe zu setzen.
- Bekannte Grenzen:
  - Modulation und Trigger sind blockgenau (128 Samples, höchstens 2,7 ms).
  - Die Schritt-LEDs der Clock-Mods können bei Reset-Triggern kurz von der DSP abweichen.
  - Die Banddynamik-Quellen (GR) folgen der tatsächlich angewandten Reduktion; ein Band mit Anteil 0 liefert 0.
- Geklärt: Das Original hat keinen Threshold pro Band; der gemeinsame Threshold mit Anteil pro Band bleibt so.
