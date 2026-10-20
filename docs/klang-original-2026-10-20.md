# Klang näher am Original: Feedback, Resonanz, Knopf links

Stand: 20.10.2026, ergänzt um die Auswertung von vier Hardware-Videos. Anlass: nukular findet die App im Vergleich zu Videos der Hardware zu zahm, und der RESONANCE-Knopf tut links der Mitte fast nichts. Nachgeschärft: Es geht vor allem darum, wie Feedback und Resonanz auf Material reagieren. Die Eigenschwingung soll funktionieren, steht aber nicht im Vordergrund.
Grundlagen: [abgleich-original.md](abgleich-original.md) (Handbuch), [original-recherche.md](original-recherche.md) (Testberichte), [dsp-durchgang-2026-10-16.md](dsp-durchgang-2026-10-16.md) (heutiger Stand). Messwerte: `node scripts/measure-character.mjs`. Hörbeispiele: Projektordner `klang-proben-2026-10-20/`.

## Vorweg

**Was du entscheidest:**
- Die Punkte 1 bis 8 haben je Optionen A, B, C …
- Antworte einfach mit einer Zeile wie `1B 2C 3B 4B 5C 6A 7B 8B`.
- Am DSP ändere ich nichts, bevor du gewählt hast. Gemessen und hörbar gemacht habe ich alles mit einem Prototyp außerhalb der App.

**Woher das Bild der Hardware kommt:**
- Das Handbuch beschreibt das Gerät als laut und instabil. Mehrere Werks-Presets sind ausdrücklich Verzerrer, bis hin zu hartem Clipping. Die beiden wichtigsten Regler sind laut Handbuch INPUT GAIN und RESONANCE.
- Sound On Sound beschreibt die Feedback-Schleifen als Weg „von leichtem Overdrive bis zu heulender Verzerrung“ und den Filter-Modus als „eher ein Verzerrungswerkzeug“. Nutzer warnen vor plötzlichen Pegelspitzen und raten zu einem Limiter.
- Wie Resonanz und Schleifen sich verhalten, steht nirgends. Die Videos, die nukular hochgeladen hat, zeigen es: Die Resonanz hebt wenige Stellen im Spektrum stark heraus und wächst gleichmäßig mit dem Knopf. Die Eigenschwingung ist verzerrt, je nach Einstellung von leicht (10 bis 20 % Klirr) bis fast rechteckig (40 %). Siehe „Was die Videos zeigen“.

## Kurzübersicht

| # | Punkt | Optionen | Empfehlung | Aufwand |
|---|---|---|---|---|
| 1 | Grundeinstellung des Resonance-Knopfs | A bleibt (RES) · B wie Hardware (FEEDBACK, COMMON, alle Bänder in der Schleife) | **B** | klein |
| 2 | Sättigung in den Schleifen | A sauber · B WARM · C RAW, wählbar in CONFIG | **C** | mittel bis groß |
| 3 | Reserve rechts vom Einsatz | A bleibt · B mehr Schleifenverstärkung am Ende des Drehwegs | **B** | klein |
| 4 | Eingangsstufe | A bleibt · B Grenze bei Vollaussteuerung, FB ALL läuft durch die Stufe | **B** | klein |
| 5 | Knopf links der Mitte | A bleibt · B wie Hardware, kräftiger gedämpft · C Kerben an den Bandmitten | **C** | mittel |
| 6 | Rauschen | A bleibt · B lauter bei Analog | **A** | klein |
| 7 | Aufbau der Resonanz über den Drehweg | A bleibt (lange nichts, dann Kippen) · B gleichmäßiger Aufbau | **B** | klein |
| 8 | Bänder ungleich wie analoge Bauteile | A bleibt (alle gleich) · B feste Streuung je Band, mit ANALOG | **B** | klein |

**Für das Verhalten mit Material machen 7 und 8 den größten Unterschied**, zusammen mit 1. 2 und 3 machen es rauer und lauter, 4 allein hört man kaum (Hörbeispiel 1).

## Was die Videos zeigen

Ausgewertet wurde nur der Ton. Die Videos sind über YouTube gelaufen und dadurch verlustbehaftet komprimiert und in der Lautheit normalisiert. Absolute Pegel lassen sich daraus nicht ablesen, Obertöne bis einige kHz, Tonhöhen und Pegelverhältnisse innerhalb einer Stelle schon. Die meisten Stellen mischen das Gerät mit Sprache. Verwertbar sind nur Stellen ohne Sprache.

| Video | Inhalt | brauchbar |
|---|---|---|
| „Erika Synths Resonant Filter Bank im Test“ (9 min) | Desktop-Gerät, deutscher Test | Fast überall liegt Sprache darüber. |
| „ERICA SYNTHS RESONANT FB REVIEW“ (17,5 min) | **Eurorack-Modul** im Modularsystem | Die Eingangssignale aus dem Modular sind selbst obertonreich. Das Modul lässt sich daran nicht vom Eingang trennen. |
| „The Erica Synths Resonant Filterbank is Pretty Neat“ (22 min) | Desktop-Gerät mit Drumcomputer | Zwei klare Stellen mit Eigenschwingung |
| „Erica Synths Resonant Filterbank Desktop – Review and Demo“ (35 min) | Desktop-Gerät, Drums und Synth | **Am wertvollsten:** 0:00 bis 1:15 Drums ohne Sprache, während RESONANCE und Fader nach und nach hochgefahren werden. Dazu eine Eigenschwingung ab etwa 6:06. |

### Resonanz mit Material (viertes Video, 0:00 bis 1:15)

Gemessen als Pegel in Halboktav-Bändern, jeweils gegenüber den ersten Sekunden, in denen die Drums noch fast unbearbeitet klingen. Die Knopfstellungen sind im Bild nicht genau ablesbar.

| Bereich | Verlauf |
|---|---|
| Bass (29 bis 84 Hz) | wächst gleichmäßig auf **+15 bis +33 dB** |
| 777 Hz | +10 bis +13 dB |
| 3,8 kHz (zwischen zwei Bändern) | +15 bis +24 dB |
| 411 bis 565 Hz | **sinkt** um 5 bis 10 dB |
| Gesamtpegel | nur etwa +6 dB, Crest 16 → 9,5 dB |

**Was daraus folgt:**
- **Die Resonanz ist selektiv.** Wenige Stellen springen um 15 bis 30 dB heraus, andere werden leiser. Das Gerät klingt dadurch gefärbt und „singend“, nicht einfach lauter.
- **Sie wächst gleichmäßig.** Die Spitzen kommen nach und nach mit dem Drehen, nicht erst kurz vor der Eigenschwingung.
- **Die Spitzen liegen nicht nur auf den Bandmitten.** 3,8 kHz liegt zwischen zwei Bändern. Das passt zur gemeinsamen Schleife (COMMON), in der sich die Phasen benachbarter Bänder addieren.
- Dass manche Bänder stärker resonieren als andere, obwohl keine Fader extrem stehen, spricht für Bauteilstreuung: Analoge Schleifen haben nie exakt dieselbe Verstärkung (Punkt 8).

### Eigenschwingung

| Stelle | Was zu hören ist | Messung |
|---|---|---|
| Video 3, 1:15 bis 1:26 | Ein Ton schwingt über die Drums hinweg an und wird lauter. | 24,2 Hz. Klirr 9 bis 16 %, vor allem 2. und 4. Oberton. |
| Video 3, 5:40 bis 5:53 | Ein Ton steht durchgehend und wird bei jedem Schlag um 5 bis 11 dB gedrückt. | 43,1 Hz, genau zwischen Band 1 und 2. Klirr 15 bis 20 %. |
| Video 4, ab 6:06 | Ein tiefer, harter Ton | 34 bis 35 Hz, **fast rechteckig**: Klirr etwa 40 %, nur ungerade Obertöne. Links und rechts um 2 % gegeneinander verstimmt. |

- **Die Verzerrung reicht von leicht bis hart.** Bei mäßiger Einstellung 10 bis 20 % Klirr mit geraden und ungeraden Obertönen, an anderer Stelle 40 % mit nur ungeraden. Die App liegt heute bei 0,2 bis 0,7 %.
- **Die Tonhöhe wandert.** 24,2 Hz liegt 17 % unter Band 1. Die App heute bleibt immer genau auf der Bandmitte.
- **Links und rechts sind nicht gleich.** Der Versatz von 2 % passt zu Bauteilstreuung (Punkt 8).
- **Eingang und Eigenschwingung drücken sich gegenseitig** (Video 3, 5:40). Das passt zu Punkt 4, könnte aber auch die Dynamik-Funktion sein.

**Prototyp danach eingestellt:** Grenze 1, Reserve +0,6, Knie 4, Asymmetrie 0,15, Aufbau über 30 dB, Streuung ±15 %. Mit den Bändern 1 und 2 in der Schleife ergibt das 17 % Klirr bei 40,0 Hz, mit einem um 12 dB angehobenen Bassband 30 % mit vor allem ungeraden Obertönen. Beides liegt im Bereich der Videos.

## Resonanz mit Material: Hardware gegen App

Drums durch die App, Eingang +6 dB, Fader auf 0 dB, Pegel in Halboktav-Bändern gegenüber Knopf in der Mitte.

| Einstellung | was passiert, wenn der Knopf nach rechts geht |
|---|---|
| **Hardware** (Video 4) | wenige Stellen +15 bis +33 dB, andere −5 bis −10 dB, gleichmäßig wachsend, gesamt etwa +6 dB |
| App, KNOB RES (Grundeinstellung), 0 → 1 | Bandmitten −3 bis +4 dB, **zwischen den Bändern −10 bis −19 dB**. Das ist ein Kamm: Es wird hohler, aber nichts springt heraus. |
| App, KNOB FEEDBACK, BAND, alle FB 1 | bis 0,66 nur +1 bis +8 dB, **dann kippt es**: bei 0,75 +13 bis +20 dB und bald Eigenschwingung |
| App, KNOB FEEDBACK, COMMON, alle FB 1 | bei 0,4 bis 0,6 breit +5 bis +9 dB, alles gleichmäßig lauter. Erst bei 0,75 springt eine Stelle heraus (565 Hz, +21 dB). |
| Prototyp BAND mit gleichmäßigem Aufbau (7B) | +3, +7, +12, +14 dB bei 0,2 / 0,4 / 0,6 / 0,66 |
| Prototyp BAND mit Aufbau und Streuung (7B + 8B) | bei 0,6 einige Bänder +17 bis +23 dB, andere nur +2 bis +7 dB |
| Prototyp COMMON mit Streuung (8B) | 565 Hz +25 bis +27 dB schon bei 0,6 bis 0,66 |

**Kurz:** Die Hardware hebt einzelne Stellen gleichmäßig und stark hervor. Die App macht im RES-Modus einen Kamm, im FEEDBACK-Modus erst lange wenig und dann einen Sprung, und im COMMON-Weg alles gleichmäßig lauter. Punkt 7 behebt den Sprung, Punkt 8 macht die Resonanz selektiv.

## Warum es heute zahm klingt

Offline gemessen, Sinus oder kurzer Rauschstoß, Analog 0,5 wenn nicht anders angegeben. Der Klirrfaktor (THD) gibt an, wie viel Obertöne neben dem Grundton liegen.

| Befund | Messung heute |
|---|---|
| In der Grundeinstellung resoniert nichts: KNOB = RES verschiebt nur die Bandgüte, Feedback gibt es erst mit FB je Band. | Knopf auf +1 mit FB 0: Kamm, keine Spitzen, keine Eigenschwingung |
| Feedback je Band wirkt bis kurz vor dem Einsatz kaum und kippt dann. Die Verstärkung der Schleife steigt linear, hörbar wird Resonanz aber erst in den letzten paar dB vor 1. | siehe Tabelle oben: +1 bis +8 dB bis 0,66, dann +13 bis +20 dB bei 0,75 |
| Alle Bänder sind exakt gleich. Im COMMON-Weg addieren sie sich deshalb zu einer breiten, gleichmäßigen Anhebung. | COMMON bei 0,4 bis 0,6: +5 bis +9 dB über alle Frequenzen |
| Die Schleifen bleiben sauber. Ein Hüllkurven-Begrenzer regelt den Pegel, ohne die Welle zu verformen. | Band 411 Hz, FB 1, breit: THD 0,2 %, Spitze 0,22. COMMON, alle FB, Knopf +1: THD 0,7 % |
| Verzerrung entsteht heute fast nur im Schutzbegrenzer am Ausgang, also nach den Bändern. | Eingang +12 dB: THD 21 % am Ausgang, davon nur 6,7 % aus der Eingangsstufe |
| Am Ende des Drehwegs passiert nichts mehr: FB je Band wird nach dem Knopf auf 1 begrenzt. | Knopf FEEDBACK über etwa halb vier ändert bei FB 1 nichts mehr. |
| Links der Mitte wird es nur leiser, und im RES-Modus nicht einmal das. | KNOB RES, RES 0,03: höchstens 0,5 dB. FEEDBACK, BAND: −2 bis −3 dB. FEEDBACK, COMMON: −7 dB über alle Frequenzen gleich. |

## Hörbeispiele

Im Projektordner unter `klang-proben-2026-10-20/`, je ein Paar „heute“ und „proto“. Beide Dateien eines Paars sind auf gleiche Lautheit gebracht (RMS −16 dBFS), damit du den Charakter vergleichst und nicht die Lautstärke.

Ich kann die Beispiele nicht selbst hören. Die letzte Spalte zeigt deshalb Messwerte (Schwerpunkt = mittlere Frequenz des Spektrums, höher heißt heller und schärfer).

Die Beispiele 1 bis 5 enthalten 2C, 3B und 4B (Grenze 1, Reserve +0,6, Knie 4, Asymmetrie 0,15), 1B ist im Patch schon eingestellt. Beispiel 6 enthält zusätzlich 7B und 8B. 5 und 6 der Punkte sind nirgends enthalten.

| # | Datei | Was läuft | Messung heute → Prototyp |
|---|---|---|---|
| **6** | `6-drums-resonanz-aufbau-band-0-bis-0.7` | **Zum Resonanzverhalten am besten geeignet.** Drums, Eingang +6 dB, KNOB FEEDBACK, BAND, alle FB 1. Der Knopf fährt in 12 s von der Mitte auf 0,7. | Heute erst kaum etwas, am Ende ein Sprung. Prototyp: Resonanz wächst von Anfang an, einzelne Bänder singen. Schwerpunkt 5,1 → 5,7 kHz, roh RMS −9,0 → −6,9 dBFS |
| 1 | `1-drums-input+12-fbAll0.6` | Drums, Eingang +12 dB, Fader als Lächelkurve, FB ALL 0,6. Prototyp nur mit 4B. | Kaum Unterschied |
| 2 | `2-drums-hw-patch-knob-0.6` | Drums, Eingang +6 dB, Hardware-Patch (COMMON, KNOB FEEDBACK, alle Bänder in der Schleife), Knopf knapp vor 15 Uhr | Schwerpunkt 3,8 → 3,7 kHz |
| 3 | `3-chords-hw-patch-knob-0.75` | Akkorde, gleicher Patch, Knopf über 15 Uhr | Schwerpunkt 1,3 → 2,2 kHz. Roh deutlich lauter, fast eine Wand |
| 4 | `4-selfosc-bands3+7` | Kein Eingang, Bänder 3 und 7 auf +6 dB, Rest gesenkt, Knopf 0,8 | Mehr Obertöne im Bass, roh bis Vollaussteuerung |
| 5 | `5-drums-knob-sweep-left-to-right` | Drums, der Knopf fährt in 12 s von ganz links nach ganz rechts | Links: −7 dB heute, −14 dB im Prototyp (mit 3B) |

Der Prototyp-Code liegt daneben in `prototyp/`. Er patcht eine Kopie der App und ist nur zum Nachrechnen gedacht.

---

## 1. Grundeinstellung des Resonance-Knopfs

**App heute:**
- Grundeinstellung KNOB = RES, FB-Weg BAND, FB je Band 0.
- Der Knopf macht die Bänder schmaler, das ergibt einen Kamm, aber keine Resonanzspitzen und nie Eigenschwingung. Für Resonanz braucht man erst FB je Band oder FB ALL, dazu CONFIG-Wissen.

**Hardware:**
- RESONANCE ist der Feedback-Regler. 12 Uhr heißt kein Feedback, nach rechts kommt Resonanz, ab etwa 15 Uhr schwingt das Gerät. Die Fader sind dann die Spielregler.
- Das alles geht ohne Menü.

**Optionen:**
- **A:** bleibt.
- **B:** INIT und Grundwerte wie die Hardware: KNOB = FEEDBACK, FB-Weg COMMON, FB aller Bänder auf 1 (wie „alle Schalter an“). In der Mitte klingt das genau wie heute neutral.

**Empfehlung: B.** Ohne B kommen 7 und 8 in der Grundeinstellung gar nicht zum Tragen.

**Folgen:**
- Werks-Presets setze ich ausdrücklich auf ihre bisherigen Werte, damit sie gleich klingen. Deine gespeicherten Presets tragen diese Einstellungen schon und bleiben, wie sie sind.
- RES je Band und die Modi RES und FOCUS bleiben in CONFIG wählbar.

## 2. Sättigung in den Feedback-Schleifen

**App heute:**
- Jede Schleife hat einen Begrenzer, der den Pegel über eine Hüllkurve langsam herunterregelt. Die Welle selbst bleibt rund. Deshalb ist die Eigenschwingung ein Sinus und auch starke Resonanz bleibt sauber.
- Nur FB ALL hat einen weichen Clipper. Gemessen: THD 26 % bei AMT 1.

**Hardware (abgeleitet):**
- Die Schleifen sind analog und clippen an den Grenzen der Verstärker. Je stärker eine Resonanzspitze wird, desto mehr wird sie gesättigt und bekommt Obertöne.
- Diese Obertöne laufen in den gemeinsamen Eingang zurück und regen andere Bänder an. Daraus entstehen das „Heulen“, Mehrklänge und die Instabilität.
- Die Tonhöhe hängt etwas am Pegel.

**Optionen:**
- **A:** bleibt sauber.
- **B: WARM.** Ein weicher Sättiger ersetzt den Hüllkurven-Begrenzer in den Band-Schleifen und in der COMMON-Schleife. Die Pegel bleiben etwa wie heute. Etwas mehr Obertöne, rundere Spitzen.
- **C: RAW.** Ein Sättiger mit härterem Knie und leichter Asymmetrie für gerade Obertöne. Die Grenze liegt höher, so dass Resonanz und Eigenschwingung bis an die Vollaussteuerung gehen wie an der Hardware.
- B und C wären eine neue Einstellung in CONFIG → Resonance: LOOP = CLEAN / WARM / RAW.

**Gemessen mit dem Prototyp (RAW nach den Videos eingestellt, zusammen mit 3B):**

| Fall | heute | RAW | Video |
|---|---|---|---|
| Band 411 Hz, FB 1, breit | Klirr 0,2 %, Spitze 0,22 | Klirr 13 %, Spitze 0,49 | |
| Band 411 Hz, FB 1, RES 0,45 | Klirr 0,04 % | Klirr 4 % | |
| COMMON, Bänder 1 und 2, Knopf 0,8 | schwingt nicht | 40,0 Hz, Klirr 17 % | 43,1 Hz, 15 bis 20 % |
| COMMON, Band 3 um 12 dB angehoben, Knopf 0,8 | | Klirr 30 %, vor allem ungerade Obertöne | 34 Hz, etwa 40 %, nur ungerade |
| COMMON, alle Bänder, Knopf +1 | Klirr 0,7 % | 208,9 Hz, Klirr 20 % | |
| COMMON, Band 7 um 12 dB angehoben | | Klirr 34 % | |
| Tonhöhe, breites Band | 413,8 Hz | 398,5 Hz, sie wandert mit dem Pegel | 24,2 Hz liegt 17 % unter Band 1 |

**Empfehlung: C**, als INIT-Einstellung, eingestellt auf die Videos. WARM läge darunter. CLEAN bleibt für den heutigen Klang.

**Aufwand: mittel bis groß.**
- Die Schleifen werden heute verzögerungsfrei gelöst, damit die Tonhöhe auch bei 11 kHz stimmt. Ein Sättiger in der Schleife muss so eingebaut werden, dass das erhalten bleibt. Der Prototyp zeigt, dass es geht: Der Sättiger wirkt als Verstärkung aus dem vorigen Sample.
- **Aliasing ist das eigentliche Risiko.** Im Prototyp erzeugt ein schwingendes 10-kHz-Band einen Spiegelton bei 18 kHz, nur 10 dB unter dem Grundton. Die Lösung ist, die Sättigung in den oberen Bändern sanfter zu machen oder dort doppelt so schnell zu rechnen. Ich würde mit der sanfteren Sättigung beginnen und nur bei Bedarf schneller rechnen, weil das in den betroffenen Bändern etwa doppelte Rechenlast kostet.
- Neue Einstellung, Snapshot-Format v7 (alte Presets laden mit CLEAN, klingen also gleich), Tests.

**Folgen:**
- RAW ist laut. Die Eigenschwingung erreicht Vollaussteuerung, der Schutzbegrenzer am Ausgang fängt sie ab. Das entspricht den Warnungen zur Hardware.

## 3. Reserve rechts vom Einsatz

**App heute:**
- Mit KNOB = FEEDBACK schwingt ein Band mit FB 1 ab 15 Uhr. Ab etwa halb vier ändert sich nichts mehr, weil das Feedback je Band nach dem Knopf auf 1 begrenzt wird.
- Die Schleifenverstärkung erreicht höchstens etwa 1,2 bei breiten Bändern.

**Hardware:**
- Weiter nach rechts heißt mehr Feedback, also lauter und mit Sättigung (Punkt 2) immer verzerrter.

**Optionen:**
- **A:** bleibt.
- **B:** Die Grenze fällt, der Knopf darf bis ×1,3 durchgreifen, und die Schleifenverstärkung am Anschlag steigt auf etwa 1,8 (Prototyp: Reserve +0,6). Damit schwingen auch breite Bassbänder im COMMON-Weg wie an der Hardware. Ohne Sättigung (2A) wird es dort nur lauter, mit 2B oder 2C immer dreckiger.

**Empfehlung: B**, zusammen mit 2.

**Folgen:** Links der Mitte wirkt die Invertierung dadurch auch kräftiger, gemessen −14 dB statt −7 dB (Hörbeispiel 5).

## 4. Eingangsstufe und FB ALL

**App heute:**
- Die Eingangsstufe sättigt weich und erst bei etwa +8 dB über Vollaussteuerung. Bei Eingang +12 dB kommen aus ihr nur 6,7 % THD, der Rest entsteht im Schutzbegrenzer am Ausgang.
- Die FB ALL-Rückführung kommt nach der Eingangsstufe dazu.

**Hardware:**
- Die Eingangsstufe ist für Gitarrenpegel ausgelegt und übersteuert mit Line-Signalen früh. Ein Werks-Preset nutzt genau das als hartes Clipping.
- Laut Blockschaltbild läuft die Rückführung in den gemeinsamen Eingang. Wahrscheinlich teilen sich Eingang und Rückführung also einen Verstärker.

**Optionen:**
- **A:** bleibt.
- **B:** Die Grenze sinkt auf etwa Vollaussteuerung, und FB ALL läuft durch dieselbe Stufe. Eingang und Resonanz drücken sich dann gegenseitig: Wird die Schleife laut, wird der Eingang zusammengequetscht.
- **C:** wie B, und auch die COMMON-Schleife läuft durch die Stufe. Mehr Aufwand, weil sie verzögerungsfrei gelöst wird.

**Empfehlung: B.** Allein ändert es wenig (Hörbeispiel 1), weil der Ausgangsbegrenzer heute fast dasselbe tut. Zusammen mit 2 verzerren Eingang und Schleife aber an derselben Stelle wie an der Hardware, statt erst hinter den Fadern.

## 5. Knopf links der Mitte

**App heute (gemessen):**

| Einstellung | links (−1) gegenüber Mitte |
|---|---|
| KNOB RES, Grundwert RES 0,03 | höchstens 0,5 dB. RES ist schon am unteren Ende und kann nicht weiter fallen. |
| KNOB RES, RES 0,45 | Die Kammstruktur verschwindet, die Bänder werden flach. |
| KNOB FEEDBACK, BAND, alle FB 1 | −2 bis −3 dB |
| KNOB FEEDBACK, COMMON, alle FB 1 | −7 dB, über alle Frequenzen gleich |

**Hardware:**
- Links wird das Feedback invertiert. Ein Test der Eurorack-Version nennt am linken Anschlag etwa −12 dB und spricht von einer dämpfenden Wirkung. Die Videos zeigen den linken Bereich nicht.
- Vermutlich klingt also auch die Hardware links vor allem leiser und gedämpfter und nicht spektakulär anders. Breite Bänder summieren sich flach, das gilt dort genauso.

**Optionen:**
- **A:** bleibt.
- **B: wie Hardware, kräftiger.** Im FEEDBACK-Modus kommt das mit 3B, links dann bis −14 dB. Im RES-Modus würde links ebenfalls invertiertes Feedback wirken statt RES zu senken. Hörbar ist vor allem: leiser, enger, weniger Nachklang.
- **C: Kerben.** Links von der Mitte bekommen alle Bandmitten eine Kerbe. Je weiter links, desto tiefer und schmaler wird sie. Das ist das Gegenstück zu rechts: rechts Spitzen an den Bandmitten, links Senken. Es klingt hohl und phasig. Das gilt in jedem Modus, im FEEDBACK-Modus zusätzlich zur Invertierung.

**Empfehlung: C.** B bildet die Hardware treuer nach, löst aber dein Problem kaum, weil es links vor allem leiser wird. C ist kein Hardware-Verhalten, aber links passiert dann hörbar etwas Eigenes. Mit 8B werden auch die Kerben ungleich tief, wie die Spitzen rechts.

**Aufwand C: mittel.** Je Kanal zehn Kerbfilter vor den Bändern. Sie rechnen nur, solange der Knopf links steht, rechts der Mitte bleibt die Ausgabe bitgleich.

## 6. Rauschen

**App heute:** Bei Analog 1 liegt das Grundrauschen bei −96 dBFS.

**Hardware:** Analoges Grundrauschen, wie laut ist unbekannt. Bei hoher Resonanz wird es von den Schleifen verstärkt.

**Optionen:**
- **A:** bleibt.
- **B:** Bei Analog 1 bis etwa −80 dBFS, damit Schleifen am Einsatz hörbar aus dem Rauschen anlaufen.

**Empfehlung: A.** Die Rauheit in den Videos kommt aus Resonanz und Verzerrung, nicht aus dem Rauschen. B ist eine Kleinigkeit und lässt sich jederzeit nachziehen.

## 7. Aufbau der Resonanz über den Drehweg

**App heute:**
- Die Schleifenverstärkung steigt linear mit Knopf × FB. Resonanz hört man aber erst, wenn die Verstärkung nahe an 1 kommt, also in den letzten Prozent vor dem Einsatz.
- Folge: Von der Mitte bis kurz vor 15 Uhr passiert wenig (+1 bis +8 dB), dann kippt es innerhalb einer kleinen Drehung in starke Resonanz und Eigenschwingung.

**Hardware (Video 4):** Die Spitzen wachsen gleichmäßig mit dem Drehen auf +15 bis +33 dB, bevor etwas schwingt.

**Optionen:**
- **A:** bleibt.
- **B: gleichmäßiger Aufbau.** Die Verstärkung wächst in dB gleichmäßig über den Drehweg, vom Knopf in der Mitte bis zum Einsatz über rund 30 dB. Jede Stellung zwischen Mitte und 15 Uhr bringt etwa gleich viel mehr Resonanz. Der Einsatzpunkt und alles rechts davon bleiben, wo sie sind.

**Gemessen (Prototyp, BAND, alle FB 1, Drums):** +3, +7, +12, +14 dB bei 0,2 / 0,4 / 0,6 / 0,66, heute +1 bis +8 dB über denselben Weg. Hörbeispiel 6.

**Empfehlung: B.** Das ist der direkteste Schritt zu „Resonanz zum Spielen“ statt „nichts oder Pfeifen“.

**Aufwand: klein.** Eine Kennlinie in der Feedback-Berechnung, gilt für FB je Band, den Knopf und den COMMON-Weg.

**Folgen:**
- Gespeicherte Presets mit FB zwischen 0 und dem Einsatz würden resonanter klingen. Deshalb kommt die neue Kennlinie mit demselben Snapshot-Format wie Punkt 2: alte Presets laden mit der alten Kennlinie und klingen gleich.
- Links der Mitte würde ich dieselbe Kennlinie gespiegelt nehmen, die Dämpfung setzt dann ebenfalls früher ein. Im Prototyp ist das nicht gemessen.

## 8. Bänder ungleich wie analoge Bauteile

**App heute:** Alle zehn Bänder und beide Kanäle haben exakt dieselbe Schleifenverstärkung. Bei gleicher Einstellung resonieren alle gleich stark, im COMMON-Weg ergibt das eine breite, gleichmäßige Anhebung.

**Hardware:** Analoge Schleifen streuen. Video 4 zeigt wenige stark herausstehende Stellen und links/rechts 2 % verstimmt.

**Optionen:**
- **A:** bleibt.
- **B: feste Streuung.** Jedes Band und jeder Kanal bekommt eine kleine feste Abweichung der Schleifenverstärkung, im Prototyp ±15 %. Sie ist bei jedem Start gleich, wie bei einem bestimmten Gerät. Die Stärke hängt an ANALOG: bei Analog 0 keine Streuung, also exakt wie heute.
- **C:** wie B, und die Streuung lässt sich in CONFIG neu würfeln (ein anderes „Exemplar“). Kann jederzeit nachgezogen werden.

**Gemessen (Prototyp, mit 7B):** Bei Knopf 0,6 stehen einige Bänder +17 bis +23 dB heraus, andere nur +2 bis +7 dB. Im COMMON-Weg springt 565 Hz schon bei 0,6 auf +25 bis +27 dB. Das ähnelt dem Bild in Video 4.

**Empfehlung: B.** Klein im Aufwand und macht die Resonanz selektiv. C erst, wenn dir das feste „Exemplar“ nicht gefällt.

**Aufwand: klein.** Ein fester Faktor je Band und Kanal. Achtung: Die Bänder setzen dadurch nicht mehr alle beim selben Knopfwinkel ein, manche etwas früher. Das ist gewollt, ich prüfe aber, dass die Fader weiter gut ausgleichen.

---

## Bleibt so, wenn du nichts anderes sagst

| Punkt | Vorschlag |
|---|---|
| Schutzbegrenzer am Ausgang (ab 0,8 weich bis 1,0) | bleibt, er fängt RAW ab |
| ANALOG-Drive (obere Hälfte des Analog-Reglers) | bleibt. Er verzerrt nach der Eingangsstufe und vor den Bändern und ergänzt 4B. |
| Bandfrequenzen, Bandbreite, Pegelausgleich | bleiben wie am 16.10. entschieden |
| FB ALL mit AMT und TONE | bleibt. Nur sein Clipper bekommt mit 2B oder 2C dieselbe Kennlinie wie die anderen Schleifen. |

## Was noch offen ist

- Die Knopfstellungen in Video 4 sind nicht ablesbar. Wie weit rechts die Hardware für +15 bis +33 dB steht, ist also geschätzt. Am meisten würde ein eigener Mitschnitt ohne Sprache helfen, mit bekannter Knopfstellung.
- Was der Knopf links an der Hardware macht, zeigt keines der Videos.
- Die Stärken im Prototyp (Grenze 1, Reserve +0,6, Knie 4, Asymmetrie 0,15, Aufbau 30 dB, Streuung ±15 %) sind nach den Video-Stellen eingestellt. Nach deiner Wahl stelle ich sie nach deinem Gehör nach.
