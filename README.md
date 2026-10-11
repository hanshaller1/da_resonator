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
  core/state.ts             Snapshot-Format v2 (Presets), Migration von v1
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
- Darunter immer die 10 Band-Fader (Pegel), rechts die Global-Spalte (Input, Resonance, Spread, FB All, Dry/Wet, Output).
- Alle bandbezogenen Bilder nutzen dieselbe Frequenzachse: die Mitte von Band k liegt genau über Fader k.
- Die Modulationsmatrix ist pro Quelle verteilt: jedes Quellen-Register (CLK, ENV, LFO, MACRO) zeigt die Ziele
  seiner Quelle mit Tiefe; Rechtsklick auf jeden Regler öffnet weiterhin dessen Modulation.

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
