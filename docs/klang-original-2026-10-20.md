# Klang näher am Original: rauer, aggressiver, Knopf links

Stand: 20.10.2026. Anlass: nukular findet die App im Vergleich zu Videos der Hardware zu zahm, und der RESONANCE-Knopf tut links der Mitte fast nichts.
Grundlagen: [abgleich-original.md](abgleich-original.md) (Handbuch), [original-recherche.md](original-recherche.md) (Testberichte), [dsp-durchgang-2026-10-16.md](dsp-durchgang-2026-10-16.md) (heutiger Stand). Messwerte: `node scripts/measure-character.mjs`. Hörbeispiele: Projektordner `klang-proben-2026-10-20/`.

## Vorweg

**Was du entscheidest:**
- Die Punkte 1 bis 6 haben je Optionen A, B, C …
- Antworte einfach mit einer Zeile wie `1B 2C 3B 4B 5C 6A`.
- Am DSP ändere ich nichts, bevor du gewählt hast. Gemessen und hörbar gemacht habe ich alles mit einem Prototyp außerhalb der App.

**Woher das Bild der Hardware kommt:**
- Das Handbuch beschreibt das Gerät als laut und instabil. Mehrere Werks-Presets sind ausdrücklich Verzerrer, bis hin zu hartem Clipping. Die beiden wichtigsten Regler sind laut Handbuch INPUT GAIN und RESONANCE.
- Sound On Sound beschreibt die Feedback-Schleifen als Weg „von leichtem Overdrive bis zu heulender Verzerrung“ und den Filter-Modus als „eher ein Verzerrungswerkzeug“. Nutzer warnen vor plötzlichen Pegelspitzen und raten zu einem Limiter.
- Wie die analogen Schleifen genau begrenzen, steht nirgends. Ich nehme an, dass sie an den Versorgungsgrenzen der Operationsverstärker clippen. So verhalten sich analoge Feedback-Schaltungen, und es passt zu allen Beschreibungen. **Das ist abgeleitet, nicht belegt.** Ein Video als Datei würde es belegen, siehe „Was noch offen ist“.

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

## Warum es heute zahm klingt

Offline gemessen, Sinus oder kurzer Rauschstoß, Analog 0,5 wenn nicht anders angegeben. Der Klirrfaktor (THD) gibt an, wie viel Obertöne neben dem Grundton liegen.

| Befund | Messung heute |
|---|---|
| In der Grundeinstellung schwingt nichts: KNOB = RES verschiebt nur die Bandgüte, Feedback gibt es erst mit FB je Band. | Knopf auf +1 mit FB 0: keine Eigenschwingung |
| Die Eigenschwingung ist ein fast reiner, leiser Sinus. Ein Hüllkurven-Begrenzer regelt den Pegel, ohne die Welle zu verformen. | Band 411 Hz, FB 1, breit: THD 0,2 %, Spitze 0,22 (−13 dBFS). Schmal (RES 0,45): THD 0,04 %, Spitze 0,63. |
| Auch die gemeinsame Schleife (COMMON) bleibt sauber, obwohl alle Bänder darin hängen. | COMMON, Knopf FEEDBACK +1, alle FB 1: THD 0,7 % |
| Verzerrung entsteht heute fast nur im Schutzbegrenzer am Ausgang, also nach den Bändern. Die Bänder und Schleifen selbst bekommen ein sauberes Signal. | Eingang +12 dB: THD 21 % am Ausgang, davon nur 6,7 % aus der Eingangsstufe (mit OUTPUT −24 dB gemessen) |
| Am Ende des Drehwegs passiert nichts mehr: FB je Band wird nach dem Knopf auf 1 begrenzt. | Knopf FEEDBACK über etwa halb vier ändert bei FB 1 nichts mehr |
| Links der Mitte wird es nur leiser, und im RES-Modus nicht einmal das. Breite Bänder summieren sich flach, invertiertes Feedback auf eine flache Summe ist nur eine Pegelabsenkung. | KNOB RES, RES 0,03: höchstens 0,5 dB. FEEDBACK, BAND: −2 bis −3 dB. FEEDBACK, COMMON, alle FB: −7 dB über alle Frequenzen gleich. |

## Hörbeispiele

Im Projektordner unter `klang-proben-2026-10-20/`, je ein Paar „heute“ und „proto“. Beide Dateien eines Paars sind auf gleiche Lautheit gebracht (RMS −16 dBFS), damit du den Charakter vergleichst und nicht die Lautstärke. Ungleich laut wäre der Prototyp in 3 und 4 deutlich lauter, siehe Punkt 2.

Ich kann die Beispiele nicht selbst hören. Die letzte Spalte zeigt deshalb Messwerte (Schwerpunkt = mittlere Frequenz des Spektrums, höher heißt heller und schärfer).

Der Prototyp enthält 2C, 3B und 4B. 1B ist im Patch der Beispiele schon eingestellt. 5 und 6 sind nicht enthalten.

| # | Datei | Was läuft | Messung heute → Prototyp |
|---|---|---|---|
| 1 | `1-drums-input+12-fbAll0.6` | Drums, Eingang +12 dB, Fader als Lächelkurve, FB ALL 0,6. Prototyp nur mit 4B. | Kaum Unterschied: Schwerpunkt 3,7 kHz in beiden, Crest 2,8 → 3,4 dB |
| 2 | `2-drums-hw-patch-knob-0.6` | Drums, Eingang +6 dB, Hardware-Patch (COMMON, KNOB FEEDBACK, alle Bänder in der Schleife), Knopf knapp vor 15 Uhr | Schwerpunkt 3,8 → 3,4 kHz |
| 3 | `3-chords-hw-patch-knob-0.75` | Akkorde, gleicher Patch, Knopf über 15 Uhr | Schwerpunkt 1,3 → 2,1 kHz. Roh: RMS −5,4 → −0,1 dBFS, also eine Wand |
| 4 | `4-selfosc-bands3+7` | Kein Eingang, Bänder 3 und 7 auf +6 dB, Rest gesenkt, Knopf 0,8 | Schwerpunkt 1,4 → 3,2 kHz. Roh: Spitze 0,56 → 1,0 |
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

**Gemessen mit dem Prototyp (RAW, zusammen mit 3B):**

| Fall | heute | RAW |
|---|---|---|
| Band 411 Hz, FB 1, breit | THD 0,2 %, Spitze 0,22 | THD 11 %, Spitze 0,90 |
| Band 411 Hz, FB 1, RES 0,45 | THD 0,04 %, Spitze 0,63 | THD 21 %, Spitze 1,0 |
| COMMON, alle Bänder, Knopf +1 | THD 0,7 % | THD 57 %, 2. und 3. Oberton nur −10 dB unter dem Grundton |
| Tonhöhe der Eigenschwingung, breites Band | 413,8 Hz | 401 Hz, sie wandert mit dem Pegel |

**Empfehlung: C**, als INIT-Einstellung. CLEAN bleibt für den heutigen Klang.

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
- **B:** Die Grenze fällt, der Knopf darf bis ×1,3 durchgreifen, und die Schleifenverstärkung am Anschlag steigt auf etwa 2. Ohne Sättigung (2A) wird es dort nur lauter, mit 2B oder 2C immer dreckiger.

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

- Wie hart die Hardware-Schleifen clippen, wie laut die Eigenschwingung wird und wie viel Obertöne sie hat, ist abgeleitet. Ein Mitschnitt der Hardware als Datei (Video oder Audio, hier im Thread hochgeladen) würde das klären. Dann messe ich Obertöne, Pegel und Tonhöhe der Eigenschwingung und stelle WARM und RAW danach ein. YouTube-Links kann ich von hier aus nicht abrufen.
- Die Stärken im Prototyp (Grenze 2, Reserve +0,8, Knie 2,5, Asymmetrie 0,1) sind erste Werte nach Messung, nicht nach Gehör. Nach deiner Wahl stelle ich sie nach deinem Hören ein.
