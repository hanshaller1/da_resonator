# Abgleich mit dem Original nach Handbuch

Stand: 10.10.2026. Grundlage ist das Handbuch der Erica Synths Resonant Filterbank (User Manual V1, Mai 2026, Firmware-Screens 0.15). Seitenangaben beziehen sich darauf. Die Datei liegt unter `/mnt/project-files/reference/`.
Diese Fassung ersetzt den ersten Abgleich, der nur auf Testberichten beruhte. Die Webrecherche steht weiter in [original-recherche.md](original-recherche.md).

Bewertung:

| Stufe | Bedeutung |
|---|---|
| **A** | Bedienkonzept oder Klang weichen grundlegend ab. |
| **B** | Eine Funktion fehlt oder arbeitet anders. |
| **C** | Ein Detail weicht ab. |

---

## 1. Wie das Original aufgebaut ist

- **Analog, Stereo:** zwei Sätze mit je 10 Bandpässen, einer für L und einer für R (S. 8).
  - Mittenfrequenzen 29 Hz bis 11 kHz, Flanke 17 dB/Dekade (S. 2).
  - Die Filter selbst haben keinen Resonanzregler. Resonanz entsteht nur über Feedback-Schleifen.
- **Fünf feste Regler:**
  - INPUT GAIN: 0 bis +24 dB, kann sanft übersteuern.
  - RESONANCE: ein Attenuverter. 12 Uhr = kein Feedback, rechts = Feedback, links = invertiertes Feedback. Ab etwa 15 Uhr schwingen die Filter selbst.
  - DRY/WET, SPREAD, VOLUME (S. 5).
- **Feedback-Konfiguration (S. 8, Blockschaltbild):**
  - Jedes Band hat einen Schalter, der seinen Ausgang (nach dem Fader) **in den gemeinsamen Eingang** aller Bänder zurückführt.
  - Ein Schalter ALL führt die Summe aller Bänder zurück.
  - Beides kann gleichzeitig laufen („dual resonance“). Bei hoher Resonanz schwingt ein Band, sobald man seinen Fader hochzieht.
  - Die Schalter lassen sich pro Stereokanal getrennt setzen.
- **Genau ein aktiver Modus bestimmt die Funktion (S. 6):**
  - FB: Bandpegel.
  - FILTER: emuliertes Multimode-Filter aus den Bändern.
  - CLK MOD: getakteter Sample & Hold über die Bänder.
  - DYNAMIC EQ: spektraler Kompressor.
  - Die zehn Fader (Mittelrastung, Mitte = flacher Frequenzgang, S. 5) und die zehn Funktionstasten wechseln je Modus ihre Rolle.
- **Modulation (S. 6, 13, 14):**
  - Pro Ziel *ein* LFO und *ein* Envelope Follower; beide werden addiert. Insgesamt gibt es bis zu 20 von jeder Art.
  - Ziele sind die Parameter des aktiven Modus sowie Resonance, Mix und Spread.
  - Jede Modulation wirkt auf L und R getrennt wählbar: ON, INV oder OFF.
- **Weitere Seiten:**
  - MACRO-Seite: die Fader frei auf Parameter legen (S. 12).
  - 128 Snapshots, Pools mit Abspielfolge und Morphing (S. 15–16).
  - Spektrum-Analyser mit Lissajous-Figur (S. 17).
  - CONFIG mit Spread-Funktion, Resonanz-Kennlinie, MIDI und Fußschalter (S. 18–19).
  - MIDI-CC-Tabelle (S. 20).

---

## 2. Unterschiede im Kern

| # | Bereich | Original (Handbuch) | Unsere Umsetzung | Stufe |
|---|---|---|---|---|
| K1 | Resonanz pro Band | Gibt es nicht. Die Bänder haben feste Güte, und Resonanz entsteht nur durch Feedback (S. 5, 8). | Stufenloses RES pro Band (Güte Q 0,6 … 120) | **A** |
| K2 | Feedback pro Band | Nur ein/aus (Schalter 1–10, CC 85–94). Das Signal läuft vom Bandausgang nach dem Fader in den **gemeinsamen Eingang** aller Bänder (S. 8). | Stufenloses FB pro Band, das nur in den **eigenen** Bandeingang zurückläuft | **A** |
| K3 | Resonanz-Regler | Attenuverter: bestimmt die Stärke des Feedbacks und invertiert es links von 12 Uhr. Ab 15 Uhr Eigenschwingung (S. 5). | „Resonance“ verschiebt nur das RES aller Bänder und berührt kein Feedback | **A** |
| K4 | Haupt-Loop (ALL) | Schalter ALL, CC 95. Summe aller Bänder in den Eingang. Wird von RESONANCE mitgeregelt; kein eigener Mengenregler, kein Filter im Loop (S. 8). | „Feedback All“ mit eigenem Mengenregler und Tone-Tiefpass | B |
| K5 | Feedback pro Kanal | Schalter für L und R getrennt setzbar (S. 8) | Nicht möglich | B |
| K6 | Resonanz-Kennlinie | Im Menü wählbar: balanced (S-Kurve), only highs, only lows, linear, logarithmisch, exponentiell (S. 19) | Fehlt | B |
| K7 | Fader | Mittelrastung, Mitte = flacher Frequenzgang, darüber Anhebung, darunter Absenkung (S. 5) | Seit 10.10.2026: 0 dB in der Mitte mit Rastung, oben bis +12 dB, unten über denselben Weg bis stumm (−6/−12/−24/−40 dB bei 40/30/20/10 %). Offen bleibt, ob die Mittelstellung auch klanglich neutral ist (Bandgüte). | C |
| K8 | Stereo | Jeder Parameter existiert pro Kanal. Die Fader steuern L und R gemeinsam; einzeln geht es über FB CH-SELECT oder getrennte MIDI-Kanäle (S. 7, 18–19). | L und R sind immer identisch eingestellt | B |
| K9 | Spread | Hängt vom Modus ab. FB: Versatz eines Kanals. FILTER: R bekommt eine versetzte Frequenz. CLK und DYN: Modulation auf L oder R verzögert. Mit FB CH-SELECT wählt Spread im FB-Modus den Kanal L, beide oder R (S. 5, 7, 9–11, 18). | Odd/Even-Panning (ungerade Bänder links, gerade rechts) | **A** |
| K10 | Bandgüte | 17 dB/Dekade, also breite Bänder mit Q von etwa 0,7 | Standardgüte Q ≈ 6,5, schmale Bänder | **A**: klingt deutlich anders |
| K11 | Funktionstasten im FB-Modus | Gedrückt halten wackelt das Band mit einem Sinus im internen Takt, 10 % Tiefe. SHIFT + Encoder würfelt alle Bandpegel (S. 7). | Seit 17.10.2026: WOB je Band im FB-Register (±10 % Faderweg, Sinus pro Schlag des Master-Takts), DICE würfelt alle Bandpegel. | – |
| K12 | Input, Volume, Dry/Wet | Input und Volume sind analog: nicht per MIDI und nicht im Snapshot (S. 5, 15) | Alles normale, speicherbare Parameter | C |
| K13 | Regler „Analog“ | Gibt es nicht | Zusatz der Emulation (Toleranzen, Drift) | C |
| K14 | Bypass | Über den Fußschalter (S. 5, 19) | Bypass-Schalter | gleich im Prinzip |

## 3. Unterschiede bei den Modi

| # | Bereich | Original (Handbuch) | Unsere Umsetzung | Stufe |
|---|---|---|---|---|
| M1 | Modus-Konzept | Ein aktiver Modus. Fader und Tasten wechseln ihre Rolle, Snapshots merken sich den Modus (S. 6, 15). | Keine Modi, alles läuft gleichzeitig | **A** |
| M2 | FILTER | LP, HP, BP oder Notch werden **aus den Bandpegeln** gebildet. Parameter: Cutoff (Hz), Slope (dB/Okt.), Width (Hz), Type, Gain (wie stark gesperrte Bänder abgesenkt werden), Offset (Pegel im Durchlassbereich). Bänder lassen sich sperren; Spread versetzt die Frequenz für R (S. 9). | Zwei eigenständige Digitalfilter vor und nach dem Resonator | **A** |
| M3 | CLK MOD | Ein LFO (Gain, Waveshape sine/square/triangle/saw/random, Frequenz) wird im Takt abgetastet und Band für Band weitergereicht. Richtung vorwärts/rückwärts/Ping-Pong/Zufall. Interner Takt bis 10 000 BPM oder MIDI-Clock mit Faktor. Weitere Parameter: Mittelpegel, R invertiert, Bänder sperrbar, Spread verzögert den LFO auf L oder R (S. 10). | Zwei allgemeine Clock-Mod-Quellen (Divider, Steps, Euclid, Random) | **A** |
| M4 | DYNAMIC EQ | Spektralanalyse der Quelle (Eingang oder Ausgang). Bänder über dem Threshold werden abgesenkt, je lauter, desto stärker. Parameter: Threshold, Decay, Attack, Delay, Eingangsfilter (Bandpass oder OFF), Quelle, Offset; Bänder sperrbar; Spread verzögert auf L oder R (S. 11). | Kompressor pro Band mit Ratio, Range und Anteil pro Band. Detektor ist der Bandausgang selbst; kein Delay, kein Eingangsfilter, keine Quellenwahl. | B |
| M5 | Analyser | Zwei Kanäle plus Lissajous. Paare: L/R Out, L/R In, L In/Out, R In/Out. Spitzenhaltung mit einstellbarem Abfall (S. 17). | Ein Spektrum mit Frequenzgangkurve | C |

## 4. Unterschiede bei Modulation und Makros

| # | Bereich | Original (Handbuch) | Unsere Umsetzung | Stufe |
|---|---|---|---|---|
| X1 | Modulationsmodell | Pro Ziel ein LFO und ein Follower, beide addiert. Ziele sind die Parameter des aktiven Modus sowie Resonance, Mix und Spread. Bis zu 20 LFOs und 20 Follower (S. 6, 13–14). | 4 LFOs und 4 Follower als Quellen-Pool, Matrix mit 64 Routen | **A** |
| X2 | LFO | Parameter: Wave, Gain, Source (FREE, interner Master-Takt, MIDI-Clock), Freq bzw. Teilerfaktor, Phase in 15°-Schritten, an/aus. Wirkung auf L und R je ON/INV/OFF (S. 14). | 6 Formen, Morph, Smooth, Unipolar. Kein L/R-Verhalten, kein MIDI-Sync. | B |
| X3 | Envelope Follower | Parameter: Attack, Decay, Delay vor dem Attack, Source (eine von vier: L IN, R IN, L OUT, R OUT), Gain, an/aus. L/R je ON/INV/OFF (S. 13). | Abgriff wählbar (Eingang, jedes Band, Resonator-Ausgang, Ausgang), Threshold, Kurve. Seit 17.10.2026 mit DLY (bis 2 s) und CH (L+R, L, R); L/R je Ziel über die Kanalwahl der Routen. | – |
| X4 | Makros | Die 10 **Fader** werden auf Parameter gelegt: UNLINK, Parameter des aktiven Modus (auch Gruppen BAND LOW/MID/HIGH/ALL), LFO- oder ENV-Parameter eines Ziels. Die Seite wird im Snapshot gespeichert (S. 12). | 8 Makro-Drehregler als Modulationsquellen | **A** |
| X5 | Clock-Modulator als Quelle | Gibt es nicht. Getaktete Modulation ist ein eigener Modus (M3). | Zwei Clock-Mods mit Euklid, Swing, Wahrscheinlichkeit | Zusatz |
| X6 | Trigger-Routen, Modulation von Routen | Gibt es nicht | vorhanden | Zusatz |

## 5. Unterschiede bei Snapshots

| # | Bereich | Original (Handbuch) | Unsere Umsetzung | Stufe |
|---|---|---|---|---|
| P1 | Speicher | 128 Snapshots. Gespeichert werden Modus, Fader, Dry/Wet, Resonance, Spread, Feedback und Modulation, aber nicht Input und Volume (S. 15). Namen per Encoder oder Zufallsnamen. Laden, Laden mit Sprung in den Modus, Löschen, Umbenennen. | Unbegrenzt, mit Kategorien, Suche, Import und Export | C |
| P2 | INIT | Setzt Modulation und Feedback zurück wie beim Einschalten (S. 15) | „Init“-Preset | gleich im Prinzip |
| P3 | Pools und PLAY | Pools mit Abspielfolge; weiterschalten per Fußschalter, internem Takt, MIDI-Clock oder MIDI-CC. Richtung, BPM bzw. Faktor, Morph-Zeit (z. B. 2444 ms). Start/Stop, Reset, Schritt, Schritt mit Morph. Program Change springt in der Folge (S. 16). | Fehlt | **B** |
| P4 | Werks-Snapshots | 32 Stück von Eraldo Bernocchi, nur mit Beschreibung (S. 21–22) | 12 eigene Presets | C: Die Einstellungen der Originale sind unbekannt. |

## 6. Unterschiede bei Steuerung und Einstellungen

| # | Bereich | Original (Handbuch) | Unsere Umsetzung | Stufe |
|---|---|---|---|---|
| S1 | MIDI | CC 70–83 hängen vom Modus ab, 84–95 sind Resonance und Feedback, 96–97 Mix und Spread. Getrennte Kanäle für beide, L und R. MIDI-Out sendet CCs (oder arbeitet als Thru). MIDI-Clock, Program Change. Input und Volume sind nicht per MIDI steuerbar (S. 19–20). | Kein MIDI | **B** |
| S2 | Fußschalter | Kurz drücken und Halten, je mit einer Aktion, z. B. Bypass oder durch Patches schalten (S. 5, 19) | Fehlt | C |
| S3 | CONFIG | Spread-Funktion (CLASSIC, FB CH-SELECT), Resonanz-Kennlinie, MIDI, Fußschalter, Display, Firmware, Backup, Werksreset (S. 18–19) | Kein Einstellungsmenü | B |
| S4 | Master-Takt | Interner Master-Takt (LFO-Sync, CLK MOD, PLAY) oder MIDI-Clock (S. 10, 14, 16) | Interner Takt 20–300 BPM | C |

## 7. Was bei uns zusätzlich ist und beim Angleichen entfällt

- RES pro Band und FB als stufenloser Regler
- Tone und eigener Mengenregler im Summen-Loop
- Pre- und Post-Filter
- Odd/Even-Spread
- Clock-Mods als Quellen
- Modulationsmatrix mit Trigger-Routen
- 8 Makro-Drehregler
- Ratio, Range und Anteil pro Band in der Dynamik

Der Regler „Analog“ (Toleranzen, Drift) bildet nur die analoge Natur nach. Er wandert ins Einstellungsmenü.

## 8. Was auch das Handbuch offen lässt

Diese Punkte setze ich mit einer begründeten Annahme. Sie sind im Bauplan markiert:

1. **Fader:** wie viel dB oben und unten. Annahme: Mitte 0 dB, oben +12 dB, unten stumm.
2. **Gruppen BAND LOW, MID, HIGH:** welche Bänder dazugehören. Annahme: 1–3, 4–7, 8–10.
3. **Spread im FB-Modus:** was „Versatz eines Kanals“ genau verschiebt. Annahme: Pegelversatz aller Bänder eines Kanals.
4. **Resonanz-Kennlinie:** was „only highs“ und „only lows“ bedeuten. Annahme: nur die rechte bzw. linke Reglerhälfte wirkt.
5. **Wertebereiche:** Slope, Width, Delay, Attack und Decay sind nur als Beispielwerte auf den Screens zu sehen.
6. **Wellenformen der LFOs:** Annahme wie im CLK-Modus: sine, square, triangle, saw, random.
7. **Morph zwischen Snapshots verschiedener Modi:** Annahme: Die resultierenden Bandpegel werden überblendet.
8. **Aktionsliste des Fußschalters:** Annahme: Bypass, Feedback aus, nächster und vorheriger Snapshot, PLAY Start/Stop, Schritt, Schritt mit Morph.
