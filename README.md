# da_resonator

Browser-Nachbau der Kernfunktion der Erica Synths **Resonant Filterbank**:
10 resonante Bandpässe (29 Hz … 11 kHz), pro Band **Level-Fader**, **Resonanz** und **Feedback**,
optional **Feedback All** (Summe zurück in alle Bänder) mit Tone-Filter im Loop.

## Starten

```bash
npm install
npm run dev            # Entwicklung
npm run build          # dist/ (mehrere Dateien)
npm run build:single   # dist-single/index.html (alles in einer Datei)
npm run test:dsp       # Offline-Tests der DSP (Frequenzen, Stabilität, Performance)
```

## Architektur

```
src/
  shared/params.ts          Alle Parameter (Resonator + Module, feste Slots, stabile Indizes)
  shared/paramdefs/         Parameter-Definitionen pro Modul (LFO, Clock-Mod, EF, Filter, Dynamik, Makros, Clock, Routen)
  shared/mod/               Modulationsquellen, Regeln (wer darf wen), Zyklusprüfung, Routen-Verwaltung
  shared/messages.ts        Nachrichten Main-Thread <-> AudioWorklet (Parameter, Routen, Meter, Mod-Readouts)
  dsp/resonator.worklet.ts  DSP: Pre-Filter -> Resonator (mit Banddynamik) -> Post-Filter
  dsp/ModEngine.ts          Modulations-Engine im Audio-Thread (Graph, Clock, Routen, Taps)
  dsp/modules/              LFO, Clock-Mod, Envelope Follower, Filter (laufen im Worklet)
  core/AudioEngine.ts       AudioContext, Quellen, Parameter-Transport
  core/ModController.ts     Routen anlegen/prüfen, Readouts für die UI
  core/state.ts             Snapshot-Format v3 (Presets), Migration von v1 und v2
  presets/                  Preset-Speicher und Werks-Presets
  ui/shell/                 Bühne 1200 × 700 (skaliert), Register, Fader-Block, Global-Spalte, Band-Achse
  ui/tabs/                  Die 10 Register (FB, FILTER, CLK MOD, DYN EQ, MACRO, ENV MOD, LFO MOD, PLAY/LOAD, SPECTR, CONFIG)
  ui/components/, ui/viz/   Regler, Routenlisten, Canvas- und Spektrum-Bausteine
  ui/mod/                   Assign-Modus, Routen-Popover, Beschriftungen
  styles/                   Design-Tokens und Styles
scripts/                    Offline-Tests (npm test)
docs/                       Planung
```

Signalfluss:

```
Quelle -> Source-Gain -> AnalyserIn -> [Worklet: Pre-Filter -> Resonator -> Post-Filter] -> AnalyserOut -> Ausgang
```

### Oberfläche

- Feste Fläche 1200 × 700, gleichmäßig auf das Fenster skaliert (nichts verschiebt sich je nach Fenstergröße).
- Oben die Kopfzeile, darunter 10 Register, je eines über einer Fader-Spalte. Jedes Register füllt dasselbe
  Panel (1044 × 336): Statuszeile, Visualisierung, Reglerreihe mit 10 festen Plätzen (Platz k über Fader k).
- Darunter immer die 10 Band-Fader (Pegel), rechts die Global-Spalte (Input, Resonance, Spread, Kanalwahl, FB All, Dry/Wet, Output).
- Alle bandbezogenen Bilder nutzen dieselbe Frequenzachse: die Mitte von Band k liegt genau über Fader k.
- Die Modulationsmatrix ist pro Quelle verteilt: jedes Quellen-Register (CLK, ENV, LFO, MACRO) zeigt die Ziele
  seiner Quelle mit Tiefe; Rechtsklick auf jeden Regler öffnet weiterhin dessen Modulation.

### Resonanz und Feedback (CONFIG → Resonance)

Stand nach dem DSP-Durchgang vom 16.10.2026, siehe `docs/dsp-durchgang-2026-10-16.md`.

- **Bänder:** RES pro Band stellt die Güte von 0,6 bis 120 ein. Grundwert und INIT sind breite Bänder wie an der
  Hardware (RES 0,03, Güte 0,7). Stehen dann alle Fader auf 0 dB, ist die Summe flach bei 0 dB.
  Ab RES 0,45 werden die Bänder schmaler und lauter wie bisher.
- **FB pro Band**, Einstellung FB:
  - BAND (Standard): Jedes Band speist nur sich selbst zurück, vor dem Fader. Eigenschwingung ab 0,87.
  - COMMON: Die Bänder speisen nach ihren Fadern in den gemeinsamen Eingang aller Bänder, wie an der Hardware.
    Ein hochgezogener Fader lässt sein Band klingeln, und die Bänder regen sich gegenseitig an.
- **RESONANCE-Knopf**, Einstellung KNOB:
  - RES (Standard): verschiebt RES der Bänder.
  - FEEDBACK: skaliert alles Feedback (FB pro Band und FB ALL). In der Mitte wirkt es wie eingestellt,
    rechts bis zum Doppelten, links über null bis invertiert (negatives Feedback dämpft).
  - CURVE: Drehweg LIN, LOG (schnell, dann fein) oder EXP (fein, dann schnell).
  - BANDS: Der Knopf wirkt auf alle Bänder gleich (ALL), zu den Höhen ansteigend (HIGHS) oder zu den Tiefen ansteigend (LOWS).
- **FB ALL:** Eigenschwingung ab AMT ≈ 0,75 mit Fadern auf 0 dB, bei breiten wie schmalen Bändern.
  Ältere Presets werden beim Laden umgerechnet und klingen gleich.
- Die vier Einstellungen werden im Preset gespeichert und nicht moduliert.

### L/R pro Band

Stand 16.10.2026, Entscheidungen in `docs/lr-pro-band-2026-10-16.md`.

- Pegel, RES und FB jedes Bands gibt es je Kanal, ebenso FB ALL (Schalter und AMT). TONE bleibt gemeinsam.
- Der Umschalter **L · L+R · R** unter SPREAD legt fest, welchen Kanal Fader, RES- und FB-Knöpfe und FB ALL
  bearbeiten. Er ist eine Bedienhilfe, wird nicht im Preset gespeichert und steht beim Start auf L+R.
  - In L+R bewegen sich beide Kanäle um denselben Weg, ein Versatz bleibt. Ein Kanal am Anschlag bleibt stehen.
  - Der Fader-Griff zeigt den gewählten Kanal, in L+R die Mitte. Weicht ein Kanal ab, zeigt eine dünne Marke
    mit Buchstabe seine Stellung; die Anzeige darunter zeigt beide Werte (`−6.0|+3.0`). Die Knöpfe zeigen den
    anderen Kanal als dünnen zweiten Zeiger. FB ALL leuchtet halb, wenn nur ein Kanal an ist.
  - **R = L** setzt alle R-Werte auf die von L. **RESET** setzt alle 10 Fader in L und R auf 0 dB.
- FB-Register: Die Kurve folgt dem Umschalter (L, R oder Mittel), weichen die Kanäle ab, zeigen gestrichelte
  Linien die anderen. Der Ring eines Bandknotens ist geteilt: links Feedback L, rechts R. Rechts in der
  Statuszeile setzen **RES RESET** und **FB RESET** RES bzw. FB aller Bänder in L und R zurück.
- Jede Route auf einen Bandwert oder FB ALL AMT hat eine Kanalwahl (Knopf in Routenliste, Popup und
  Makro-Karte): L+R, L, R oder INV (R gegenläufig, ein LFO lässt das Band zwischen links und rechts wandern).
  Neue Routen übernehmen die Stellung des Umschalters.
- PANIC setzt FB beider Kanäle auf 0 und schaltet FB ALL in beiden Kanälen aus.
- Preset-Format 4. Fehlt ein R-Wert, gilt der von L: ältere Presets und die Werks-Presets klingen gleich.
- Band-Dynamik und Envelope Follower messen weiter beide Kanäle gemeinsam.

### Audio-Eingang (Synths, Elektron)

- Quelle wählen im Kopf (Gruppe „Audio inputs“) oder in CONFIG → Input. Vor der ersten Freigabe steht dort nur
  „Audio input… (allow access)“; nach der Freigabe erscheinen alle Eingänge mit Namen.
- Kanalwahl STEREO / LEFT / RIGHT (L oder R gehen auf beide Seiten). Mono-Geräte laufen immer auf beide Seiten.
- ELEKTRON AUTO (Standard an): ein Elektron-Gerät (Digitakt, Digitone, Syntakt, Analog Rytm / Four / Heat …)
  wird beim Start und beim Einstecken im Betrieb automatisch zum Eingang. Das geht nur, wenn der Browser die
  Gerätenamen kennt, also nach einer ersten Freigabe.
- Gemerkt werden Gerät, Kanalwahl, AUTO und ob ein Eingang die Quelle war (`localStorage` `resonator.input`).
- Wird das gewählte Gerät abgezogen oder fehlt es beim Start, bleibt es die Quelle und ist still, bis es wieder
  da ist. Es wird bewusst kein anderes Gerät geöffnet (ein Laptop-Mikro neben den Lautsprechern würde koppeln).
- Der Browser liefert die ersten zwei Kanäle eines Geräts (bei Overbridge: Main Out), ohne Echo- und
  Rauschunterdrückung.
- Eingebettete Fenster ohne Mikrofon-Erlaubnis (z. B. eine gehostete Vorschau) können keine Eingänge nutzen;
  dann `resonator-standalone.html` lokal in Chrome öffnen oder `npm run dev`.
- Code: `src/core/inputs.ts` (Liste, Hot-Plug, Elektron, Speicher), `AudioEngine.useInput` (Stream, Kanalwahl).

### Modulation

- Läuft komplett im AudioWorklet, einmal pro Audio-Block (128 Samples). Dadurch läuft sie auch in einem
  Hintergrund-Tab gleichmäßig weiter und ist an die Audio-Uhr gebunden.
- Quellen: 8 Makros, 4 LFOs, 2 Clock-Mods, 4 Envelope Follower, 10 Gain-Reduction-Werte der Banddynamik.
- Ziele: jeder modulierbare Parameter, auch Parameter anderer Quellen und die Tiefe jeder Route.
- Regeln (siehe `docs/plan-modulation-und-module.md`, Abschnitt 4): Makros werden nie moduliert, Schalter nie,
  Stufenwerte nur von Makros und Clock-Mods, Tempo nur von Makros, keine Zyklen.
- Effektivwert = Basiswert + Σ(Quelle × Tiefe) im Normraum 0..1.

### Tests

```bash
npm test              # DSP- und Modulations-Tests
node scripts/test-<modul>.mjs   # Tests einzelner Module
```
