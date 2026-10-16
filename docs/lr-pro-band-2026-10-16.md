# L/R pro Band: Entscheidungspunkte

Stand: 16.10.2026. Grundlage ist der Vorschlag in [antworten-2026-10-10.md](antworten-2026-10-10.md), Abschnitt 1, angepasst an den Stand nach dem DSP-Durchgang ([dsp-durchgang-2026-10-16.md](dsp-durchgang-2026-10-16.md)).

## Vorweg

**Hardware:**
- Die Hardware hat zwei Sätze mit je 10 Bandpässen, einen für L und einen für R.
- Normalerweise bewegen die Fader beide Kanäle gemeinsam.
- Über eine Einstellung wird der SPREAD-Knopf zum Kanalwähler: links nur L, Mitte beide, rechts nur R. Das gilt für die Fader und die Feedback-Schalter.

**App heute:**
- Die DSP rechnet L und R schon mit eigenen Filtern, jeder Kanal mit eigener Bauteiltoleranz.
- Pegel, RES und FB gelten aber für beide Kanäle gleich.
- SPREAD ist ein Odd/Even-Panning: ungerade Bänder nach links, gerade nach rechts.

**Was du entscheidest:**
- Die Punkte 1 bis 5 haben je Optionen A, B, C.
- Antworte mit einer Zeile wie `1C 2A 3A 4A 5B`.
- Was unter „So baue ich es“ und „Bleibt so“ steht, ändere ich nur, wenn du etwas anderes sagst.

## Kurzübersicht

| # | Punkt | Optionen | Empfehlung |
|---|---|---|---|
| 1 | Was getrennt wird | A nur Pegel · B Pegel, RES, FB · C wie B, dazu FB ALL | **C** |
| 2 | Wie du L und R wählst | A eigener Umschalter · B SPREAD wird Kanalwähler | **A** |
| 3 | Fader in L+R, wenn L und R verschieden stehen | A Versatz bleibt · B beide springen gleich | **A** |
| 4 | Anzeige der zwei Werte | A ein Griff plus Marke · B geteilter Fader | **A** |
| 5 | Modulation auf Bandwerte | A beide Kanäle gleich · B Kanalwahl je Route | **B** |

**Aufwand:**
- Die DSP-Änderung ist klein, weil die Filter schon je Kanal getrennt sind. Die Rechenlast bleibt fast gleich.
- Parameter, Presets, Fader und FB-Register sind mittlerer Aufwand.
- 5B ist ebenfalls mittel.

---

## 1. Was pro Kanal getrennt wird

**Optionen:**
- **A:** nur der Bandpegel. RES und FB bleiben für beide Kanäle gleich.
- **B:** Pegel, RES und FB je Band und Kanal. Das ist der Vorschlag vom 10.10.
- **C:** wie B, dazu FB ALL je Kanal, also Schalter und AMT. TONE bleibt gemeinsam.

**Empfehlung: C.**
- An der Hardware ist alles je Kanal getrennt, auch der Summen-Loop.
- Mit C kann zum Beispiel nur L klingeln, während R trocken bleibt.
- Gegenüber B kommen nur zwei Werte dazu.

**Was das klanglich bringt:**
- Ein Band kann links laut und rechts leise sein, und umgekehrt.
- Mit leicht verschiedenem RES klingeln L und R unterschiedlich lang. Mit FB nur auf einer Seite schwingt ein Band nur auf dieser Seite.

## 2. Wie du L und R wählst

**Optionen:**
- **A:** ein eigener Umschalter **L · L+R · R** in der rechten Spalte unter SPREAD.
  - Er gilt für die Fader und für RES und FB im FB-Register. Bei 1C gilt er auch für FB ALL.
  - SPREAD bleibt der Klangregler wie bisher.
- **B:** wie an der Hardware. In CONFIG lässt sich SPREAD zum Kanalwähler machen: links L, Mitte beide, rechts R. Solange das eingestellt ist, gibt es kein Odd/Even-Panning.

**Empfehlung: A.**
- Du verlierst keinen Klangregler.
- Ein Knopf, der mal Klang und mal Wahl ist, ist am Bildschirm schwer zu lesen.

**In beiden Fällen gilt:**
- Die Wahl ist eine Bedienhilfe und wird nicht im Preset gespeichert.
- Beim Start steht sie auf L+R.

## 3. Fader in L+R, wenn L und R verschieden stehen

**Optionen:**
- **A:** Beide Kanäle bewegen sich um denselben Betrag, der Versatz bleibt erhalten.
  - Stößt ein Kanal an den Anschlag (+12 dB oder stumm), bleibt er dort stehen und der andere läuft weiter. Der Versatz wird dann kleiner.
- **B:** Wer in L+R einen Fader anfasst, setzt beide Kanäle auf denselben Wert. Der Versatz ist sofort weg.

**Empfehlung: A.**
- Eine Stereo-Einstellung bleibt erhalten, auch wenn du danach in L+R weiterarbeitest.

**In beiden Fällen gilt:**
- Ein Knopf **R = L** neben dem Umschalter setzt alle R-Werte auf die von L zurück.
- Doppelklick auf einen Fader setzt wie bisher auf 0 dB, in L+R beide Kanäle.

## 4. Anzeige der zwei Werte

**Optionen:**
- **A:** Der Fader behält seinen einen Griff.
  - In L oder R zeigt der Griff den gewählten Kanal. Eine dünne Marke zeigt den anderen Kanal, sobald er abweicht.
  - In L+R steht der Griff in der Mitte zwischen L und R, und zwei dünne Marken zeigen beide Kanäle.
  - Die Anzeige unter dem Fader zeigt bei Abweichung beide Werte, zum Beispiel `−3|+2`.
  - Die Knöpfe RES und FB zeigen den anderen Kanal als zweiten, dünnen Zeiger.
- **B:** geteilte Fader: zwei schmale Griffe nebeneinander, links L, rechts R. Die Knöpfe zeigen zwei Bögen.

**Empfehlung: A.**
- Solange L und R gleich stehen, sieht alles aus wie heute.
- Die zusätzliche Anzeige erscheint nur, wenn es etwas zu zeigen gibt.
- Die Fader bleiben breit genug zum Greifen.

## 5. Modulation auf Bandwerte

**Optionen:**
- **A:** Eine Route auf einen Bandwert bewegt beide Kanäle gleich, wie heute.
- **B:** Jede Route auf einen Bandwert bekommt eine Kanalwahl. Grundeinstellung ist L+R.
  - **L+R:** wie heute.
  - **L** oder **R:** wirkt nur auf diesen Kanal.
  - **INV:** R bewegt sich gegenläufig zu L. Ein LFO auf den Pegel lässt das Band so zwischen links und rechts wandern.

**Empfehlung: B.**
- So ist auch die Hardware gebaut: Jede Modulation ist je Kanal an, aus oder invertiert.
- INV ergibt spektrales Panning mit nur einer Route.
- Bestehende Presets klingen gleich, weil ihre Routen auf L+R stehen.

**Folge:** Die Kanalwahl sitzt in der Routenliste und im Modulations-Popup. Bei Zielen, die keine Bandwerte sind, erscheint sie nicht.

---

## So baue ich es

**DSP:**
- Jeder Filter liest künftig seinen eigenen Pegel, sein RES und sein FB.
- Pegelausgleich, Feedback-Abgriff, der Weg COMMON und der FEEDBACK-Knopf rechnen je Kanal.

**Presets:**
- Das Preset-Format wird Version 4.
- Fehlt in einem Preset ein R-Wert, gilt der Wert von L. Alte Presets und die Werks-Presets klingen dadurch unverändert.

**FB-Register:**
- Die Antwortkurve zeigt L und R als zwei Linien, sobald sie sich unterscheiden.
- Die Bandknoten zeigen das Feedback beider Kanäle.

**PANIC:** setzt FB in beiden Kanälen auf 0 und schaltet FB ALL in beiden Kanälen aus.

**Neue Tests:**
- L und R getrennt einstellbar
- Alte Presets ergeben R = L
- Route mit INV
- Der Versatz bleibt in L+R

## Bleibt so

- SPREAD bleibt das Odd/Even-Panning.
- INPUT, RESONANCE, DRY/WET und OUTPUT bleiben für beide Kanäle gemeinsam, ebenso die Einstellungen der Resonance-Karte in CONFIG.
- Band-Dynamik (DYN EQ) und die Envelope Follower messen weiter beide Kanäle gemeinsam.
- Die LED-Kette neben jedem Fader zeigt weiter beide Kanäle zusammen.
- Getrennte MIDI-Kanäle für L und R kommen mit dem MIDI-Paket.
