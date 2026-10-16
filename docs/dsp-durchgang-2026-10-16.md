# DSP-Durchgang: erste App-Fassung und Hardware im Vergleich

Stand: 16.10.2026. Hardware-Angaben stammen aus [abgleich-original.md](abgleich-original.md). Den zurückgestellten Bauplan findest du in [plan-angleichung-original.md](plan-angleichung-original.md).

## Entscheidung und Umsetzung

nukular hat am 16.10.2026 `1C 2C 3C 4B 5B 6B 7A` gewählt. Umgesetzt am selben Tag:

| # | Wahl | Umsetzung |
|---|---|---|
| 1 | C | Grundwert und INIT sind breite Bänder (RES 0,03). Unter RES 0,45 werden die Bänder weniger abgesenkt, so dass alle Fader auf 0 dB flach bei 0 dB liegen (gemessen: Mittel 0,0 dB zwischen 100 Hz und 3 kHz). Werks-Presets, die schmale Bänder brauchen, setzen RES 0,45. |
| 2 | C | CONFIG → Resonance → FB: BAND (wie bisher) oder COMMON (nach dem Fader in den gemeinsamen Eingang). |
| 3 | C | CONFIG → KNOB: RES (wie bisher) oder FEEDBACK. In der Mitte wirkt das Feedback wie eingestellt, rechts bis zum Doppelten, links über null bis invertiert. |
| 4 | B | Negatives Feedback gibt es über den Knopf in der Einstellung FEEDBACK, links von der Mitte. |
| 5 | B | CONFIG → CURVE (LIN, LOG, EXP) und BANDS (ALL, HIGHS, LOWS). |
| 6 | B | FB ALL setzt bei AMT ≈ 0,75 ein, mit FEEDBACK-Knopf regelt der Knopf es mit. Gespeicherte Presets werden beim Laden umgerechnet. |
| 7 | A | Keine Änderung |

Abweichend von der Gegenüberstellung unten:
- FB ALL greift die Bänder jetzt mit ihrem Pegelausgleich ab, soweit er absenkt. Dadurch liegt der Einsatz bei breiten und schmalen Bändern gleich bei etwa 0,75. Ohne diesen Ausgleich hätte FB ALL mit den neuen breiten Grundbändern schon bei 0,41 geschwungen und mit schmalen erst bei 1,0.
- Die vier neuen Einstellungen werden im Preset gespeichert, damit ein Preset immer gleich klingt.
- Die Display-Einstellungen sind in der CONFIG-Seite in die Audio-Karte gewandert, damit die neue Resonance-Karte Platz hat.

---

Die Gegenüberstellung, wie sie vor der Entscheidung stand:

## Vorweg

**Was mit „erste Fassung“ gemeint ist:**
- Der Klangkern ist seit der ersten Fassung vom 9.10. unverändert. Dazu gehören die Bänder, die Feedback-Schleifen, FB ALL, Spread, Analog sowie Ein- und Ausgang.
- Seitdem dazugekommen sind Band-Dynamik, Pre-/Post-Filter und Modulation. Geändert hat sich nur die Fader-Kennlinie (0 dB in der Mitte).
- Der Bauplan „Klangkern nach Handbuch“ wurde nicht umgesetzt.
- Verglichen wird deshalb die erste App-Fassung, also der heutige Stand, mit der Hardware.

**Bereits entschieden:**
- RES und FB je Band bleiben, ebenso der globale Resonance-Knopf.
- Die Fader bleiben Bandpegel, mit 0 dB in der Mitte.

**Was du entscheidest:**
- Die Punkte 1 bis 7 haben je Optionen A, B, C …
- Antworte einfach mit einer Zeile wie `1C 2C 3C 4B 5B 6B 7A`.
- Alles unter „Bleibt so“ ändere ich nur, wenn du es sagst.

## Kurzübersicht

| # | Punkt | Optionen | Empfehlung |
|---|---|---|---|
| 1 | Bandbreite, Mittelstellung flach | A bleibt · B breite Grundstellung · C wie B, dazu Pegelausgleich | **C** |
| 2 | Weg des Feedbacks je Band | A bleibt · B Abgriff nach dem Fader · C Wahl BAND / GEMEINSAM | **C**, Grundeinstellung BAND |
| 3 | Globaler Resonance-Knopf | A RES-Versatz · B Feedback-Regler · C Wahl in CONFIG · D beides zugleich | **C**, Grundeinstellung RES |
| 4 | Negatives Feedback | A keins · B über den Resonance-Knopf · C auch je Band | **B** |
| 5 | Resonanz-Kennlinie | A keine · B Wahl in CONFIG | **B** |
| 6 | FB ALL | A bleibt · B Einsatz früher · C Resonance-Knopf regelt mit | **B**, dazu C bei 3C |
| 7 | Klang der Eigenschwingung | A sauber · B mit Drive | **A** |

Aufwand: 1, 6 und 7 sind klein. 3, 4 und 5 sind mittel und hängen zusammen. 2C ist mittel.

## Messwerte der heutigen DSP

Offline mit dem Testkit gemessen. Der Frequenzgang stammt aus der Impulsantwort mit Analog 0 und Dry/Wet ganz auf Wet. Als Eigenschwingung gilt, wenn die App nach einem kurzen Rauschstoß von selbst weiterklingt.

| Messung | Ergebnis |
|---|---|
| Alle Fader 0 dB, RES 0,45 (Grundwert, Güte 6,5) | Bandmitten 0 dB, dazwischen −16 bis −19 dB. Welligkeit 23,5 dB zwischen 50 Hz und 9 kHz. |
| Alle Fader 0 dB, RES 0,3 (Güte 2,9) | Bandmitten −3,7 dB, dazwischen um −11 dB. Welligkeit 11,7 dB. |
| Alle Fader 0 dB, RES 0,03 (Güte 0,7, Hardware-Breite) | Fast flach mit 2,4 dB Welligkeit, aber insgesamt **6 dB leiser** (um −6 dB). |
| Pegel eines Bandes je nach RES | RES 0: −14,5 dB · RES 0,45: 0 dB · RES 1: +17,7 dB |
| FB je Band: Einsatz der Eigenschwingung | Bei 0,87, in jedem Band gleich. Fader und Resonance-Knopf verschieben das nicht: FB 0,86 mit Fader auf +12 dB schwingt nicht. |
| Resonance-Knopf auf +1, FB 0 | Keine Eigenschwingung, die Bänder klingen nur sehr lang nach. |
| FB ALL: Einsatz in Grundeinstellung | Erst bei AMT 0,97, also fast am Anschlag |
| FB ALL, alle Fader auf +6 dB bzw. −6 dB | Einsatz bei 0,48 bzw. nie |
| FB ALL, breite Bänder (RES 0,03) | Einsatz bei 0,41 |

---

## 1. Bandbreite und Mittelstellung

**App heute:**
- RES je Band stellt die Güte von 0,6 bis 120 ein. Der Grundwert 0,45 entspricht Güte 6,5.
- Mehr RES macht ein Band schmaler und zugleich lauter, bis +17,7 dB. Weniger RES macht es breiter und leiser, bis −14,5 dB. Das klingt wie ein analoges Resonanzfilter.
- Stehen alle Fader auf 0 dB, bleibt eine Kammstruktur: Spitzen an den Bandmitten, tiefe Senken dazwischen.

**Hardware:**
- Die Bänder sind fest und breit: 17 dB/Dekade, Güte um 0,7.
- Stehen alle Fader in der Mitte, ist die Summe annähernd flach. Das Gerät klingt dann neutral.

**Was man hört:**
- Die App klingt schon in der Grundstellung nach Filterbank, also hohl und vokal.
- Die Hardware ist in der Grundstellung neutral. Charakter bekommt sie erst über die Fader und die Resonanz.
- Die Breite der Hardware schafft die App schon heute mit RES 0,03. Dann ist sie aber 6 dB leiser, weil die Absenkung bei wenig RES stärker ist, als die Überlappung der Bänder ausgleicht.

**Optionen:**
- **A:** bleibt wie es ist.
- **B:** INIT und Grundwert von RES auf breite Bänder (RES 0,03). Die DSP bleibt unverändert, die fehlenden 6 dB gleichst du mit OUTPUT aus.
- **C:** wie B. Dazu gleicht die DSP den Pegel bei wenig RES aus, so dass breite Bänder in der Mitte genau 0 dB ergeben. Ab RES 0,45 aufwärts bleibt alles, wie es ist.

**Empfehlung: C.**
- Die Mittelstellung ist dann wirklich neutral wie an der Hardware.
- RES je Band bleibt dein Werkzeug für schmale, klingelnde Bänder.

**Folgen:**
- Bei C werden Presets mit RES unter 0,45 bis zu 6 dB lauter, je weniger RES, desto mehr.
- Die Feedback-Schleifen ändern sich nicht, weil der Ausgleich hinter ihnen sitzt.

## 2. Weg des Feedbacks je Band

**App heute:**
- FB ist ein stufenloser Regler von 0 bis 1 pro Band.
- Das Band führt nur in **sich selbst** zurück, und zwar **vor** dem Fader.
- Ab 0,87 schwingt es, genau auf seiner Mittenfrequenz. Fader und Resonance-Knopf ändern daran nichts.
- Die Nachbarbänder bleiben unberührt.

**Hardware:**
- Jedes Band hat einen Schalter. Ist er an, läuft der Bandausgang **nach dem Fader** in den **gemeinsamen Eingang** aller Bänder. Die Stärke kommt vom RESONANCE-Knopf.
- Bei hoher Resonanz fängt ein Band an zu schwingen, sobald man seinen Fader hochzieht. Der Fader ist damit auch ein Spielregler für die Resonanz.
- Weil die breiten Bänder überlappen, regt die Rückführung auch die Nachbarn an. Die Töne liegen weniger fest, und Bänder können sich gegenseitig ziehen.

**Was man hört:**
- Die App ist präzise und lässt sich pro Band genau dosieren.
- Die Hardware klingt wilder und verwobener.

**Optionen:**
- **A:** bleibt wie es ist.
- **B:** Der Abgriff wandert hinter den Fader, sonst bleibt alles gleich. Der Fader bestimmt dann mit, wie stark ein Band klingelt. Auf +12 dB schwingt ein Band schon bei FB um 0,22.
- **C:** eine Einstellung „FB-Weg“ in CONFIG:
  - BAND: wie heute.
  - GEMEINSAM: wie die Hardware, nach dem Fader in den gemeinsamen Eingang.
  - Der FB-Regler je Band bleibt in beiden Fällen stufenlos. Bei GEMEINSAM bestimmt er, wie viel das Band zur gemeinsamen Rückführung beiträgt.

**Empfehlung: C, mit BAND als Grundeinstellung.**
- Du behältst die erste Fassung und kannst die Hardware-Variante direkt daneben hören.

**Folgen:**
- Mit BAND klingen alle Presets wie bisher.
- Die Rechenlast bleibt praktisch gleich. Die Schleife wird weiter verzögerungsfrei gelöst, die Tonhöhe stimmt also auch bei 11 kHz.

## 3. Globaler Resonance-Knopf

**App heute:**
- Der Knopf verschiebt RES aller Bänder, von −1 bis +1.
- Feedback berührt er nicht. Auch auf +1 schwingt nichts von selbst, die Bänder klingen nur länger nach.

**Hardware:**
- Der Knopf ist ein Attenuverter für das Feedback.
- 12 Uhr bedeutet kein Feedback. Nach rechts wird es mehr, ab etwa 15 Uhr schwingt das Gerät selbst. Nach links wird das Feedback invertiert.

**Was man hört:**
- In der App regelt der Knopf Schärfe und Nachklang aller Bänder.
- An der Hardware ist er der zentrale Spielregler, bis in die Eigenschwingung.

**Optionen:**
- **A:** bleibt RES-Versatz.
- **B:** wie die Hardware. Er skaliert alle Feedbacks, also FB je Band und FB ALL, und invertiert links.
- **C:** eine Einstellung „Resonance-Knopf“ in CONFIG: RES (wie heute) oder FEEDBACK (wie die Hardware).
- **D:** beides zugleich. Rechts mehr RES und mehr Feedback, links weniger RES und invertiertes Feedback.

**Empfehlung: C, mit RES als Grundeinstellung.**

**Folgen:**
- Bei FEEDBACK ist offen, was 12 Uhr bedeutet:
  - Wie an der Hardware: kein Feedback. Dann wirken deine FB-Regler erst, wenn der Knopf rechts steht, und bestehende Presets klingen anders.
  - **Mein Vorschlag:** 12 Uhr heißt, die FB-Regler wirken wie eingestellt. Rechts geht es bis etwa zum Doppelten, links über null bis ins Invertierte. Presets klingen dann gleich.

## 4. Negatives Feedback

**App heute:** gibt es nicht. FB je Band und FB ALL gehen von 0 bis 1.

**Hardware:** Links von 12 Uhr wird das Feedback invertiert.

**Was man hört:**
- Invertiertes Feedback dämpft. Die Bänder werden breiter und leiser, und zwischen ihnen können Senken entstehen.
- Mit dem gemeinsamen Eingang der Hardware (2C GEMEINSAM) ist das ein eigener, hohler Klang.
- Mit dem heutigen Weg je Band macht es ein Band nur breiter und leiser. Das ist fast dasselbe wie weniger RES.

**Optionen:**
- **A:** keins.
- **B:** nur über den Resonance-Knopf in der Einstellung FEEDBACK (Punkt 3), links von der Mitte.
- **C:** zusätzlich geht FB je Band von −1 bis +1.

**Empfehlung: B.** Es hängt an Punkt 3 (B oder C). Am meisten bringt es zusammen mit 2C.

## 5. Resonanz-Kennlinie

**App heute:**
- Es gibt keine Wahl.
- RES wirkt exponentiell auf die Güte, FB wirkt bis zum Einsatz linear.

**Hardware:**
- Im Menü wählbar: balanced, only highs, only lows, linear, logarithmic, exponential.
- Das Handbuch erklärt die Kurven nicht.

**Optionen:**
- **A:** keine.
- **B:** eine Einstellung für den Resonance-Knopf in CONFIG, mit zwei Teilen:
  - Der Drehweg: linear, log oder exp.
  - Die Gewichtung über die Bänder: gleich (balanced), zu den Höhen ansteigend (only highs) oder zu den Tiefen ansteigend (only lows).

**Empfehlung: B, zusammen mit Punkt 3.**
- Das wirkt auch, wenn der Knopf auf RES steht. Zum Beispiel lassen sich nur die Höhen klingeln, ohne dass der Bass dröhnt.
- Meine Lesart von only highs und only lows ist nicht belegt. Der Bauplan nennt eine zweite Lesart: Nur die rechte bzw. linke Hälfte des Knopfes wirkt. Ich halte die Gewichtung über die Bänder für klanglich nützlicher.

## 6. FB ALL

**App heute:**
- FB ALL hat einen eigenen Schalter, AMT von 0 bis 1 und einen TONE-Tiefpass von 200 Hz bis 20 kHz. Dazu kommen eine DC-Sperre und ein Begrenzer, der die Rückführung auf höchstens 0,7 hält.
- Der Abgriff sitzt nach den Fadern, wie an der Hardware, und nach der Band-Dynamik.
- Gemessen: In Grundeinstellung schwingt es erst ab AMT 0,97, also fast am Anschlag.
- Die Fader regeln stark mit: Mit allen Fadern auf +6 dB setzt die Schwingung schon bei 0,48 ein, mit −6 dB nie.

**Hardware:**
- Ein Schalter (pro Kanal) ohne eigenen Mengenregler. Die Stärke kommt vom Resonance-Knopf.
- Im Loop sitzt laut Handbuch kein Filter.

**Optionen:**
- **A:** bleibt wie es ist.
- **B:** AMT wird neu skaliert, so dass die Eigenschwingung in Grundeinstellung bei etwa 0,75 einsetzt. Das entspricht etwa 15 Uhr an der Hardware, und darüber bleibt Raum zum Spielen.
- **C:** Zusätzlich regelt der Resonance-Knopf in der Einstellung FEEDBACK auch FB ALL mit (Punkt 3).

**Empfehlung: B, und C, wenn du bei Punkt 3 C wählst.**
- AMT und TONE sind Zusätze der App, die ich behalten würde.

**Folgen:**
- Gespeicherte Presets rechne ich bei B um, damit sie gleich klingen.
- Mit breiten Bändern (Punkt 1) setzt FB ALL deutlich früher ein. Das ist wie an der Hardware gewollt.

## 7. Klang der Eigenschwingung

**App heute:**
- Ein sauberer Begrenzer hält die Schwingung auf einem fast reinen Sinus, genau auf der Bandmitte und unter Vollaussteuerung.
- Analog dämpft laute, schmale Bänder etwas und färbt sie leicht.

**Hardware:**
- Die Schleife ist analog.
- Wie sie begrenzt, sagt das Handbuch nicht: ob sanftes Clipping, wie viele Obertöne, ob die Tonhöhe leicht wandert.

**Optionen:**
- **A:** bleibt wie es ist.
- **B:** zusätzlich ein Drive in der Schleife, also sanftes Clipping, zum Beispiel als Teil von Analog. Das gibt mehr Obertöne und klingt schmutziger.

**Empfehlung: A.** B nur, wenn dir die Eigenschwingung zu sauber klingt. Das entscheidest du am besten nach Gehör.

---

## Bleibt so, wenn du nichts anderes sagst

| Punkt | App | Hardware | Vorschlag |
|---|---|---|---|
| Bandfrequenzen | 10 Bänder, 29 Hz bis 11 kHz | gleich | bleibt |
| Eingangsstufe | 0 bis +24 dB, sanfte Sättigung. Analog macht sie leicht asymmetrisch. | 0 bis +24 dB, übersteuert sanft | bleibt |
| Ausgang | Dry/Wet mit gleicher Leistung, OUTPUT −24 bis +12 dB, Schutzbegrenzer, weicher Bypass | Dry/Wet, Volume, Bypass über Fußschalter | bleibt |
| Analog | Toleranzen, Drift, Rauschen und Sättigung, in CONFIG | steckt im Gerät selbst | bleibt |
| Spread | Odd/Even: ungerade Bänder links, gerade rechts, wie die ODD/EVEN-Ausgänge der Eurorack-Version | Desktop: Versatz eines Kanals bzw. Kanalwahl (FB CH-SELECT) | bleibt. CLASSIC und die Kanalwahl kommen mit „L/R pro Band“. |
| Stereo | Eigene Filter je Kanal, aber gleiche Werte für L und R | alles je Kanal, auch die Feedback-Schalter | kommt mit „L/R pro Band“ |
| Band-Dynamik (Dyn EQ) | Kompressor je Band. Er misst das eigene Band und bremst auch FB ALL. | Spektralanalyse von Eingang oder Ausgang, mit Delay und Eingangsfilter | bleibt. Quellenwahl, Delay und Filter kommen im Schritt „Hardware-Modi“. |
| Pre-/Post-Filter, Clock-Mods | Eigene Digitalfilter und Takt-Quellen | FILTER und CLK MOD formen die Bandpegel | bleibt. Die Hardware-Varianten kommen im Schritt „Hardware-Modi“. |
