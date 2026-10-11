# Antworten auf die fünf Fragen vom 10.10.2026

Nur Antworten, am Code ist nichts geändert. Grundlage sind das Handbuch (Seiten in Klammern), [abgleich-original.md](abgleich-original.md) und der aktuelle Stand der App.

## 1. Spread pro Band: L und R getrennt einstellen

**Wie es die Hardware macht (S. 7, 8, 18):**
- Es gibt zwei Sätze mit je 10 Bandpässen, einen für L und einen für R.
- Die Fader bewegen normalerweise beide Kanäle gemeinsam.
- Mit der Einstellung FB CH-SELECT wird der SPREAD-Knopf im FB-Modus zum Kanalwähler: links nur L, 12 Uhr beide, rechts nur R. Das gilt für Fader und Feedback-Schalter.
- In der Einstellung CLASSIC versetzt SPREAD einen Kanal leicht gegenüber dem anderen.

**Was die App heute hat:**
- Die DSP rechnet L und R bereits mit eigenen Filtern, inklusive eigener Bauteiltoleranz pro Kanal.
- Jeder Wert (Pegel, RES, FB) gilt aber für beide Kanäle.
- Spread ist ein Odd/Even-Panning: ungerade Bänder nach links, gerade nach rechts.

**Vorschlag:**
- Jedes Band bekommt Pegel, RES und FB je Kanal.
- Über den Fadern kommt ein Wahlschalter **L / BEIDE / R**. Er übernimmt die Rolle von FB CH-SELECT, so dass der Spread-Knopf seinen Klangzweck behält.
- In BEIDE bewegt ein Fader beide Kanäle um denselben Betrag, ein vorhandener Versatz bleibt erhalten.
- Jeder Fader zeigt beide Werte, zum Beispiel einen zweiten, dünnen Griff für den anderen Kanal.
- Ein Befehl „L = R“ koppelt die Kanäle wieder.

**Betroffene Teile:**

| Teil | Auswirkung |
|---|---|
| DSP | klein: Die Filter sind schon getrennt, sie lesen künftig je Kanal ihren eigenen Wert. Die Rechenlast bleibt gleich. |
| Parameter und Presets | mittel: 30 neue Bandwerte und eine neue Version des Preset-Formats. Alte Presets werden übernommen (R = L). |
| Modulation | mittel: Eine Route auf einen Bandwert wirkt auf beide Kanäle. Später ist pro Route optional L, R oder INV wählbar, wie an der Hardware (S. 13–14). |
| Oberfläche | mittel: Fader, FB-Register (zwei Kurven) und Analyser (L/R) zeigen zwei Werte. |
| Filter, Dyn EQ, Clock, LFO, ENV, Makros | keine Änderung nötig |

## 2. FB ALL im Vergleich zur Hardware

**Gleich ist:** Die Summe aller Bänder läuft zurück in den gemeinsamen Eingang aller Bänder. Bei uns wird sie nach den Fadern abgegriffen. FB ALL und die Feedback-Schleifen pro Band laufen gleichzeitig, wie das „dual resonance“ der Hardware.

**Anders ist:**

| Punkt | Hardware (S. 5, 8) | App |
|---|---|---|
| Stärke | Kein eigener Regler. Der RESONANCE-Knopf regelt alle Schleifen. | Eigener Regler AMT |
| Negatives Feedback | Links von 12 Uhr wird das Feedback invertiert. | Nicht möglich, AMT geht nur von 0 bis 1. |
| Filter im Loop | Laut Handbuch keins | Tone-Tiefpass (200 Hz bis 20 kHz), dazu DC-Sperre und Soft-Clip (Rückführung höchstens 0,7) |
| Stereo | Für L und R getrennt schaltbar | Nur für beide Kanäle gemeinsam |
| Rolle von RESONANCE | Regelt die Feedback-Stärke | Verschiebt nur das RES aller Bänder und berührt den Loop nicht |
| Feedback pro Band | Schalter, der den Bandausgang in den **gemeinsamen** Eingang schickt | Stufenloser Regler, der nur in das **eigene** Band zurückläuft |
| Band-Dynamik | Gibt es so nicht | Der Dyn EQ bremst auch den Summen-Loop, weil dieser nach den Fadern abgreift. |

## 3. FB und RES je Band behalten, dazu der globale Resonance-Regler

Das geht, alle drei bleiben.

Offen ist nur, was der globale Regler tun soll. Zwei Varianten, die sich nicht ausschließen:
- **Wie jetzt:** RES aller Bänder verschieben (−1 bis +1).
- **Zusätzlich wie an der Hardware:** Er regelt die Stärke aller Feedback-Schleifen mit. Rechts wird es mehr, links wird es invertiert.

Die Wahl könnte eine Einstellung in CONFIG sein, zusammen mit der Resonanz-Kennlinie der Hardware: balanced, only highs, only lows, linear, log, exp (S. 19). Das gehört in die DSP-Runde.

## 4. Was noch umgesetzt werden müsste

Gemessen am Handbuch, ohne das, was du behalten willst (RES und FB je Band, globaler Resonance).

**Kern und Klang**
1. L und R getrennt mit Kanalwahl, FB ALL je Kanal (Punkt 1)
2. Spread wie an der Hardware: Versatz bzw. Verzögerung je Modus, als Alternative zu Odd/Even (Einstellung CLASSIC)
3. Fader mit Mittelrastung: Mitte = flach, darüber Anhebung, darunter Absenkung. Heute liegt 0 dB bei 75 %.
4. Resonanz-Kennlinie und eventuell Resonance als Feedback-Regler (Punkt 3)
5. Negatives (invertiertes) Feedback
6. Funktionstasten im FB-Register: Halten lässt das Band mit 10 % im internen Takt wackeln, ein Würfel-Knopf setzt alle Bandpegel zufällig (S. 7).
7. Optional, nur für den Klang: breitere Bänder wie an der Hardware (17 dB/Dekade, Güte um 0,7). Gehört in die DSP-Runde.

**Modi**

8. FILTER aus den Bandpegeln gebildet, mit Cutoff, Slope, Width, Type, Gain, Offset und sperrbaren Bändern. Heute sind es zwei eigene Digitalfilter (S. 9).
9. CLK MOD als getaktetes Sample & Hold über die Bänder, mit Richtung, Mittelpegel und invertiertem R (S. 10)
10. Dyn EQ mit Quellenwahl (Eingang/Ausgang), Delay, Decay, Eingangsfilter und sperrbaren Bändern (S. 11)
11. Analyser mit L/R- und In/Out-Paaren, Lissajous-Figur und einstellbarem Abfall der Spitzenhaltung (S. 17)

**Modulation**

12. Modulation pro Ziel: ein LFO und ein Follower je Ziel, je Kanal ON, INV oder OFF (S. 13–14)
13. Envelope Follower mit Delay und den Quellen L IN, R IN, L OUT, R OUT; LFO-Phase in 15°-Schritten
14. MACRO-Seite: die Fader frei auf Parameter legen, auch Gruppen BAND LOW, MID, HIGH, ALL (S. 12)

**Snapshots, Steuerung, Eingang**

15. Pools mit Abspielfolge und Morph zwischen Snapshots (S. 16)
16. MIDI: CCs nach der Tabelle (S. 20), getrennte Kanäle für L und R, MIDI-Clock als Takt, Program Change. Im Browser geht das mit Web MIDI in Chrome und Edge.
17. Ersatz für den Fußschalter, zum Beispiel per Taste oder MIDI-Note (S. 19)
18. Eingangswahl mit Elektron-Automatik (Punkt 5)

## 5. Eigene Synthesizer als Eingang, Elektron automatisch

**Machbar.** Heute gibt es die Quelle „Mic / Line in“. Sie nimmt nur das Standard-Eingangsgerät des Systems, ohne Echo- und Rauschunterdrückung.

**Was dazukommt:**
- **Geräteliste:** Alle Audio-Eingänge (Audio-Interface, USB-Synth, Elektron) erscheinen in der Quellenwahl im Kopf und in CONFIG.
- **Kanalwahl:** Stereo, nur L oder nur R (für Mono-Synths am Interface)
- **Elektron-Automatik:** Taucht ein Eingang auf, dessen Name „Elektron“, „Digitakt“, „Digitone“, „Syntakt“, „Analog Rytm“, „Analog Four“ oder „Analog Heat“ enthält, wird er gewählt. Das gilt auch beim Einstecken im laufenden Betrieb. Die genauen Gerätenamen prüfe ich an deinem Gerät.
- **Erinnerung:** Die App merkt sich das zuletzt gewählte Gerät.

**Grenzen des Browsers:**
- Gerätenamen zeigt der Browser erst, nachdem du den Mikrofonzugriff einmal erlaubt hast. Ab dann funktioniert die Automatik ohne Nachfrage.
- Elektron-Geräte liefern Audio über USB, je nach Gerät und Firmware über Overbridge oder den USB-Audio-Modus. Der Browser nimmt in der Regel nur zwei Kanäle ab, also die Stereosumme. An die Einzelspuren von Overbridge kommt er nicht zuverlässig heran.
- Der Weg durch den Browser kostet etwas Latenz. Hör deshalb nur den Ausgang der App ab und nicht zusätzlich den Synth direkt, sonst entstehen Kammfilter. Für den trockenen Anteil gibt es Dry/Wet.
- Die veröffentlichte Seite auf claude.ai hat zurzeit keine Mikrofon-Freigabe. Diese wird beim Veröffentlichen gesetzt. Lokal (`npm run dev`) und als Einzeldatei funktioniert der Eingang direkt.

---

# Nachfragen vom 10.10.2026

## Fader mit Mitte = flach

**Hardware (S. 5):**
- Die Fader haben eine Mittelrastung. In der Mitte lässt ein Band das Signal unverändert durch.
- Nach oben wird das Band angehoben, nach unten abgesenkt.
- Wie viele dB oben und unten möglich sind, sagt das Handbuch nicht.

**App heute:**

| Faderweg | Pegel |
|---|---|
| obere 25 % | 0 bis +12 dB |
| mittlere 50 % | −24 bis 0 dB |
| untere 25 % | −60 dB bis stumm |

- 0 dB liegt bei 75 % des Weges, die Mitte entspricht −12 dB.

**„Flach“ hat an der Hardware noch eine zweite Seite:**
- Ihre Bänder sind breit (17 dB/Dekade, Güte um 0,7) und überlappen stark. Stehen alle Fader in der Mitte, ergibt die Summe annähernd einen glatten Frequenzgang.
- Unsere Bänder sind schmaler (Güte um 6,5 bei RES 0,45). Auch mit allen Fadern auf 0 dB bleibt eine Kammstruktur: Spitzen bei den Bandmitten, tiefe Senken dazwischen (im FB-Register gut zu sehen).
- Ob die Mittelstellung auch klanglich neutral sein soll, ist eine Frage der Bandgüte und gehört in die DSP-Runde.

**Dein Wunsch, als konkreter Vorschlag:**
- Die Mitte des Faders ist 0 dB, mit einer Rastung beim Ziehen. Doppelklick setzt wie bisher auf 0 dB.
- Die obere Hälfte geht gleichmäßig von 0 bis +12 dB, also 3 dB je Viertel der Hälfte.
- Die untere Hälfte bekommt denselben Weg, aber einen viel größeren Bereich:

| Faderweg | Pegel |
|---|---|
| 100 % | +12 dB |
| 75 % | +6 dB |
| 50 % | 0 dB |
| 40 % | −6 dB |
| 30 % | −12 dB |
| 20 % | −24 dB |
| 10 % | −40 dB |
| 0 % | stumm |

**Folgen:**
- Presets speichern die dB-Werte und klingen unverändert, nur die Fader stehen anders.
- Modulation auf Bandpegel rechnet im Faderweg. Eine Route mit gleicher Tiefe schwingt oberhalb von 0 dB künftig etwa halb so viele dB wie bisher. Presets mit Modulation auf Bandpegel klingen daher etwas anders.

## Resonanz-Kennlinie

**Hardware (S. 19):** Im Menü RESO CONFIG wählt man die „Kennlinie des Resonance-Potis“. Zur Auswahl stehen balanced, only highs, only lows, linear, logarithmic und exponential. Mehr erklärt das Handbuch nicht.

**Meine Lesart (abgeleitet, nicht belegt):** Es sind zwei Arten von Kurven in einer Liste.
- **balanced, only highs, only lows** sagen vermutlich, *welche Bänder* der Regler erfasst: alle gleich, nur die hohen oder nur die tiefen. Damit kann man zum Beispiel nur die Höhen klingeln lassen, ohne dass der Bass dröhnt.
- **linear, logarithmic, exponential** sagen, *wie schnell* die Wirkung über den Drehweg zunimmt.
  - logarithmisch: schnell am Anfang, dann fein
  - exponentiell: lange fein, dann schnell

**Übertragen auf die App:**
- Eine Einstellung in CONFIG für den globalen Resonance-Regler.
- Sie gewichtet seinen Versatz je Band: gleich, zu den Höhen ansteigend oder zu den Tiefen ansteigend.
- Sie formt den Drehweg: linear, log oder exp.
- RES und FB pro Band bleiben davon unberührt.

## FILTER, CLK MOD und Dyn EQ wie an der Hardware

**Gemeinsames Prinzip der Hardware:**
- Alle drei Modi stellen die **Pegel der 10 Bänder selbst** ein. Sie benutzen also dieselben Bandpässe, die sonst die Fader steuern.
- An der Hardware übernehmen die Fader dann die Parameter des Modus.
- Bei uns blieben die Fader Bandpegel. Der Modus würde als zusätzliche Ebene auf die Faderwerte gerechnet, mit seinen Reglern in der Reglerreihe.
- Bänder lassen sich per Taste **sperren**: Sie behalten dann ihren Wert und werden vom Modus nicht verändert.

**FILTER (S. 9)**
- **Hardware:** Aus den 10 Bandpegeln wird ein Multimode-Filter nachgebildet.
  - Parameter:
    - Typ: LP, HP, BP, Notch
    - Cutoff in Hz
    - Flanke in dB/Okt.
    - Breite in Hz (für BP und Notch)
    - Gain: wie stark die gesperrten Bereiche abgesenkt werden
    - Offset: Pegel im Durchlassbereich
  - Weil das Filter aus Bändern besteht, verläuft es stufig. Ein Cutoff-Sweep wandert hörbar von Band zu Band, und mit der Resonanz der Bänder klingt das sehr eigen.
  - Mit SPREAD bekommt R eine versetzte Cutoff-Frequenz (Stereo-Zwilling).
- **App heute:** zwei echte, stufenlose Digitalfilter vor und nach der Filterbank, unabhängig von den Bändern
- **Möglicher Weg:** Die Hardware-Variante kommt als „Band-Filter“ dazu. Die Pre- und Post-Filter könnten bleiben.

**CLK MOD (S. 10)**
- **Hardware:** ein getaktetes Sample & Hold über die Bänder.
  - Ein LFO läuft frei: Gain, Form (Sinus, Rechteck, Dreieck, Säge, Zufall) und Frequenz.
  - Bei jedem Takt wird sein aktueller Wert abgetastet und als Pegel in das **nächste Band** geschrieben.
  - Richtung: vorwärts, rückwärts, Ping-Pong oder zufällig.
  - So malt der LFO seine Form Schritt für Schritt über das Spektrum, wie ein Lauflicht oder ein Sequencer über die Bänder.
  - Weitere Parameter:
    - Mittelpegel der Bänder
    - R invertiert (ergibt spektrales Panning)
    - Takt bis 10 000 BPM (dann ändern sich praktisch alle Bänder gleichzeitig) oder MIDI-Clock
    - SPREAD verzögert den LFO auf L oder R
- **App heute:** zwei allgemeine Clock-Mod-Quellen (Divider, Steps, Euclid, Random), die man auf beliebige Ziele legt. Das Weiterreichen von Band zu Band gibt es nicht.
- **Möglicher Weg:** die Hardware-Funktion als eigener Band-Scanner. Die Clock-Mods als Quellen könnten bleiben.

**Dyn EQ (S. 11)**
- **Hardware:** Eine Spektralanalyse der **Quelle** (Eingang oder Ausgang) bestimmt, welche Bänder abgesenkt werden. Je lauter ein Bereich über dem Threshold liegt, desto stärker wird das Band zurückgenommen.
  - Parameter:
    - Threshold
    - Attack
    - Decay
    - Delay: das berechnete Absenk-Profil kommt verzögert
    - Eingangsfilter: ein Bandpass vor der Analyse, oder OFF
    - Quelle: Eingang oder Ausgang
    - Grundpegel der Bänder ohne Absenkung
  - Mit dem Ausgang als Quelle entsteht eine Regelschleife, in der Resonanz und Feedback mitspielen.
  - SPREAD verzögert die Regelung auf L oder R.
- **App heute:** ein Kompressor bzw. Expander in jedem Band, nach dessen eigener Feedback-Schleife.
  - Er misst das **eigene Bandsignal**.
  - Er hat Ratio, Range und einen Anteil pro Band.
  - Es gibt keine Quellenwahl, kein Delay und kein Eingangsfilter.
  - Er zähmt klingelnde Bänder gut. Er kann aber nicht, wie die Hardware, Bänder dort absenken, wo der **Eingang** laut ist.
- **Möglicher Weg:** eine Quellenwahl (Band selbst, Eingang, Ausgang), dazu Delay und Eingangsfilter. Der bestehende Kompressor bleibt der Fall „Band selbst“.
