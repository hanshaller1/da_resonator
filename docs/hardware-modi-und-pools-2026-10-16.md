# Hardware-Modi und Pools: Entscheidungspunkte

Stand: 16.10.2026. Das ist Punkt 3 der offenen Liste. Er umfasst die Punkte 8, 9, 10, 15 und 17 aus
[antworten-2026-10-10.md](antworten-2026-10-10.md) (Abschnitt 4). Grundlage sind der Abgleich mit dem Handbuch
in [abgleich-original.md](abgleich-original.md) (M2–M4, P3, S2) und der heutige Stand der App mit L/R pro Band,
MIDI, den beiden Takten, dem bipolaren SPREAD und dem neuen ANALOG.

**Entschieden:** `1A 2A 3A 4A 5A 6C 7A 8A 9A 10A 11A 12A` (alle Empfehlungen). Teil 1, die Modi, ist gebaut,
siehe README, Abschnitt „Hardware-Modi“.

## Vorweg

**Hardware:**
- Genau ein Modus ist aktiv: FB, FILTER, CLK MOD oder DYNAMIC EQ. Jeder Modus stellt die Pegel der 10 Bänder
  selbst ein, und die Fader übernehmen seine Parameter.
- Snapshots lassen sich in Pools ordnen und nacheinander abspielen, mit Morph zwischen ihnen. Weitergeschaltet
  wird per Fußschalter, Takt oder MIDI.

**App heute:**
- Die Fader sind immer Bandpegel. Das bleibt so („die Fader bleiben immer per band fader“).
- FILTER sind zwei eigene Digitalfilter vor und nach der Filterbank (PRE, POST).
- CLK MOD sind zwei Clock-Mods als Modulationsquellen (Divider, Steps, Euclid, Random).
- DYN EQ ist ein Kompressor in jedem Band, der das eigene Bandsignal misst.
- PLAY/LOAD ist ein Preset-Browser mit A/B-Vergleich. Program Change lädt Preset n. Pools, Morph und einen
  Fußschalter gibt es nicht.

**Was du entscheidest:**
- Die Punkte 1 bis 12 haben je Optionen A, B (manchmal C).
- Antworte mit einer Zeile wie `1A 2A 3A 4A 5A 6C 7A 8A 9A 10A 11A 12A`.
- Was unter „So baue ich es“ und „Bleibt so“ steht, gilt, wenn du nichts anderes sagst.

## Kurzübersicht

| # | Punkt | Optionen | Empfehlung |
|---|---|---|---|
| 1 | Modi neben den Fadern | A als Ebenen, mehrere gleichzeitig · B immer nur einer aktiv | **A** |
| 2 | Bestehende Module | A bleiben, die Hardware-Variante kommt dazu · B werden ersetzt | **A** |
| 3 | Stereo in den Modi | A eigener Knopf je Modus · B SPREAD bekommt die Funktion MODE · C beides | **A** |
| 4 | Bänder sperren | A Klick aufs Band im Bild · B Anteil je Band 0–100 % | **A** |
| 5 | Takt des Band-Scanners | A RATE · INT · MIDI wie beim LFO · B nur Takt mit DIV | **A** |
| 6 | Was der Scanner abtastet | A eigener LFO · B eine Modulationsquelle · C eigener LFO, wahlweise eine Quelle | **C** |
| 7 | DYN EQ wie die Hardware | A Quellenwahl im bestehenden DYN EQ · B eigenes Modul | **A** |
| 8 | Pools | A mehrere benannte Pools · B eine Abspielliste | **A** |
| 9 | Weiterschalten | A von Hand, Takt und MIDI · B von Hand und Takt | **A** |
| 10 | Was beim Morph überblendet | A alle stetigen Werte, auch Routen · B nur Bandpegel, RES, FB, MIX, SPREAD · C kein Morph | **A** |
| 11 | Fußschalter-Ersatz | A Knopf, Taste und MIDI, Aktionen wählbar · B feste Belegung | **A** |
| 12 | Program Change im Pool | A springt im laufenden Pool · B lädt immer Preset n | **A** |

**Aufwand:** Ich baue in zwei Teilen und frage nach jedem, ob gepusht wird.
- **Teil 1, die Modi:** Band-Filter, Band-Scanner, DYN EQ mit Quellenwahl. Band-Filter klein, Scanner und
  DYN-Quelle mittel.
- **Teil 2, PLAY:** Pools, Morph, Fußschalter. Pools und Morph mittel, Fußschalter klein.

---

## 1. Modi neben den Fadern

**Optionen:**
- **A:** Jeder Modus ist eine Ebene, die einen Pegel in dB auf den Fader rechnet. Band-Filter, Band-Scanner und
  DYN EQ haben je ein ON und können gleichzeitig laufen. Ein Band bekommt dann Fader + Filter + Scanner + DYN.
- **B:** wie die Hardware. Ein Schalter MODE wählt FILTER, SCAN oder DYN, nur dieser Modus wirkt. Die Fader
  bleiben trotzdem Bandpegel.

**Empfehlung: A.**
- So arbeitet die App schon heute: Jedes Register hat sein ON, alles läuft nebeneinander.
- Ein Filter-Sweep über einem laufenden Scanner geht nur mit A.
- Mit A kannst du B nachstellen, indem nur ein Modus an ist.

## 2. Bestehende Module

**Optionen:**
- **A:** Die bestehenden Module bleiben, die Hardware-Variante kommt als weitere Instanz dazu:
  - FILTER: PRE · POST · **BAND**
  - CLK MOD: CM1 · CM2 · **SCAN**
  - DYN EQ: derselbe Kompressor, dazu die Quellenwahl (Punkt 7)
- **B:** Die Hardware-Varianten ersetzen PRE/POST und die Clock-Mods.

**Empfehlung: A.**
- Presets mit PRE/POST oder Clock-Mods klingen weiter gleich.
- Die Clock-Mods treiben heute auch andere Ziele, zum Beispiel Filter-Cutoff. Das ginge mit B verloren.

## 3. Stereo in den Modi

An der Hardware wirkt SPREAD je Modus anders: Im FILTER bekommt R eine versetzte Frequenz, in CLK MOD und DYN
kommt die Bewegung auf R verzögert.

**Optionen:**
- **A:** Jeder Modus bekommt einen eigenen Knopf dafür:
  - BAND-Filter: **R OFS**, die Cutoff-Frequenz von R versetzt (± 2 Oktaven)
  - SCAN: **R DLY**, R folgt L um einige Schritte versetzt
  - DYN EQ: **R DLY**, die Absenkung kommt auf R verzögert (bis 1 s)
  - SPREAD bleibt, wie er seit heute ist (ODD/EVEN oder CLASSIC).
- **B:** SPREAD bekommt neben ODD/EVEN und CLASSIC eine dritte Funktion **MODE**, die je Modus wie an der
  Hardware wirkt. Dann gibt es dort kein Panning.
- **C:** beides.

**Empfehlung: A.**
- Laufen mehrere Modi gleichzeitig (1A), braucht jeder seinen eigenen Wert. Ein SPREAD-Knopf für alle drei
  passt dann nicht.
- Du verlierst das Panning nicht.

## 4. Bänder sperren

An der Hardware lässt sich in jedem Modus jedes Band sperren. Es behält dann seinen Pegel, der Modus verändert
es nicht.

**Optionen:**
- **A:** Ein Klick auf das Band im Bild des Modus sperrt es oder gibt es frei. Ein Schloss markiert gesperrte
  Bänder. Gesperrt ist je Modus und Band, im Preset gespeichert.
- **B:** statt an/aus ein Anteil je Band von 0 bis 100 %, wie heute schon im DYN EQ. 0 % ist gesperrt.

**Empfehlung: A.**
- Ein Klick ist schneller als ein Wert, und das Schloss ist auf einen Blick lesbar.
- Im DYN EQ bleibt der Anteil je Band wie heute, dort ist 0 % gesperrt.

## 5. Takt des Band-Scanners

Der Scanner tastet bei jedem Takt einen Wert ab und schreibt ihn ins nächste Band. An der Hardware geht der
Takt bis 10 000 BPM, dann bewegen sich praktisch alle Bänder gleichzeitig.

**Optionen:**
- **A:** derselbe Schalter wie beim LFO: **RATE · INT · MIDI**. RATE läuft frei bis 160 Schritte pro Sekunde
  (≈ 10 000 BPM), INT und MIDI laufen mit DIV im gewählten Takt.
- **B:** nur im Takt mit DIV (INT oder MIDI), wie die Clock-Mods.

**Empfehlung: A.**
- Nur mit RATE erreichst du die sehr schnellen Bereiche der Hardware.
- Die Bedienung ist dieselbe wie beim LFO.

## 6. Was der Scanner abtastet

**Optionen:**
- **A:** einen eigenen LFO wie an der Hardware: Form (Sinus, Rechteck, Dreieck, Säge, Zufall), Frequenz, Tiefe.
- **B:** eine bestehende Modulationsquelle (LFO 1–4, Env Follower 1–4, Clock-Mod 1–2, Makro).
- **C:** den eigenen LFO als Standard, wahlweise eine Quelle aus B.

**Empfehlung: C.**
- Der eigene LFO klingt wie die Hardware.
- Mit einem Env Follower als Quelle malt der Pegel deines Eingangs Schritt für Schritt über die Bänder. Das
  gibt es an der Hardware nicht, kostet aber wenig.

## 7. DYN EQ wie die Hardware

An der Hardware misst DYN EQ die Quelle (Eingang oder Ausgang) je Band und senkt die Bänder ab, die dort laut
sind. Unser DYN EQ misst das eigene Bandsignal.

**Optionen:**
- **A:** Der bestehende DYN EQ bekommt eine Quellenwahl **BAND · IN · OUT**:
  - BAND wie heute, IN misst den Eingang, OUT den Ausgang, jeweils durch eigene Analysefilter je Band.
  - Dazu kommen **DELAY** (die Absenkung kommt verzögert, bis 2 s) und ein Eingangsfilter (OFF oder
    Bandpass mit Frequenz) vor der Analyse.
  - Threshold, Ratio, Attack, Release und Range bleiben.
- **B:** ein eigenes Modul neben dem Kompressor, mit den Parametern der Hardware.

**Empfehlung: A.**
- Es ist dieselbe Idee mit einer anderen Messung, zwei Module wären verwirrend.
- Presets mit DYN EQ klingen gleich, weil BAND der Standard ist.

**Folge:** Mit IN oder OUT rechnet die DSP 20 Analysefilter mehr (10 Bänder × 2 Kanäle), aber nur, solange
diese Quelle gewählt ist.

## 8. Pools

**Optionen:**
- **A:** mehrere benannte Pools. Ein Pool ist eine geordnete Liste von Presets, ein Preset darf in mehreren
  Pools stehen. Pools werden im Browser gespeichert und lassen sich als Datei sichern.
- **B:** eine einzige Abspielliste.

**Empfehlung: A.**
- So ist es an der Hardware, und du kannst zum Beispiel einen Pool je Stück anlegen.

## 9. Weiterschalten

**Optionen:**
- **A:** alle drei Wege:
  - von Hand: STEP und STEP+MORPH im PLAY-Register, Fußschalter (Punkt 11)
  - Takt: INT oder MIDI, alle N Takte (1, 2, 4, 8, 16)
  - MIDI: eine gelernte Note oder ein CC
- **B:** nur von Hand und im Takt.

**Empfehlung: A.**
- Mit MIDI kann eine Elektron-Spur die Presets weiterschalten, ohne dass die App den Takt kennen muss.

**In beiden Fällen gilt:** Richtung vorwärts, rückwärts, Ping-Pong oder zufällig; START/STOP und RESET wie an
der Hardware.

## 10. Was beim Morph überblendet

**Optionen:**
- **A:** alle stetigen Werte: Fader, RES, FB, alle Knöpfe, Modulationstiefen.
  - Eine Route, die nur im alten Preset steht, blendet auf 0 aus, eine neue blendet von 0 ein.
  - Schalter (ON, Typ, Modus) springen zu Beginn des Morphs.
  - Die Morph-Zeit ist in ms oder in Schlägen einstellbar.
- **B:** wie an der Hardware nur Bandpegel, RES, FB, MIX und SPREAD. Alles andere springt.
- **C:** kein Morph, nur Sprung.

**Empfehlung: A.**
- Mit B springen Filter-Cutoff oder LFO-Tempo hörbar, während die Bänder noch gleiten.

## 11. Fußschalter-Ersatz

**Optionen:**
- **A:** ein Knopf **FOOT** am Bildschirm, eine Taste (Standard: Leertaste) und eine gelernte MIDI-Note oder ein
  CC. In CONFIG wählst du je eine Aktion für kurz drücken und für halten:
  - nichts, Bypass, Panic, nächstes oder voriges Preset, Pool START/STOP, STEP, STEP+MORPH, TAP TEMPO
- **B:** feste Belegung: kurz = nächstes Preset im Pool, halten = Bypass.

**Empfehlung: A.**
- So ist es an der Hardware: kurz und halten mit je einer wählbaren Aktion.

## 12. Program Change im Pool

**Optionen:**
- **A:** Läuft ein Pool, springt Program Change n auf den Eintrag n des Pools, wie an der Hardware. Läuft keiner,
  lädt er wie heute Preset n.
- **B:** Program Change lädt immer Preset n.

**Empfehlung: A.**

---

## So baue ich es

**Band-Filter (FILTER → BAND):**
- TYPE (LP, HP, BP, Notch), CUTOFF, SLOPE (6 bis 48 dB/Oktave), WIDTH (für BP und Notch, in Oktaven),
  DEPTH (wie weit gesperrte Bereiche abgesenkt werden, bis stumm) und OFFSET (Pegel im Durchlassbereich).
- Jedes Band bekommt den Wert der Filterkurve an seiner Mittenfrequenz. Ein Cutoff-Sweep wandert dadurch hörbar
  von Band zu Band, wie an der Hardware.
- Alle Werte lassen sich modulieren. Das Bild zeigt die Kurve, die 10 Bandwerte und die Schlösser.

**Band-Scanner (CLK MOD → SCAN):**
- Bei jedem Schritt wird der Wert abgetastet und ins nächste Band geschrieben. DIR (vorwärts, rückwärts,
  Ping-Pong, zufällig), DEPTH und OFFSET in dB, R INV (R gegenläufig, ergibt spektrales Panning).
- Ein kurzes Gleiten je Band verhindert Klicks. Das Bild zeigt 10 Balken und den laufenden Schritt.

**DYN EQ:** Quelle, Delay und Eingangsfilter in der Statuszeile. Das Bild zeigt die Absenkung je Band wie heute.

**PLAY/LOAD:** rechts ein Pool-Bereich mit Poolwahl, Liste (ziehen zum Ordnen), START/STOP, STEP, STEP+MORPH,
RESET, Richtung, Weiterschalten und Morph-Zeit.

**Presets:** Format 6. Alle neuen Werte stehen im Standard auf aus bzw. neutral, alte Presets klingen gleich.

**Tests:** Kurve des Band-Filters an den Bandmitten, Scanner-Reihenfolge und Takt, DYN mit Quelle IN auf einen
lauten Bereich des Eingangs, Morph ohne Klicks, Pool-Reihenfolge und Program Change.

## Bleibt so

- Die Fader sind immer Bandpegel. Die Modi rechnen ihre dB auf den Fader, sie verschieben ihn nicht.
- PRE, POST, die Clock-Mods und der DYN-Kompressor bleiben, wie sie sind (bei 2A).
- SPREAD bleibt global mit ODD/EVEN und CLASSIC (bei 3A).
- INPUT und OUTPUT bleiben im Preset gespeichert. An der Hardware sind sie das nicht, bei uns waren sie es
  schon immer.
- A/B-Vergleich, Suche und Kategorien im Browser bleiben.
