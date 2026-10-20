# Klang näher am Original: rauer, aggressiver, Knopf links

Stand: 20.10.2026, ergänzt um die Auswertung von drei Hardware-Videos. Anlass: nukular findet die App im Vergleich zu Videos der Hardware zu zahm, und der RESONANCE-Knopf tut links der Mitte fast nichts.
Grundlagen: [abgleich-original.md](abgleich-original.md) (Handbuch), [original-recherche.md](original-recherche.md) (Testberichte), [dsp-durchgang-2026-10-16.md](dsp-durchgang-2026-10-16.md) (heutiger Stand). Messwerte: `node scripts/measure-character.mjs`. Hörbeispiele: Projektordner `klang-proben-2026-10-20/`.

## Vorweg

**Was du entscheidest:**
- Die Punkte 1 bis 6 haben je Optionen A, B, C …
- Antworte einfach mit einer Zeile wie `1B 2C 3B 4B 5C 6A`.
- Am DSP ändere ich nichts, bevor du gewählt hast. Gemessen und hörbar gemacht habe ich alles mit einem Prototyp außerhalb der App.

**Woher das Bild der Hardware kommt:**
- Das Handbuch beschreibt das Gerät als laut und instabil. Mehrere Werks-Presets sind ausdrücklich Verzerrer, bis hin zu hartem Clipping. Die beiden wichtigsten Regler sind laut Handbuch INPUT GAIN und RESONANCE.
- Sound On Sound beschreibt die Feedback-Schleifen als Weg „von leichtem Overdrive bis zu heulender Verzerrung“ und den Filter-Modus als „eher ein Verzerrungswerkzeug“. Nutzer warnen vor plötzlichen Pegelspitzen und raten zu einem Limiter.
- Wie die analogen Schleifen begrenzen, steht nirgends. Die Videos, die nukular hochgeladen hat, zeigen es: Die Eigenschwingung ist ein verzerrter Sinus mit etwa 10 bis 20 % Klirr, kein Rechteck. Siehe „Was die Videos zeigen“.

## Kurzübersicht

| # | Punkt | Optionen | Empfehlung | Aufwand |
|---|---|---|---|---|
| 1 | Grundeinstellung des Resonance-Knopfs | A bleibt (RES) · B wie Hardware (FEEDBACK, COMMON, alle Bänder in der Schleife) | **B** | klein |
| 2 | Sättigung in den Schleifen | A sauber · B WARM · C RAW, wählbar in CONFIG | **C** | mittel bis groß |
| 3 | Reserve rechts vom Einsatz | A bleibt · B mehr Schleifenverstärkung am Ende des Drehwegs | **B** | klein |
| 4 | Eingangsstufe | A bleibt · B Grenze bei Vollaussteuerung, FB ALL läuft durch die Stufe | **B** | klein |
| 5 | Knopf links der Mitte | A bleibt · B wie Hardware, kräftiger gedämpft · C Kerben an den Bandmitten | **C** | mittel |
| 6 | Rauschen | A bleibt · B lauter bei Analog | **A** | klein |

Den größten Unterschied machen 1, 2 und 3 zusammen. 4 allein hört man kaum (Hörbeispiel 1).

## Was die Videos zeigen

Ausgewertet wurde nur der Ton. Die Videos sind über YouTube gelaufen und dadurch verlustbehaftet komprimiert und in der Lautheit normalisiert. Absolute Pegel lassen sich daraus nicht ablesen, Obertöne bis einige kHz und Tonhöhen schon. Die meisten Stellen mischen das Gerät mit Sprache oder Drums. Verwertbar sind nur die Stellen, an denen ein Ton allein über Sekunden steht.

| Video | Inhalt | brauchbar |
|---|---|---|
| „Erika Synths Resonant Filter Bank im Test“ (9 min) | Desktop-Gerät, deutscher Test | Fast überall liegt Sprache darüber, keine saubere Stelle mit Eigenschwingung. |
| „ERICA SYNTHS RESONANT FB REVIEW“ (17,5 min) | **Eurorack-Modul** im Modularsystem | Die Eingangssignale aus dem Modular sind selbst obertonreich. Das Modul lässt sich daran nicht vom Eingang trennen. |
| „The Erica Synths Resonant Filterbank is Pretty Neat“ (22 min) | Desktop-Gerät mit Drumcomputer | Zwei klare Stellen mit Eigenschwingung, siehe unten |

**Die zwei klaren Stellen (drittes Video):**

| Stelle | Was zu hören ist | Messung |
|---|---|---|
| 1:15 bis 1:26 | Ein Ton schwingt über die Drums hinweg an und wird lauter. Er überdeckt die Drums (86 % der Energie). | 24,2 Hz. Klirr 9 bis 16 %, vor allem der 2. Oberton (−20 bis −24 dB) und der 4. (−22 bis −29 dB), der 3. liegt tiefer (−30 bis −38 dB). |
| 5:40 bis 5:53 | Ein Ton steht durchgehend und wird bei jedem Schlag um 5 bis 11 dB gedrückt. | 43,1 Hz. Klirr 15 bis 20 %, 3. Oberton −15 bis −17 dB, 2. Oberton −19 bis −22 dB. |

**Was daraus folgt:**
- **Die Hardware schwingt verzerrt, aber nicht als Rechteck.** 10 bis 20 % Klirr mit deutlichen 2., 3. und 4. Obertönen. Die gemischten geraden und ungeraden Obertöne passen zu einer leicht asymmetrischen Sättigung. Die App liegt heute bei 0,2 bis 0,7 %. Der erste Prototyp lag mit 57 % in der gemeinsamen Schleife zu weit drüber.
- **Die Hardware schwingt auch zwischen den Bändern.** 43,1 Hz liegt genau zwischen Band 1 (29 Hz) und Band 2 (61 Hz), dort, wo sich die Phasen der beiden Bänder aufheben. Der COMMON-Weg der App macht das auch: Mit den Bändern 1 und 2 in der Schleife schwingt der Prototyp bei 42,5 Hz. **Die App heute schwingt mit diesen beiden Bändern gar nicht**, auch nicht am Anschlag, weil die Reserve fehlt (Punkt 3).
- **Die Tonhöhe wandert.** 24,2 Hz liegt 17 % unter Band 1. Im Prototyp sinkt die Tonhöhe ebenfalls, je stärker die Sättigung greift (42,5 → 39,6 Hz). Die App heute bleibt immer genau auf der Bandmitte.
- **Eingang und Eigenschwingung drücken sich gegenseitig.** Bei 5:40 wird der stehende Ton bei jedem Schlag leiser. Das passt zu einer Rückführung, die mit dem Eingang durch dieselbe Stufe läuft (Punkt 4). Es könnte aber auch die Dynamik-Funktion sein, das zeigt das Video nicht.

**Prototyp danach eingestellt:** Grenze 1, Reserve +0,6, Asymmetrie 0,3. Mit den Bändern 1 und 2 in der Schleife ergibt das bei Knopf 0,8 (etwa 3:30) 22 % Klirr bei 39,6 Hz, am Anschlag 30 %. Das trifft die Videos. Mit allen Bändern in der Schleife werden es 30 bis 50 %, dafür gibt es in den Videos keinen Vergleich. Die Hörbeispiele sind mit dieser Einstellung neu gerechnet.

## Warum es heute zahm klingt

Offline gemessen, Sinus oder kurzer Rauschstoß, Analog 0,5 wenn nicht anders angegeben. Der Klirrfaktor (THD) gibt an, wie viel Obertöne neben dem Grundton liegen.

| Befund | Messung heute |
|---|---|
| In der Grundeinstellung schwingt nichts: KNOB = RES verschiebt nur die Bandgüte, Feedback gibt es erst mit FB je Band. | Knopf auf +1 mit FB 0: keine Eigenschwingung |
| Die Eigenschwingung ist ein fast reiner, leiser Sinus. Ein Hüllkurven-Begrenzer regelt den Pegel, ohne die Welle zu verformen. | Band 411 Hz, FB 1, breit: THD 0,2 %, Spitze 0,22 (−13 dBFS). Schmal (RES 0,45): THD 0,04 %, Spitze 0,63. |
| Auch die gemeinsame Schleife (COMMON) bleibt sauber, obwohl alle Bänder darin hängen. | COMMON, Knopf FEEDBACK +1, alle FB 1: THD 0,7 % |
| Verzerrung entsteht heute fast nur im Schutzbegrenzer am Ausgang, also nach den Bändern. Die Bänder und Schleifen selbst bekommen ein sauberes Signal. | Eingang +12 dB: THD 21 % am Ausgang, davon nur 6,7 % aus der Eingangsstufe (mit OUTPUT −24 dB gemessen) |
| Am Ende des Drehwegs passiert nichts mehr: FB je Band wird nach dem Knopf auf 1 begrenzt. | Knopf FEEDBACK über etwa halb vier ändert bei FB 1 nichts mehr. Die Bänder 1 und 2 schwingen im COMMON-Weg auch am Anschlag nicht, an der Hardware schon (Video 3, 5:40). |
| Links der Mitte wird es nur leiser, und im RES-Modus nicht einmal das. Breite Bänder summieren sich flach, invertiertes Feedback auf eine flache Summe ist nur eine Pegelabsenkung. | KNOB RES, RES 0,03: höchstens 0,5 dB. FEEDBACK, BAND: −2 bis −3 dB. FEEDBACK, COMMON, alle FB: −7 dB über alle Frequenzen gleich. |

## Hörbeispiele

Im Projektordner unter `klang-proben-2026-10-20/`, je ein Paar „heute“ und „proto“. Beide Dateien eines Paars sind auf gleiche Lautheit gebracht (RMS −16 dBFS), damit du den Charakter vergleichst und nicht die Lautstärke. Ungleich laut wäre der Prototyp in 3 und 4 deutlich lauter, siehe Punkt 2.

Ich kann die Beispiele nicht selbst hören. Die letzte Spalte zeigt deshalb Messwerte (Schwerpunkt = mittlere Frequenz des Spektrums, höher heißt heller und schärfer).

Der Prototyp enthält 2C, 3B und 4B in der Einstellung nach den Videos (Grenze 1, Reserve +0,6, Asymmetrie 0,3). 1B ist im Patch der Beispiele schon eingestellt. 5 und 6 sind nicht enthalten.

| # | Datei | Was läuft | Messung heute → Prototyp |
|---|---|---|---|
| 1 | `1-drums-input+12-fbAll0.6` | Drums, Eingang +12 dB, Fader als Lächelkurve, FB ALL 0,6. Prototyp nur mit 4B. | Kaum Unterschied: Schwerpunkt 3,7 kHz in beiden, Crest 2,8 → 3,4 dB |
| 2 | `2-drums-hw-patch-knob-0.6` | Drums, Eingang +6 dB, Hardware-Patch (COMMON, KNOB FEEDBACK, alle Bänder in der Schleife), Knopf knapp vor 15 Uhr | Schwerpunkt 3,8 → 3,7 kHz |
| 3 | `3-chords-hw-patch-knob-0.75` | Akkorde, gleicher Patch, Knopf über 15 Uhr | Schwerpunkt 1,3 → 2,2 kHz. Roh: RMS −5,4 → −1,5 dBFS, fast eine Wand |
| 4 | `4-selfosc-bands3+7` | Kein Eingang, Bänder 3 und 7 auf +6 dB, Rest gesenkt, Knopf 0,8 | Schwerpunkt 1,4 → 1,2 kHz, dafür mehr Obertöne im Bass. Roh: Spitze 0,56 → 1,0, RMS −10,1 → −2,3 dBFS |
| 5 | `5-drums-knob-sweep-left-to-right` | Drums, der Knopf fährt in 12 s von ganz links nach ganz rechts | Links: −7 dB heute, −14 dB im Prototyp (mit 3B) |

Der Prototyp-Code liegt daneben in `prototyp/`. Er patcht eine Kopie der App und ist nur zum Nachrechnen gedacht.

---

## 1. Grundeinstellung des Resonance-Knopfs

**App heute:**
- Grundeinstellung KNOB = RES, FB-Weg BAND, FB je Band 0.
- Der Knopf macht die Bänder schmaler und lauter, aber nie selbstschwingend. Zum Schreien braucht man erst FB je Band oder FB ALL, dazu CONFIG-Wissen.

**Hardware:**
- RESONANCE ist der Feedback-Regler. 12 Uhr heißt kein Feedback, ab 15 Uhr schwingt das Gerät, die Fader sind dann die Spielregler.
- Das alles geht ohne Menü.

**Optionen:**
- **A:** bleibt.
- **B:** INIT und Grundwerte wie die Hardware: KNOB = FEEDBACK, FB-Weg COMMON, FB aller Bänder auf 1 (wie „alle Schalter an“). In der Mitte klingt das genau wie heute neutral. Rechts kommt Resonanz bis zur Eigenschwingung ab 15 Uhr.

**Empfehlung: B.** Das ist der kleinste Eingriff mit der größten Wirkung, denn das Gerät verhält sich vom ersten Dreh an wie die Hardware.

**Folgen:**
- Werks-Presets setze ich ausdrücklich auf ihre bisherigen Werte, damit sie gleich klingen. Deine gespeicherten Presets tragen diese Einstellungen schon und bleiben, wie sie sind.
- RES je Band und die Modi RES und FOCUS bleiben in CONFIG wählbar.

## 2. Sättigung in den Feedback-Schleifen

**App heute:**
- Jede Schleife hat einen Begrenzer, der den Pegel über eine Hüllkurve langsam herunterregelt. Die Welle selbst bleibt rund. Deshalb ist die Eigenschwingung ein Sinus und die gemeinsame Schleife bleibt sauber.
- Nur FB ALL hat einen weichen Clipper. Gemessen: THD 26 % bei AMT 1.

**Hardware (abgeleitet):**
- Die Schleifen sind analog und clippen an den Grenzen der Verstärker. Die Welle wird flach gedrückt und bekommt viele Obertöne.
- Diese Obertöne laufen in den gemeinsamen Eingang zurück und regen andere Bänder an. Daraus entstehen das „Heulen“, Mehrklänge und die Instabilität.
- Die Tonhöhe hängt etwas am Pegel. Wird es lauter, wandert sie.

**Optionen:**
- **A:** bleibt sauber.
- **B: WARM.** Ein weicher Sättiger ersetzt den Hüllkurven-Begrenzer in den Band-Schleifen und in der COMMON-Schleife. Die Pegel bleiben etwa wie heute. Etwas mehr Obertöne, rundere Spitzen.
- **C: RAW.** Ein Sättiger mit härterem Knie und leichter Asymmetrie für gerade Obertöne. Die Grenze liegt höher, so dass die Eigenschwingung bis an die Vollaussteuerung geht wie an der Hardware.
- B und C wären eine neue Einstellung in CONFIG → Resonance: LOOP = CLEAN / WARM / RAW.

**Gemessen mit dem Prototyp (RAW nach den Videos eingestellt, zusammen mit 3B):**

| Fall | heute | RAW |
|---|---|---|
| Band 411 Hz, FB 1, breit | Klirr 0,2 %, Spitze 0,22 | Klirr 14 %, Spitze 0,44 |
| Band 411 Hz, FB 1, RES 0,45 | Klirr 0,04 %, Spitze 0,63 | Klirr 2 %, Spitze 0,95 |
| COMMON, Bänder 1 und 2, Knopf 0,8 | schwingt nicht | 39,6 Hz, Klirr 22 % (Video: 43,1 Hz, 15 bis 20 %) |
| COMMON, alle Bänder, Knopf +1 | Klirr 0,7 % | Klirr 40 %, 2. Oberton −8 dB |
| Tonhöhe der Eigenschwingung, breites Band | 413,8 Hz | 399,6 Hz, sie wandert mit dem Pegel |

Der erste, schärfere Prototyp (Grenze 2, Reserve +0,8) kam in der gemeinsamen Schleife auf 57 %. Das war mehr als in den Videos.

**Empfehlung: C**, als INIT-Einstellung, eingestellt auf die Videos: rund 15 bis 25 % Klirr am Einsatz, mehr erst am Ende des Drehwegs. WARM läge darunter. CLEAN bleibt für den heutigen Klang.

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
- **B:** Die Grenze fällt, der Knopf darf bis ×1,3 durchgreifen, und die Schleifenverstärkung am Anschlag steigt auf etwa 1,8 (Prototyp nach den Videos: Reserve +0,6). Damit schwingen auch breite Bassbänder im COMMON-Weg wie an der Hardware. Ohne Sättigung (2A) wird es dort nur lauter, mit 2B oder 2C immer dreckiger.

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
- Links wird das Feedback invertiert. Ein Test der Eurorack-Version nennt am linken Anschlag etwa −12 dB und spricht von einer dämpfenden Wirkung.
- Vermutlich klingt also auch die Hardware links vor allem leiser und gedämpfter und nicht spektakulär anders. Breite Bänder summieren sich flach, das gilt dort genauso.

**Optionen:**
- **A:** bleibt.
- **B: wie Hardware, kräftiger.** Im FEEDBACK-Modus kommt das mit 3B, links dann bis −14 dB. Im RES-Modus würde links ebenfalls invertiertes Feedback wirken statt RES zu senken. Hörbar ist vor allem: leiser, enger, weniger Nachklang.
- **C: Kerben.** Links von der Mitte bekommen alle Bandmitten eine Kerbe. Je weiter links, desto tiefer und schmaler wird sie. Das ist das Gegenstück zu rechts: rechts Spitzen an den Bandmitten, links Senken. Es klingt hohl und phasig. Das gilt in jedem Modus, im FEEDBACK-Modus zusätzlich zur Invertierung.

**Empfehlung: C.** B bildet die Hardware treuer nach, löst aber dein Problem kaum, weil es links vor allem leiser wird. C ist kein Hardware-Verhalten, aber links passiert dann hörbar etwas Eigenes.

**Aufwand C: mittel.** Je Kanal zehn Kerbfilter vor den Bändern. Sie rechnen nur, solange der Knopf links steht, rechts der Mitte bleibt die Ausgabe bitgleich.

## 6. Rauschen

**App heute:** Bei Analog 1 liegt das Grundrauschen bei −96 dBFS.

**Hardware:** Analoges Grundrauschen, wie laut ist unbekannt. Bei hoher Resonanz wird es von den Schleifen verstärkt.

**Optionen:**
- **A:** bleibt.
- **B:** Bei Analog 1 bis etwa −80 dBFS, damit Schleifen am Einsatz hörbar aus dem Rauschen anlaufen und es rauscht, wenn es pfeift.

**Empfehlung: A.** Die Rauheit in den Videos kommt aus der Verzerrung (Punkt 2), nicht aus dem Rauschen. B ist eine Kleinigkeit und lässt sich jederzeit nachziehen.

---

## Bleibt so, wenn du nichts anderes sagst

| Punkt | Vorschlag |
|---|---|
| Schutzbegrenzer am Ausgang (ab 0,8 weich bis 1,0) | bleibt, er fängt RAW ab |
| ANALOG-Drive (obere Hälfte des Analog-Reglers) | bleibt. Er verzerrt nach der Eingangsstufe und vor den Bändern und ergänzt 4B. |
| Bandfrequenzen, Bandbreite, Pegelausgleich | bleiben wie am 16.10. entschieden |
| FB ALL mit AMT und TONE | bleibt. Nur sein Clipper bekommt mit 2B oder 2C dieselbe Kennlinie wie die anderen Schleifen. |

## Was noch offen ist

- Die Videos belegen Klirr und Tonhöhe der Eigenschwingung an zwei Stellen im Bass. Wie sich Mitten und Höhen verhalten, wie laut die Eigenschwingung absolut wird und was der Knopf links an der Hardware macht, zeigen sie nicht. Am meisten würde ein eigener Mitschnitt ohne Sprache helfen, mit bekannter Knopfstellung.
- Die Stärken im Prototyp (Grenze 1, Reserve +0,6, Knie 2,5, Asymmetrie 0,3) sind nach den zwei Video-Stellen eingestellt. Nach deiner Wahl stelle ich sie nach deinem Gehör nach.
