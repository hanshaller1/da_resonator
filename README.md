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
  ui/tabs/                  Die 10 Register (FB, FILTER, CLK MOD, DYN EQ, MACRO, ENV MOD, LFO MOD, SPECTR, PLAY/LOAD, CONFIG)
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
- Darunter immer die 10 Band-Fader (Pegel), rechts die Global-Spalte: INPUT mit ANALOG darunter, RESONANCE,
  SPREAD mit der Kanalwahl, die Befehle für alle Bänder unter RESET (R = L, FADER, RES/BAND, FB/BAND), FB ALL, DRY/WET,
  OUTPUT.
- Neben jedem Fader zwei Pegelanzeigen nebeneinander: links L, rechts R, gemessen nach Fader und SPREAD (was das
  Band auf diese Seite schickt). Ist die Banddynamik an, hängt ihre Pegeländerung in beiden von oben herab
  (Absenkung rot, Anhebung grün).
- **SRC** im Kopf öffnet die Quelle in CONFIG (keine Liste im Kopf). Die Register-LED zeigt, dass ein Modul an
  ist; PLAY/LOAD und CONFIG haben keine.
- **CONFIG** hat die Seiten GENERAL · MIDI · CLOCK · FOOT (rechts in der Statuszeile). GENERAL: Source mit dem
  Audio-Eingang unter LOAD FILE, Clock (nur Anzeige) mit Spread und Display (eine Zeile) darunter, Resonance mit
  der Karte Wobble · Dice darunter, Help.
  Der Audio-Zustand steht im Kopf.
- **Clock:** Der interne Takt und die MIDI-Clock laufen nebeneinander. Jeder Clock-Mod und jeder LFO wählt
  seinen Takt selbst (Clock-Mod INT · MIDI, LFO RATE · INT · MIDI; Parameter `cmodN.clk`, `lfoN.clk` und
  `lfoN.sync`, im Preset gespeichert).
  - Ist der gewählte Takt aus, folgt das Modul dem anderen; sind beide aus, steht es still.
  - CONFIG → GENERAL zeigt beide: INT und MIDI je mit Tempo und 4 Schlag-LEDs, bei MIDI dazu das Quellgerät.
    Die LED vor dem Namen leuchtet, wenn der Takt an ist.
  - CONFIG → CLOCK hat alle Einstellungen: INT mit ON, TEMPO, TAP, RUN, RESET und Schlag-LEDs; MIDI mit ON,
    SOURCE (eigenes Gerät für die Clock), Tempo, Schlag-LEDs und OFFSET. Die beiden ON sind unabhängig.
    USED BY nennt die LFOs und Clock-Mods, die den Takt gewählt haben.
  - CLK MOD und LFO MOD zeigen in der Statuszeile für das gewählte Modul das Tempo seines Takts (Klick öffnet
    CONFIG → CLOCK), INT · MIDI (beim LFO RATE · INT · MIDI) und die Schlag-LEDs. Ist der gewählte Takt aus, ist sein Knopf nur umrandet.
    Das Tempo bleibt Teil des Presets.
  - Trigger-Ausgänge: INT Clock Beat (`clock.beat`) und MIDI Clock Beat (`clock.midiBeat`).
- **LFO:** RATE · INT · MIDI in der Statuszeile. RATE lässt das LFO frei auf seinem RATE-Regler laufen (TEMPO zeigt
  dann ---, die Schlag-LEDs sind abgedunkelt), INT oder MIDI bindet es mit DIV an diesen Takt. Der nicht genutzte Regler
  ist abgedunkelt.
- Alle bandbezogenen Bilder nutzen dieselbe Frequenzachse: die Mitte von Band k liegt genau über Fader k.
- Die Modulationsmatrix ist pro Quelle verteilt: jedes Quellen-Register (CLK, ENV, LFO, MACRO) zeigt die Ziele
  seiner Quelle mit Tiefe; Rechtsklick auf jeden Regler öffnet weiterhin dessen Modulation und MIDI Learn.
- **Bandgruppen** (MACRO, „+ target“ → Band Groups): BAND LOW (Bänder 1–3), MID (4–7), HIGH (8–10) und ALL sind
  je ein Ziel. Eine Route darauf bewegt die Fader aller Bänder der Gruppe, genau wie eine Route pro Band, mit
  derselben Tiefe und Kanalwahl (L+R, L, R, INV). Ein Klick auf das Ziel zeigt die Fader der Gruppe.
- **SPECTR:** zwei Spektren als Paar wie an der Hardware: OUT L·R, IN L·R, L IN·OUT, R IN·OUT, dazu IN·OUT mit L
  und R zusammen (die bisherige Ansicht). Das erste ist grau, das zweite orange. XY zeigt die Lissajous-Figur
  desselben Paars (erstes auf X, zweites auf Y, Maßstab folgt dem Pegel). HOLD schaltet die Spitzenhaltung, daneben
  stellst du ein, wie schnell die Spitzen nach 1,5 s fallen (3 bis 192 dB/s, Standard 24). Gespeichert im Browser.
  Analyse (Stand 17.10.2026): **BANDS** zeigt unten in jeder Bandspalte IN, OUT und die Differenz Δ in dB
  (Mittel der Leistung in der Spalte; bei IN·OUT, L IN·OUT und R IN·OUT aus dem gewählten Paar, bei OUT L·R und
  IN L·R aus IN·OUT). Die **Feedback-Warnung** ist immer an: liegt OUT in einem Band ab +12 dB über IN (voll ab
  +24 dB) und ist OUT lauter als −60 dBFS, leuchtet die Spalte rot, ab halber Stärke steht `FB! band n` in der
  Zeile unter der Legende. **DIFF** zeichnet die Kurve zweites − erstes (grün, auf der Skala der RESP-Kurve, 0 dB
  gepunktet). **WFALL** zeigt im unteren Teil den Wasserfall des zweiten Signals (6,4 s, neuestes oben).
  **MARKS** beschriftet die drei lautesten Spitzen des zweiten Signals mit Frequenz, Note und Cent. Die lauteste
  Frequenz steht jetzt in der Zeile unter der Legende statt in der Statuszeile. Code: `src/ui/tabs/spectr/`
  (Bänder, Spitzen), `src/ui/viz/waterfall.ts`, Test `scripts/test-spectr.mjs`.

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
  - FEEDBACK: regelt alles Feedback (FB pro Band und FB ALL) wie der Attenuverter der Hardware. In der Mitte
    kein Feedback, rechts mehr (bis ×1,3), links invertiert (negatives Feedback dämpft). Ein Band mit FB 1
    schwingt ab 3 Uhr selbst; FB pro Band wirkt hier wie der Schalter der Hardware.
  - FOCUS (experimentell): ein Resonanz-Spot wandert mit dem Knopf durch die Bänder, 7:30 Uhr = Band 1,
    4:30 Uhr = Band 10, stufenlos dazwischen. Das Band im Spot bekommt RES +0,6, die Nachbarn weniger.
    BANDS wirkt hier nicht. Mit einem LFO oder EF auf RESONANCE wandert die Resonanz durchs Spektrum.
  - CURVE: Drehweg LIN, LOG (schnell, dann fein), EXP (fein, dann schnell) oder S, die S-Kurve „balanced“
    (fein um die Mitte und an den Anschlägen, schnell dazwischen).
  - BANDS: Der Knopf wirkt auf alle Bänder gleich (ALL), zu den Höhen ansteigend (HIGHS) oder zu den Tiefen ansteigend (LOWS).
- **FB ALL:** Eigenschwingung ab AMT ≈ 0,75 mit Fadern auf 0 dB, bei breiten wie schmalen Bändern.
  Ältere Presets werden beim Laden umgerechnet und klingen gleich.
- Die vier Einstellungen werden im Preset gespeichert und nicht moduliert.

### Pre- und Post-Filter: KEY, ENV, SPREAD

- **KEY:** Off = FREQ, Focus = der Spot des RESONANCE-Knopfs (FOCUS, durch seine Kurve), Band 1–10 = die
  Mittenfrequenz dieses Bandes. FREQ ist dann ohne Wirkung. KEY ist ein Stufenwert (Makros, Clock-Mods).
- **ENV AMT** (±4 Oktaven) und **ENV REL** (10–2000 ms): eingebauter Hüllkurvenfolger auf dem Eingang des
  Filters (5 ms Attack), −48…0 dBFS verschieben den Cutoff um ENV AMT, also Auto-Wah ohne Route.
- **SPREAD** (±2 Oktaven): L-Cutoff um die Hälfte nach unten, R nach oben (links andersherum).

### DYN EQ: CUT, BOOST, BALANCE

**MODE** vorne in der Statuszeile des DYN-EQ-Registers (Standard CUT, ältere Presets klingen gleich):
- **CUT** senkt Bänder über dem Threshold ab, wie die Hardware.
- **BOOST** hebt Bänder unter dem Threshold an (Upward Compression), höchstens um RANGE. Eine automatische
  Pegelkorrektur senkt dabei alle Bänder um die Leistung, die die Anhebung dazugibt (Bandpegel × Fader × Makeup,
  etwa 150 ms geglättet). Laute Bänder bleiben, leise kommen hoch, der Gesamtpegel bleibt etwa gleich.
- **BALANCE** zieht jedes Band zum Threshold: darüber absenken, darunter anheben, ohne Pegelkorrektur.
- **Gate:** Mehr als 40 dB unter dem Threshold wird nicht angehoben, darüber blendet die Anhebung über 12 dB ein.
  So bleiben Stille und Grundrauschen unten.
- RATIO gilt in beide Richtungen und geht nur noch ab 1:1 (unter 1:1 war es eine Expansion, das deckt BOOST ab).
  ATK wirkt, wenn die Verstärkung sinkt (mehr Absenkung, weniger Anhebung), REL, wenn sie wieder steigt.
- Die GR-Quellen dyn1–10 zeigen in allen Modi den Betrag der Änderung / RANGE (0..1).
- Code: `dynStep` in `src/dsp/resonator.worklet.ts`, Kurve `dynGainChange` in `src/shared/paramdefs/modules.ts`.
  Tests: `scripts/test-dyn.mjs` 2a–2c.

### L/R pro Band

Stand 16.10.2026, Entscheidungen in `docs/lr-pro-band-2026-10-16.md`.

- Pegel, RES und FB jedes Bands gibt es je Kanal, ebenso FB ALL (Schalter und AMT). TONE bleibt gemeinsam.
- Der Umschalter **L · L+R · R** unter SPREAD legt fest, welchen Kanal Fader, RES- und FB-Knöpfe und FB ALL
  bearbeiten. Er ist eine Bedienhilfe, wird nicht im Preset gespeichert und steht beim Start auf L+R.
  - In L+R bewegen sich beide Kanäle um denselben Weg, ein Versatz bleibt. Ein Kanal am Anschlag bleibt stehen.
  - Der Fader-Griff zeigt den gewählten Kanal, in L+R die Mitte. Weicht ein Kanal ab, zeigt eine dünne Marke
    mit Buchstabe seine Stellung; die Anzeige darunter zeigt beide Werte (`−6.0|+3.0`). Die Knöpfe zeigen den
    anderen Kanal als dünnen zweiten Zeiger. FB ALL leuchtet halb, wenn nur ein Kanal an ist.
  - Unter der Überschrift RESET: **R = L** setzt alle R-Werte auf die von L. **FADER** setzt alle 10 Fader in L
    und R auf 0 dB. **RES/BAND** und **FB/BAND** darunter setzen RES bzw. FB aller Bänder in L und R zurück.
- FB-Register: Die Kurve folgt dem Umschalter (L, R oder Mittel), weichen die Kanäle ab, zeigen gestrichelte
  Linien die anderen, und jeder Bandknoten nennt beide Werte (`L+2.9 R-8.6`). Das gilt auch für SPREAD.
  Der Ring eines Bandknotens ist geteilt: links Feedback L, rechts R.
- FB-Register, Funktionstasten wie an der Hardware:
  - **Wobble** (flache Taste mit Wellen-Symbol unter RES/FB jedes Bands): Solange du sie hältst (Maus, Touch oder
    Enter), wackelt der Pegel des Bands um ±10 % des Faderwegs (einstellbar), ein Sinus pro Schlag des Master-Takts (INT, oder MIDI, wenn INT aus ist). Läuft der
    Takt, sitzt der Sinus auf den Schlägen, sonst läuft er in dessen Tempo. Ein- und Ausblenden in 30 ms. Der
    Fader selbst bleibt stehen, nichts wird gespeichert. Der Umschalter L · L+R · R gilt auch hier.
  - **DICE** in der Statuszeile setzt alle 10 Bandpegel zufällig zwischen der −24-dB- und der +6-dB-Marke
    (einstellbar), im Kanal des Umschalters (L+R: in beiden gleich).
  - Tiefe (1–50 %) und DICE-Bereich (−60 … +12 dB, ganze dB) stellst du in CONFIG → GENERAL in der Karte
    Wobble · Dice ein. Sie gelten für alle Presets und bleiben in diesem Browser gespeichert, wie der Fußschalter.
- Jede Route auf einen Bandwert oder FB ALL AMT hat eine Kanalwahl (Knopf in Routenliste, Popup und
  Makro-Karte): L+R, L, R oder INV (R gegenläufig, ein LFO lässt das Band zwischen links und rechts wandern).
  Neue Routen übernehmen die Stellung des Umschalters.
- PANIC setzt FB beider Kanäle auf 0 und schaltet FB ALL in beiden Kanälen aus.
- Preset-Format 4. Fehlt ein R-Wert, gilt der von L: ältere Presets und die Werks-Presets klingen gleich.

### SPREAD

Stand 16.10.2026: SPREAD ist bipolar, die Mitte (12 Uhr, CC 64) lässt das Stereobild unverändert.
CONFIG → GENERAL → Spread wählt, was er tut (Parameter `reso.spread`, im Preset gespeichert):

- **ODD/EVEN**: Rechts der Mitte wandern die ungeraden Bänder nach links und die geraden nach rechts,
  links der Mitte umgekehrt. Am Anschlag liegt jedes Band ganz auf einer Seite (+3 dB, gleiche Leistung).
- **CLASSIC** (Standard seit 17.10.2026, wie die Hardware im FB-Modus): Rechts der Mitte wird R lauter und L leiser, links umgekehrt,
  am Anschlag ±6 dB. Der Wert ist eine Annahme, das Handbuch nennt keinen.
- Der Wechsel zwischen beiden blendet weich über.
- Gespeicherte Presets behalten ihre Funktion. Presets von vor dem bipolaren SPREAD (v4) und Werks-Presets,
  die SPREAD benutzen, bleiben auf ODD/EVEN.
- Preset-Format 5: Alte Werte (0 bis 100 %) liegen jetzt rechts der Mitte und klingen gleich. Routen auf SPREAD
  haben halbe Tiefe, damit sie gleich weit ausschlagen. Ein LFO, der früher an der 0 stehen blieb, schwingt jetzt
  in die Gegenrichtung weiter (Werks-Presets Breathing Bands und Singing Drone).

### Hardware-Modi

Stand 16.10.2026, Entscheidungen in `docs/hardware-modi-und-pools-2026-10-16.md`
(`1A 2A 3A 4A 5A 6C 7A 8A 9A 10A 11A 12A`). Teil 1 sind die Modi (dieser Abschnitt), Teil 2 die Pools
(nächster Abschnitt).

- Jeder Modus ist eine Ebene mit eigenem ON. Er rechnet seinen Pegel in dB auf den Fader jedes Bands
  (Fader + Band-Filter + Scanner + DYN), die Fader selbst bewegen sich nicht. Mehrere Modi laufen gleichzeitig.
- **Schlösser:** Band-Filter und Scanner haben je Band ein Schloss, in der Reihe am Fuß ihres Bilds oder per Klick
  in die Spalte. Ein gesperrtes Band behält seinen Fader-Pegel. Im Preset gespeichert (`filterBand.lockN`,
  `scan.lockN`).
- **FILTER → BAND** (Band-Filter):
  - TYPE LP · BP · HP · Notch, FREQ, SLOPE 6 bis 48 dB/Oktave, WIDTH 0,25 bis 8 Oktaven (nur BP und Notch),
    DEPTH (wie tief der Sperrbereich geht, 60 dB = stumm), OFFSET (Pegel im Durchlassbereich).
  - Jedes Band bekommt den Wert der Kurve an seiner Mitte. Ein Sweep wandert so hörbar von Band zu Band.
  - **R OFS** versetzt den Cutoff von R um bis zu ±2 Oktaven (gestrichelte Kurve).
  - Griff ziehen: seitlich FREQ, hoch und runter OFFSET. Die stetigen Werte lassen sich modulieren, die
    Bandpegel folgen dann schnell (3 ms).
- **CLK MOD → SCAN** (Band-Scanner): Bei jedem Schritt wird ein Wert abgetastet und ins nächste Band geschrieben.
  - Takt **RATE · INT · MIDI** in der Statuszeile: RATE läuft frei mit 0,1 bis 160 Schritten pro Sekunde,
    INT und MIDI im Takt mit DIV.
  - **SOURCE:** der eigene LFO (SHAPE Sine, Square, Triangle, Saw, Random; LFO 0,01 bis 40 Hz) oder eine
    Modulationsquelle (LFO 1–4, Env 1–4, CM 1–2, Makro 1–8).
  - **DIR** Up, Down, Ping-Pong oder Random. Gesperrte Bänder werden übersprungen.
  - Pegel eines Bands = OFFSET − DEPTH × (1 − Wert): beim höchsten Wert OFFSET, beim tiefsten OFFSET − DEPTH.
  - **R DLY** (0 bis 16): R bekommt die Schritte von L so viele Schritte später. **R INV:** R bekommt den
    gespiegelten Wert, die Bänder neigen sich auf R andersherum.
  - Einschalten, RESET des Takts und MIDI Start lösen sofort einen Schritt aus.
  - Das Bild zeigt je Band den Pegel des Scanners (L, mit R daneben), OFFSET, FLOOR und den laufenden Schritt.
- **DYN EQ**, neu in der Statuszeile:
  - **SRC** Band · In · Out. BAND misst wie bisher das eigene Bandsignal. IN misst den Eingang, OUT den Ausgang,
    je durch ein Analysefilter pro Band und Kanal (Bandpass auf der Bandmitte, Güte 1,5). Das Bild zeigt dann den
    gemessenen Pegel.
  - **FILT** Off · BP mit **FREQ:** ein Bandpass (Güte 2) vor der Analyse, nur bei IN und OUT.
  - **DLY** (bis 2 s) verzögert die Absenkung, **R DLY** (bis 1 s) die von R zusätzlich.
  - Threshold, Ratio, Attack, Release, Range und AMT je Band bleiben.
- Preset-Format 6. Alle neuen Werte stehen im Standard auf aus bzw. neutral, ältere Presets klingen gleich.
- Code: `src/dsp/modules/bandFilter.ts`, `src/dsp/modules/scan.ts`, Ebenen und DYN-Quellen in
  `src/dsp/resonator.worklet.ts`, Bilder in `src/ui/tabs/filter/viz.ts` und `src/ui/tabs/clk/scanViz.ts`,
  Schlösser in `src/ui/components/lockRow.ts`. Tests: `scripts/test-modes.mjs`.

### Pools, Morph und Fußschalter

Teil 2 der Hardware-Modi, Stand 16.10.2026.

- **Pools** (PLAY/LOAD, rechte Spalte): benannte, geordnete Listen von Presets. Ein Preset darf in mehreren Pools
  und mehrfach in einem stehen.
  - Kopf: POOL wählt den Pool, dazu NEW, REN (umbenennen) und DEL (der letzte Pool wird nur geleert).
  - Liste: Klick spielt einen Eintrag, Ziehen ordnet um (auch Alt + ↑ ↓), × entfernt. Hinzufügen mit
    „+ Add loaded preset“ oder durch Ziehen einer Zeile aus der Bibliothek. Gelöschte Presets stehen als
    `missing` da und werden übersprungen.
  - Pools liegen im Browser (`localStorage` `resonator.pools`). Mittlere Spalte, Zeile POOLS: EXPORT und
    IMPORT (Datei `resonator-pools-<datum>.json`). Beim Import werden Presets über ihre ID gefunden, sonst
    über den Namen (eigene Presets haben auf einem anderen Rechner andere IDs).
- **Abspielen:** START lädt den aktuellen Eintrag (anfangs den ersten) und lässt den Pool laufen, STOP hält
  an. STEP springt zum nächsten Eintrag, STEP+MORPH morpht dorthin, RESET geht zum ersten zurück. Die
  Statuszeile zeigt Pool, Zustand und Position.
  - **DIR:** Up, Down, Ping-Pong oder Random (nie zweimal derselbe).
  - **ADVANCE:** HAND (nur STEP und Fußschalter), CLOCK (während der Pool läuft, alle 1, 2, 4, 8 oder 16
    Takte von INT oder MIDI; ist der Takt aus, springt der andere ein) oder MIDI (eine gelernte Note oder ein
    CC, LEARN in der Zeile darunter oder in CONFIG → FOOT).
  - Ein Preset bringt sein Tempo mit. Läuft ein Pool im internen Takt, gilt nach jedem Wechsel das Tempo
    des neuen Presets.
  - **Program Change n** springt, solange ein Pool läuft, auf seinen Eintrag n. Sonst lädt er wie bisher
    Preset n der Bibliothek.
- **Morph** (MORPH in ms oder BEATS des Pool-Takts, 0 = Sprung): Alle stetigen Werte gleiten in ihrem
  Regelweg (eine Frequenz in Oktaven, ein Fader auf seiner Skala). Schalter und Auswahlen springen am Anfang.
  - Eine Route, die beide Presets haben, gleitet in der Tiefe. Eine Route nur im alten Preset blendet auf 0
    aus, eine nur im neuen kommt mit Tiefe 0 dazu und blendet ein.
  - Routen auf eine Routentiefe, Trigger-Routen und Makronamen kommen am Ende. Am Ende wird das Preset genau
    geladen.
  - **AUTO MORPH:** Weiterschalten per Takt, MIDI und Program Change morpht ebenfalls. Ein Laden oder STEP
    während eines Morphs übernimmt ab dem erreichten Klang. Die Linie unter MORPH zeigt den Fortschritt.
- **Fußschalter** (CONFIG → FOOT): eine Aktion für kurz drücken (SHORT, Standard Pool STEP) und eine für
  halten länger als 0,5 s (HOLD, Standard Bypass).
  - Mögliche Aktionen: Nothing, Bypass, Panic, nächstes oder voriges Preset, Pool START/STOP, STEP,
    STEP+MORPH, TAP tempo.
  - Ist HOLD auf Nothing, feuert SHORT schon beim Drücken. So liegen TAP und STEP auf dem Schlag.
  - Gedrückt wird er mit FOOT (CONFIG → FOOT und PLAY/LOAD), einer Taste und einer gelernten MIDI-Note oder
    einem CC.
  - **Taste:** Standard ist die Leertaste. SET wählt eine andere, OFF schaltet sie ab. In Textfeldern bleibt
    sie eine normale Taste. Auf einem fokussierten Knopf ist sie der Fußschalter; Enter klickt den Knopf weiter.
  - Gespeichert im Browser (`localStorage` `resonator.foot`), für alle Presets.
- **MIDI-Trigger:** Note an/aus oder CC ab 64 / unter 64 drücken und lösen. Ein CC gehört entweder zu einem
  Regler oder zu einem Trigger; wer ihn zuletzt lernt, bekommt ihn. Gespeichert mit der CC-Belegung
  (`resonator.midi`).
- Code: `src/presets/pools.ts` (Pools, Datei), `src/presets/player.ts` (Abspielen), `src/presets/morph.ts`
  und `PresetSession.morphTo`, `src/presets/foot.ts`, die Trigger in `src/core/midi.ts`, `src/ui/pool.ts`
  (Verdrahtung), `src/ui/tabs/play/pools.ts`, `src/ui/tabs/configFoot.ts`. Tests: `scripts/test-pools.mjs`.

### ANALOG

Stand 16.10.2026: Bis zur Mitte (0.5, Standard) klingt ANALOG wie bisher: leichte Sättigung, Bauteiltoleranz,
Drift und Rauschen. Darüber treibt er eine Verzerrerstufe vor den Bändern:

- Vorverstärkung bis +30 dB, der Clipper wird von weich zu hart und zunehmend schief (gerade Obertöne).
- Gemessen mit einem Sinus (220 Hz, Spitze 0.3): Klirrfaktor 0.5 % bei 0.5, 10 % bei 0.7, 25 % bei 0.8,
  43 % bei 1.0. Der Pegel steigt dabei um bis zu 5 dB; laute Eingänge landen bei etwa −8 dBFS RMS.
- Gegen Aliasing rechnet die Stufe mit Stammfunktion (ADAA erster Ordnung).
- Die Werks-Presets stehen auf 0.5 und klingen wie vorher.
- Die Band-Dynamik misst weiter beide Kanäle gemeinsam. Envelope Follower hören mit CH auf L+R, L oder R.

### Audio-Eingang (Synths, Elektron)

- Quelle wählen in CONFIG → Source, Liste SRC (Gruppe „Audio inputs“). Vor der ersten Freigabe steht dort nur
  „Audio input… (allow access)“; nach der Freigabe erscheinen alle Eingänge mit Namen.
- Unter LOAD FILE: Kanalwahl STEREO / LEFT / RIGHT (L oder R gehen auf beide Seiten). Mono-Geräte laufen immer auf beide Seiten.
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

### MIDI

Stand 16.10.2026, Entscheidungen in `docs/midi-2026-10-16.md` (`1B 2B 3B 4A 5B 6A 7A 8A`).

- Web MIDI gibt es in Chrome, Edge und Opera, nicht in Safari. Eine gehostete Vorschau sperrt MIDI meist;
  dann `resonator-standalone.html` lokal in Chrome öffnen oder `npm run dev`.
- CONFIG → **MIDI**: Schalter MIDI (der Browser fragt einmal), Gerät für CCs und Program Change,
  ELEKTRON AUTO (ein Elektron-Gerät wird beim Einschalten und beim Einstecken zum MIDI-Gerät), Anzeigen für
  Clock, CC und Program Change, die Kanäle **IN**, **IN L**, **IN R** (1–16 oder OFF, Standard IN = 1).
- **Kanäle:** IN bewegt L und R, IN L und IN R nur eine Seite der Bandwerte und von FB ALL. Alle anderen
  Regler folgen allen drei Kanälen.
- **CC:** Grundbelegung Bandpegel 20–29, RES 40–49, FB 50–59, RESONANCE 70, SPREAD 71, DRY/WET 72,
  FB ALL 73 (an ab 64), FB ALL AMT 74, TONE 75, Makros 102–109. INPUT und OUTPUT sind frei, lassen sich aber
  lernen. Ein CC setzt den Wert sofort (Parameter-Locks), wie eine Handbewegung; Modulation läuft darauf
  weiter. Der CC-Wert, der dem Grundwert am nächsten liegt, trifft ihn genau (CC 64 = 0 dB).
- **MIDI Learn:** Rechtsklick auf einen Regler (auch auf Schalter) → LEARN, dann an der Elektron einen Regler
  bewegen. Ein CC gehört zu genau einem Regler. ✕ entfernt die Belegung. Belegte Regler zeigen beim
  Überfahren `MIDI CC n`. CC 0, 32 und 120–127 sind gesperrt (Bank Select, Kanalmodus).
- Die Belegung gilt für alle Presets und liegt im Browser (`localStorage` `resonator.midi`), mit DEFAULT,
  EXPORT und IMPORT (Datei `resonator-midi-map.json`, Belegung und Kanäle).
- **Program Change n** lädt Preset n: erst die 12 Werks-Presets, dann die eigenen in der Reihenfolge des
  Speicherns. Die Nummer (ab 1) steht in der Preset-Liste vor dem Namen. Läuft ein Pool, springt er auf
  dessen Eintrag n (siehe „Pools, Morph und Fußschalter“).
- **Clock:** Einstellungen in CONFIG → CLOCK; INT · MIDI wählt jeder LFO und Clock-Mod in CLK MOD und LFO MOD.
  - **SOURCE:** Die MIDI-Clock (Clock, Start, Stop, Continue) kommt vom MIDI-Gerät oder von einem eigenen Gerät,
    z. B. Takt von einer Drum Machine, CCs von einem Synth. Mit eigenem Gerät gilt nur dessen Clock, und CCs und
    Program Change kommen nur vom MIDI-Gerät.
  - Start setzt die MIDI-Clock auf Schlag 1 und startet die Module neu, die ihr folgen; Stop hält, Continue
    läuft weiter. Ohne Clock läuft das letzte Tempo weiter. RESET wirkt nur auf den internen Takt.
  - Das angezeigte MIDI-Tempo ist beruhigt: Solange das gemessene Tempo nur um bis zu ±0,3 BPM schwankt, steht
    dort sein Mittelwert. Bleibt es länger als 0,4 s außerhalb, gilt es als neues Tempo.
  - Tempo und Schläge der MIDI-Clock werden auch bei ausgeschalteter MIDI-Clock angezeigt (gemessen im
    Browser), damit man sieht, ob sie ankommt.
  - **OFFSET** (−50 … +50 ms) verschiebt den Takt gegen das Audio (+ = später, z. B. um die Latenz des
    Audio-Eingangs). Das Tempo im Preset bleibt unangetastet.
- Noten nur als Trigger (Pool, Fußschalter), keine SysEx, kein MIDI-Ausgang.
- Code: `src/core/midi.ts` (Geräte, Kanäle, Learn, Speicher), `src/core/midiMap.ts` (Belegung, Datei),
  `src/dsp/extClock.ts` (Takt aus der Clock, im Worklet), `src/presets/programs.ts`, `src/ui/tabs/configMidi.ts`,
  `src/ui/tabs/configClock.ts`, `src/ui/clock.ts`,
  `src/ui/midi/hook.ts` (Popup, Tooltip).

### Modulation

- Läuft komplett im AudioWorklet, einmal pro Audio-Block (128 Samples). Dadurch läuft sie auch in einem
  Hintergrund-Tab gleichmäßig weiter und ist an die Audio-Uhr gebunden.
- Quellen: 8 Makros, 4 LFOs, 2 Clock-Mods, 4 Envelope Follower, 10 Gain-Reduction-Werte der Banddynamik.
- Envelope Follower: INPUT wählt den Abgriff (In, Band 1–10, Res Out, Out), **CH** den Kanal (L+R, L, R; so
  ergeben sich auch L IN, R IN, L OUT, R OUT der Hardware). **DLY** (0–2000 ms) verzögert Hüllkurve und Gate,
  der Follower reagiert also so viel später. **HOLD** (0–1000 ms) hält den Spitzenwert so lange, bevor das
  Release beginnt (kein Flattern bei Drums, Gate-artige Stufen).
- LFO: **STEPS** quantisiert die Welle in 2–16 Stufen (SMOOTH gleitet zwischen ihnen). **R PHASE** (0–180°)
  gibt der R-Seite von L/R-Zielen (Bandpegel, RES, FB, FB ALL, Bandgruppen) dieselbe Welle so viel später;
  Ziele ohne L/R bekommen den L-Wert.
- Makros: **MORPH** (Feld 9) fährt alle acht Makros von Satz A (links) nach Satz B (rechts); **A** und **B**
  speichern die Makros, wie sie gerade stehen. **RND** würfelt alle acht, **SNAP** merkt sie, **↺** holt sie
  zurück (Feld 10). A, B, SNAP und die MORPH-Stellung werden im Preset gespeichert (`modules.macroMorph`).
- Ziele: jeder modulierbare Parameter, auch Parameter anderer Quellen und die Tiefe jeder Route.
- Regeln (siehe `docs/plan-modulation-und-module.md`, Abschnitt 4): Makros werden nie moduliert, Schalter nie,
  Stufenwerte nur von Makros und Clock-Mods, Tempo nur von Makros, keine Zyklen.
- Effektivwert = Basiswert + Σ(Quelle × Tiefe) im Normraum 0..1.

### Tests

```bash
npm test              # DSP- und Modulations-Tests
node scripts/test-<modul>.mjs   # Tests einzelner Module
```
