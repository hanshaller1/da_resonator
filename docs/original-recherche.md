# Erica Synths Resonant Filterbank (desktop, 2026): functional reference spec

Research date: 2026-10-10. Web-only. Built to check a software emulation against the hardware.

## Read this first: source quality and the main gap

**I could not read the official manual.** The English desktop manual is at
`https://www.ericasynths.lv/service/file/download/product_id/1603/file_id/650/`, but WebFetch only gets "[binary data]" from it.
A Japanese translation, which its publisher says is "compliant with firmware 1.0", is at
`https://img.elektrondistributiongroup.com/manuals/EricaSynths/ResonantFilterbank_manual_JP.pdf`
(announced 2026-06-24 at https://www.elektrondistributiongroup.com/blogs/support/erica-synths-resonant-filterbank-%E6%97%A5%E6%9C%AC%E8%AA%9E%E3%83%9E%E3%83%8B%E3%83%A5%E3%82%A2%E3%83%AB%E3%82%92%E5%85%AC%E9%96%8B%E3%81%97%E3%81%BE%E3%81%97%E3%81%9F).
WebFetch is blocked from that file by robots.txt, and Bash curl is blocked by the egress proxy.

Anyone with a browser can download either PDF and settle most of the unknowns below. The remaining ones need a MIDI CC chart.

Other sources that failed:
- The Sound On Sound review is paywalled after the Filter-mode section.
- YouTube, modwiggler, gearspace and manuals.plus all returned errors or are disallowed by robots.txt.

### Confidence tags used on every fact

| Tag | Meaning |
|---|---|
| **[MFR]** | Erica Synths' own text: the product page, a news-post meta description, a YouTube description written by Erica, or the press-release feature list. Retailers copy that list word for word ("Configurable resonance feedback loops", "20 independent LFOs", …). |
| **[MFR-retail]** | A spec or feature line that appears only on retailer pages (Thomann, Music Store, Perfect Circuit and others). It probably comes from the distributor's data sheet, but Erica's own text does not confirm it. |
| **[REVIEW]** | Hands-on review: Sound On Sound (Rory Dow, Oct 2026), Starsky Carr's video description, GearNews, MusicRadar and others. |
| **[USER]** | Forum posts from owners (Elektronauts). |
| **[EURO]** | The predecessor Eurorack *Graphic Resonant FB*, from its manual paraphrase or reviews. It is mono and 20HP, with CV inputs and no LFOs. The desktop unit may differ. |
| **[INFERRED]** | My own interpretation. It is not stated in any source. |

---

## 0. Core hardware (for context)

**Filters**
- **Signal path:** analog stereo, with 10 fixed band-pass filters under digital control. [MFR] https://www.ericasynths.lv/resonant-filterbank-3733/
- **Centre frequencies:** 29 Hz, 61 Hz, 115 Hz, 218 Hz, 411 Hz, 777 Hz, 1.5 kHz, 2.8 kHz, 5.2 kHz and 11 kHz. [MFR] (Erica press list, as copied at https://www.turramusic.com.au/products/erica-synths-resonant-filterbank and https://synthanatomy.com/2026/05/erica-synths-resonant-filterbank-desktop-unit.html)
  - Eurorack tolerance is "±10%". [EURO] https://www.ericasynths.lv/graphic-resonant-fb-3158/
- **Slope:** "17 dB/decade". [MFR]
  - [INFERRED] That is about 5.1 dB/octave, shallower than a 2nd-order band-pass skirt (6 dB/oct, or 20 dB/dec).
  - Audiofanzine's "17 dB/octave" is a typo. https://fr.audiofanzine.com/multieffet/erica-synths/resonant-filterbank/news/a.play,n.81395.html
- **Capacitors:** "High quality film capacitors in the bandpass filters". [MFR]
- **Band spacing:** about a major seventh (ratio ≈1.89), on the Serge Resonant Equalizer lineage.
  - "bands are spaced primarily in major seventh intervals rather than octaves" (retail copy). https://wrdtunes.com/products/erica-synths-resonant
  - "All bands except top and bottom tuned to major 7ths" [EURO]. https://reverb.com/item/99410396-erica-synths-filterbank-eq-expander-2025-black
  - Starsky Carr: "tuned in major sevenths—not octaves" [REVIEW]. https://synthmagazine.com/starsky-carrs-erica-synths-resonant-filterbank-review-not-your-nans-graphic-eq/
  - [INFERRED] The listed values check out. 61→115→218→411→777→1500→2800→5200 are each about ×1.86–1.93. The two end steps, 29→61 and 5.2k→11k, are about ×2.1.

**Front panel**
- "Ten centre‑indented sliders handle the individual filters' boost/cut amounts during normal operation" [REVIEW, SOS]. https://www.soundonsound.com/reviews/erica-synths-resonant-filterbank
- An OLED display and "six fixed‑purpose knobs": input, output, resonance, spread, dry/wet and a data encoder, plus buttons for mode switching and navigation [REVIEW, SOS].
- Button names seen in user posts: "play/load" and "lfo/mod" [USER]. https://www.elektronauts.com/t/erica-synths-resonant-filterbank/250296?page=2

**I/O and physical**
- **Audio:** stereo in and out on balanced 6.3 mm TRS. [MFR] Mono input also works. [MFR-retail, Music Store]
- **No headphone output.** [MFR-retail, Music Store] https://www.musicstore.de/de_DE/EUR/Erica-Synths-Resonant-Filterbank/art-SYN0009539-000
- **Size and weight:** 258 × 176 × 70 mm, 1.1 kg. [MFR]
- **Power:** "12VDC center positive" with the PSU included. [MFR-retail] https://www.perfectcircuit.com/erica-resonant-filterbank.html
- **CV:** "There is no CV connectivity." [REVIEW] https://synthanatomy.com/2026/05/erica-synths-resonant-filterbank-desktop-unit.html
- **Price:** €769 incl. VAT (€660 before VAT), $859, £675.

**Release**
- Teased in March 2026, shown at Superbooth in May 2026, and shipping from 18 May / June 2026.
- The Japanese manual targets **firmware 1.0**.

---

## 1. Per-band controls, resonance, feedback, drive

| Item | Finding | Tag / source |
|---|---|---|
| Band slider function (Filterbank mode) | Boost/cut per band, centre-detented. "hands-on control over each bands' boost or cut". | [MFR] product page; [REVIEW] SOS |
| **Slider dB range** | **Unknown / not found** for the desktop unit. A Eurorack review (translated from German) says that with resonance at 0 (fully CCW) "the amplification is -12dB", and that "at maximum gain it is approx. -6dB in the respective band". That suggests band peak gain stays below unity, but the wording is ambiguous. | [EURO] https://www.proaudio.tech/reviews/erica-synths-graphic-resonant-fb (Peter Kaminski, 2025-01-28) |
| Band at minimum | Eurorack: "when the output level of the corresponding filter is set to the minimum, it is set to 0" (the band is fully muted). | [EURO] proaudio.tech |
| Eurorack band editing | Bands are selected with CH1–10 and set with the DATA encoder; SHIFT gives fine steps. SHIFT functions can reset all bands to centre, randomise all bands, or randomise only the selected ones. | [EURO] https://clockfacemodular.com/en/products/erica-synths-graphic-resonant-filterbank |
| **Resonance on/off per band** | "You can turn resonance on or off per band". Thomann lists "Adjustable resonance characteristic and selectable feedback per band". Starsky Carr calls it "Per-band feedback routing — the feature the Serge never had". | [REVIEW] SOS; [MFR-retail] https://www.thomannmusic.com/erica_synths_resonant_filterbank.htm; [REVIEW] https://www.matrixsynth.com/2026/06/erica-synths-resonant-filterbank.html |
| Resonance = feedback | SOS: the main resonance knob "increases feedback on any band that is enabled", and "feedback and resonance are the same thing here". Sweetwater: "Its Resonance knob controls the amount of feedback applied to the filter". | [REVIEW] SOS; [MFR-retail] https://www.sweetwater.com/store/detail/ResFilterbank--erica-synths-resonant-filterbank-fx-unit |
| **Resonance knob: bipolar** | "The resonance control is bipolar, so at 12 o'clock there is no feedback". Clockwise adds positive feedback; anticlockwise adds polarity-inverted feedback. Starsky's chapter list says "Dual resonance, attenuverter feedback and stereo channel select". | [REVIEW] SOS; [REVIEW] Starsky (matrixsynth) |
| Eurorack CCW behaviour | At 12 o'clock there is no resonance. CCW is described as an inverted, damping effect ("反転減衰効果"). | [EURO] clockface |
| [INFERRED] meaning of CCW | Negative feedback around a band-pass lowers its peak gain and Q, giving a dip or damping. That fits the Eurorack "-12 dB at fully CCW" remark. **Not confirmed.** | [INFERRED] |
| "Dual resonance" | Probably the two mechanisms SOS describes: per-band self-feedback and the main loop (see below). **Not confirmed.** | [REVIEW] Starsky; [INFERRED] |
| **Resonance curve** | Thomann says "Adjustable resonance characteristic", which is a menu setting. On the desktop unit the options are **unknown**. On the Eurorack, the RESQ/RESO curve options are BALANCED (the default), linear (upper half only, lower half only, or the full range) and logarithmic (normal or inverted). Clockface lists them as balance, high-only, low-only, linear, log and exponential. | [MFR-retail] Thomann; [EURO] proaudio.tech, clockface |
| **Self-oscillation** | "At high resonance the unit self-oscillates, so it can work as a sound source with no external input". Erica calls it usable "as an experimental sound generator for no-input mixer-like setups". Starsky: "what happens when you turn the resonance knob past 3 o'clock". Eurorack: filters oscillate through feedback "when set above 12 o'clock". | [MFR-retail] https://schneidersladen.de/en/erica-synths-resonant-filterbank-desktop; [MFR] product page; [REVIEW] Starsky; [EURO] proaudio.tech |
| **Main feedback loop** | "there is a main feedback loop that takes the combined signal from all feedback‑enabled channels" and "feeds it back into the main input". It is separate from per-band feedback, and the two can run together. Together they give "a wide variety of tones, from subtle overdrive to howling distortion". Erica's own wording is "extensive feedback loop". | [REVIEW] SOS; [MFR] https://www.ericasynths.lv/news/post/resonant-filterbank-out-now/ (meta) and the video description at https://www.matrixsynth.com/2026/05/erica-synths-resonant-filterbank-sound.html |
| Main loop level control | **Unknown.** No source names a separate loop-level control. [INFERRED] Most likely the same bipolar Resonance knob scales it, or a menu setting does. | Not found |
| Tone or filter inside the loop | **Unknown.** No EQ, delay or limiter in the loop is mentioned. On the Eurorack, the loop is fed only from the selected band-pass outputs: "either all, none or one of the ten filter bands". Clockface: the selection "strongly affects the sound". | [EURO] proaudio.tech, clockface |
| Feedback saved in presets? | Eurorack: "Feedback settings are not saved with presets" (translated from Japanese). **Unknown** on the desktop unit. | [EURO] clockface |
| **Drive / saturation** | "analog GAIN STAGE that boosts incoming signals up to +24dB". SonicState: "with drive, modulation and dynamic EQ mode". Starsky "slams the input gain and cranks the resonance". **No dedicated saturation circuit or curve is documented.** [INFERRED] Distortion comes from the +24 dB input stage and from analog clipping in the feedback loops. | [MFR]; [REVIEW] https://www.sonicstate.com/news/2026/06/08/sonicdemo-erica-synths-bullfrog-drums-and-resonant-filter/; [REVIEW] synthmagazine |
| Practical level warnings | "When you get it, use a limiter!" Hoped for subtle tuned resonance but it "got too easily into eardeafening territory". "You´ll have to get used to working in a range of +/-20% of what the device offers you". | [USER] https://www.elektronauts.com/t/erica-synths-resonant-filterbank/250296?page=2 |
| Per-band resonance *amount* | **Not found.** There appears to be one global amount (the knob) plus a per-band on/off. [REVIEW] SOS and GearNews: "There's also a global resonance pot." MusicStore copy says resonance can have "its own LFO or envelope follower", so the knob is a modulation target. | [REVIEW] https://www.gearnews.com/erica-synths-resonant-filterbank-synth/; [MFR-retail] Music Store |

## 2. Spread / stereo

| Item | Finding | Tag / source |
|---|---|---|
| Spread function | Sliders set per-band boost/cut "with stereo offset courtesy of the Spread control". | [REVIEW] SOS |
| Independent L/R | "you can switch the Spread function via the global settings" to "dial in completely independent filter settings for each stereo channel". | [REVIEW] SOS |
| Stereo channel select | "Dual resonance, attenuverter feedback and stereo channel select" (Starsky chapter list). [INFERRED] In independent mode you choose L, R or both before editing. | [REVIEW] Starsky (matrixsynth) |
| Erica's wording | "extensive feedback loop and stereo panning options". Demo take 4 runs "in clock mode with a lot of SPREAD therefore adding a lot of 'stereo space'". Take 5 is "CLOCK mode adding subtle stereo modulation". | [MFR] Erica video description (https://www.youtube.com/watch?v=jOcxhh-Jh-c), via https://www.matrixsynth.com/2026/05/erica-synths-resonant-filterbank-sound.html |
| **What exactly Spread offsets** | **Unknown / not found.** No source says whether it offsets band gains, band modulation phase, or a pan or odd/even split. [INFERRED] Hypotheses to check in the manual: (a) mirrored gain offset, where L gets +x on some bands and R gets −x; (b) an LFO phase offset between L and R; (c) a Eurorack-style odd/even split. The Eurorack has separate ODD (1,3,5,7,9) and EVEN (2,4,6,8,10) outputs, which the reviewer suggests "for a quasi-stereo signal". Frequencies are fixed, so the offset cannot be a frequency offset. | [EURO] proaudio.tech; [INFERRED] |
| Stereo architecture | Each of the 10 bands exists twice (L and R), so there are 20 analog band-pass filters. [INFERRED] from "analog stereo filterbank" plus independent-channel mode. | [INFERRED] |

## 3. Filter mode (Erica's demo also calls it "VCF mode")

| Item | Finding | Tag / source |
|---|---|---|
| Types | LP, HP, BP and notch: "Additional multimode filter mode with low-pass, band-pass, high-pass or notch characteristics". | [MFR-retail] Thomann; [REVIEW] SOS; [REVIEW] Starsky "Filter mode with its low, high, band, and notch options" |
| Mechanism | "the 10 band‑pass filters can work in unison to emulate multi‑mode filter behaviour (LP/HP/BP/notch). It does this by automating the 10 bands." "in low‑pass mode, it will reduce the band‑pass filter gain for the top band then the next band down, and so on, as you close the filter." | [REVIEW] SOS |
| Slider roles | "the sliders take on different roles: cutoff, slope, filter type, etc." The full slider-to-parameter mapping is **unknown** because it sits behind the paywall. | [REVIEW] SOS |
| Eurorack parameters | LP/HP: cutoff (F), slope (S) and resonance. BP/notch: cutoff (F), slope (S), bandwidth (W) and resonance. Type is chosen with SHIFT plus BAND4/6/8/10. CV1 controls cutoff, CV3 slope and CV5 bandwidth. | [EURO] clockface |
| Morphing between types | Perfect Circuit: "a multimode filter mode for morphing between classic filter types". Whether the type changes continuously or in steps is **unknown**. | [MFR-retail] https://www.perfectcircuit.com/erica-resonant-filterbank.html |
| Envelope follower | Erica says it can act as "an unconventional multimode filter with an envelope follower". [INFERRED] An envelope follower can drive cutoff (auto-wah). | [MFR] product page |
| Resonance in this mode | "The feedback system works here too, causing all sorts of sonic mayhem. It rarely sounds like traditional multi‑mode filter resonance, and is much more of a distortion tool." "Filter mode is not particularly convincing as a classic filter." | [REVIEW] SOS |
| Cutoff range and resolution, slope range, interpolation curve | **Unknown / not found.** | – |

## 4. Clocked Modulation mode

| Item | Finding | Tag / source |
|---|---|---|
| Purpose | GearNews: "a clocked modulation mode to update band values in sequence like sample & hold". Retail copy: "Clocked modulation mode steps band values sequentially like sample and hold", or it creates clock-synced oscillating stereo effects. MusicRadar: "program specific band positions in a set sequence" and "build oscillating stereo effects". | [MFR press text, via] https://www.gearnews.com/erica-synths-resonant-filterbank-synth/, https://wrdtunes.com/products/erica-synths-resonant, https://www.musicradar.com/music-tech/synths/is-it-a-filter-or-is-it-an-instrument-for-erica-synths-the-answer-is-why-not-both-as-it-drops-resonant-filterbank-at-superbooth-2026 |
| Sync | "MIDI clock synchronization of events". | [MFR] |
| Internal tempo | **Unknown for the desktop unit.** The Eurorack has INT/EXT clock with an internal BPM set in 10 BPM steps (finer with SHIFT). The BPM range is not stated. | [EURO] clockface; proaudio.tech |
| Footswitch tap tempo | **Not found.** | – |
| Divisions | **Not found.** | – |
| Eurorack algorithm (likely ancestor) | **CV1 mode** is a shift register: "On each clock pulse, the CV1 value passes to the next band-pass filter. After filter 10 it cycles back to filter 1." **ALL CV mode** is a sample-and-hold of CV1–10, each held until the next clock. A "CV gain" attenuator goes from 0 to 2. proaudio: "With an incoming or internal clock pulse, the input value is stored as a sample & hold and assigned to the current filter… With each clock pulse, the corresponding filter number will increase." | [EURO] clockface; proaudio.tech |
| Eurorack firmware note | Eurorack firmware 1.4 "greatly improves the modules clock mode!" The changes are unknown. | [EURO] https://www.ericasynths.lv/news/post/resonant-fb-firmware-update-14/ |
| Desktop source signal | **Unknown.** The desktop unit has no CV inputs, so it must sample an internal source: an LFO, an envelope follower, or slider positions as "programmed band positions". MusicRadar's next sentence, "This is done via 20 independent LFOs and envelope followers which can be assigned to any control parameter", may be about this mode, but the wording is ambiguous. | [REVIEW] MusicRadar; [INFERRED] |
| Stereo patterns | Erica's demo uses CLOCK mode "with a lot of SPREAD" for stereo width, and for "subtle stereo modulation". Pattern types are **unknown**. | [MFR] Erica video description |

## 5. Dynamic Equalizer mode ("dynamic spectral compressor")

| Item | Finding | Tag / source |
|---|---|---|
| Purpose | Erica's list has "Dynamic spectral compressor mode". GearNews: "a dynamic EQ, which acts like a spectral compressor". Retail copy: it "operates as a spectral compressor, automatically attenuating bands in proportion to their energy content". | [MFR]; [REVIEW] GearNews; [MFR-retail] wrdtunes |
| Eurorack behaviour | The DATA encoder sets the cut threshold, and pressing DATA enables the mode: frequencies above the threshold are cut automatically. SHIFT+DATA enables BOOST, which slightly boosts frequencies below the threshold. proaudio: "with BOOST ON, you amplify the components that are below the threshold." | [EURO] clockface; proaudio.tech |
| Threshold, ratio, attack/release, range | **Not found** for either unit. Per-band versus global is **not found**; the Eurorack sources describe a single threshold. | – |
| What the sliders do | **Unknown.** The SOS section is paywalled. [INFERRED] They may set per-band thresholds or target levels. | – |
| Sidechain | **Not found.** There is no sidechain input; I/O is stereo L/R only. [INFERRED] Each band's detector most likely follows its own band signal. | – |
| Feedback in this mode | Feedback is active. Erica demo take 6 uses "DYNAMIC EQ mode with extreme feedback settings generating bassline for the TR-505". Users "Was really enjoying the dynamic eq". | [MFR] Erica video description; [USER] Elektronauts |

## 6. LFOs

| Item | Finding | Tag / source |
|---|---|---|
| Count | "20 independent LFOs". | [MFR] |
| Assignment | "each of which can be assigned to any control parameter". Music Store: each band separately, and also the resonance, can be driven "über einen eigenen LFO oder Hüllkurvenfolger" (by its own LFO or envelope follower). | [REVIEW, from the press release] GearNews, MusicRadar; [MFR-retail] Music Store DE |
| Per-band behaviour | "having lfo modulation with different speeds and depths on the different bands is a super smart feature". | [USER] nobuyoshi, Elektronauts p.2 |
| Sync | "LFO and envelope modulation — synced to MIDI and free-running". | [REVIEW] Starsky (matrixsynth) |
| UI | The LFO/MOD button. "Init" under PLAY/LOAD followed by the LFO/MOD button "only deletes the modulation settings", not the whole preset. | [USER] Elektronauts p.2 |
| **Why 20** | **Not stated.** [INFERRED] 10 bands × 2 stereo channels fits the "independent filter settings for each stereo channel" option, but it could also be 10 bands plus 10 other destinations. | [INFERRED] |
| Waveforms, rate range, phase/stereo offset, depth range | **Not found.** | – |

## 7. Envelope followers

| Item | Finding | Tag / source |
|---|---|---|
| Count | "20 independent envelope followers". | [MFR] |
| Use | They animate bands and other parameters, or "track the input's dynamics" (retail paraphrase). Erica: "unconventional multimode filter with an envelope follower". | [MFR-retail] Schneidersladen; [MFR] |
| Assignment | The same "assign to any control parameter" scheme as the LFOs, including per-band and resonance. | [REVIEW] GearNews; [MFR-retail] Music Store |
| Detection source (input vs band output), attack/release, why 20 | **Not found.** [INFERRED] Possibly one per band per channel, detecting either the input or the band output. | – |

## 8. Macro view

| Item | Finding | Tag / source |
|---|---|---|
| Function | GearNews: "Macro view, where you can configure sliders for simultaneous access of features". MusicRadar: "a helpful Macro view that can guide you when setting the sliders to access and control specific features". Retail copy: "a Macro view for configuring grouped slider assignments as performance controls". Audiofanzine: the 10 sliders can be assigned to other functions, with the active function shown on the screen. | [REVIEW] GearNews, MusicRadar, Audiofanzine; [MFR-retail] wrdtunes |
| Review notes | "Macro pages make live tweaking a breeze", "at least when the firmware behaves". Starsky reports "macro bugs". SonicState demo has a chapter at 41:18 "Macros" (https://www.youtube.com/watch?v=uNb44FgnM1s). | [REVIEW] synthmagazine; matrixsynth chapter list https://www.matrixsynth.com/2026/06/erica-synths-bullfrog-drums-resonant.html |
| Number of macros, targets, ranges | **Not found.** | – |

## 9. Presets / snapshots / morph

| Item | Finding | Tag / source |
|---|---|---|
| Count | "User snapshot (preset) memory with 128 slots". | [MFR] |
| Factory vs user | "The first 32 presets are assigned factory programmes ex works, with a further 96 available for free use." | [MFR-retail] https://www.musicstore.de/en_DE/EUR/Erica-Synths-Resonant-Filterbank/art-SYN0009539-000 |
| Change modes | "Discrete and morphing snapshot change". | [MFR] |
| Morph time | "The options for this range from 0.1 to 10 seconds." | [MFR-retail] Music Store |
| Morph character | Morphing runs in real time without parameter jumps (retail paraphrase). Starsky: "Snapshot pools with MIDI-clocked morphing between presets", which lets "shift entire settings in sync with your beat". | [MFR-retail] wrdtunes; [REVIEW] Starsky |
| Randomiser | "Hidden in the menu is a parameter randomiser that provides unexpected results, which can of course be saved." | [MFR-retail] Music Store |
| Init | The INIT entry in PLAY/LOAD clears only the modulation settings. | [USER] Elektronauts |
| Eurorack ancestors | PLAY modes: CLK (next preset on each clock), RND-CLK (random, excluding the current one), CV (0–10 V across 128), CV-CLK (CV-selected, switching on clock). Morph is toggled with SHIFT plus an encoder press, and the encoder sets the time. Presets store only the parameters of the selected mode, not global settings. Eurorack global settings "are lost when the device is switched off". | [EURO] clockface; proaudio.tech |
| What is stored (desktop) | **Unknown.** [INFERRED] Probably band gains, mode, resonance, modulation and macros, but not global settings. | – |
| Morph triggers | **Unknown:** MIDI program change, footswitch, or clock-quantised. Starsky implies clocked morphing. | – |
| Banks / "pools" | Starsky mentions "snapshot pools". The structure is **unknown**. | [REVIEW] |

## 10. MIDI, footswitch, I/O levels

| Item | Finding | Tag / source |
|---|---|---|
| MIDI CC | "MIDI control over all parameters". GearNews: "You get MIDI CC control over each frequency band as well as resonance". Retail copy: MIDI CC reaches every parameter individually. | [MFR] product page; [REVIEW] GearNews; [MFR-retail] wrdtunes |
| CC map | **Not found.** | – |
| Program change | **Not found.** | – |
| MIDI clock | "MIDI clock synchronization of events". | [MFR] |
| Ports | **Conflict between sources.** Erica's press list says "DIN 5 MIDI IN and MIDI OUT". Thomann, Synth Anatomy and Sweetwater list **MIDI In and Thru**. MusicRadar lists DIN in only. | [MFR] vs [MFR-retail]; https://www.thomannmusic.no/erica_synths_resonant_filterbank.htm |
| USB-C | "USB for firmware updates and patch backup". Music Store claims "USB AUDIO Interface: Ja" and USB-MIDI. **That claim is unverified and probably wrong**: Synthtopia readers lament the lack of USB MIDI/audio. | [REVIEW] GearNews, MusicRadar; [MFR-retail] Music Store; https://www.synthtopia.com/content/2026/05/08/erica-synths-intros-resonant-filterbank-at-superbooth-2026/ |
| Footswitch | A "configurable footswitch input" on a 6.3 mm TS jack. Erica's demo: "Footswitch is used to bypass the RES FB." Sweetwater claims snapshot and mode switching (unverified). | [MFR]; [MFR-retail] Thomann; [MFR] Erica video description; [MFR-retail] Sweetwater |
| Input gain | An analog gain stage of "up to +24dB", enough for guitar. The knob law is **unknown**. | [MFR] |
| Output / dry-wet | Dedicated output and dry/wet knobs. Whether dry/wet is equal-power or linear, and where the dry signal is tapped (before or after input gain), is **unknown**. | [REVIEW] SOS; Audiofanzine ("Dry/Wet and master volume") |
| Sliders vs MIDI / presets | Starsky reports "parameter pickup issues". [INFERRED] The physical sliders use a pickup/catch scheme after a preset load or MIDI change. One Elektronauts question about this went unanswered. | [REVIEW] synthmagazine; [USER] |

## 11. Spectrum analyser

| Item | Finding | Tag / source |
|---|---|---|
| Existence | "Spectral analyzer mode". | [MFR] |
| Display | "Spectrograph / Lissajous display". [INFERRED] The Lissajous view is an L/R goniometer. | [REVIEW] Starsky (matrixsynth) |
| Eurorack options | Peak display on/off, peak fall time, and a LIN or LOG X-axis (LIN is the default). | [EURO] clockface; proaudio.tech |
| Bins, desktop options | **Not found.** | – |

## 12. Other / global settings

**Global settings**
- **Global settings menu:** this is where Spread is switched to independent L/R [REVIEW, SOS].
- **Eurorack configuration menu** [EURO, clockface]:
  - INFO
  - FACTORY RESET (hold BAND10, then BAND7 to reset)
  - DISPLAY (brightness, dimming time, screensaver)
  - CV range (±5 V, ±10 V, 0–5 V, 0–10 V) and master attenuation, 0.1–1.0
  - RESO curve
  - FEED band selection
- **Desktop menu contents:** **not found**. [INFERRED] It probably includes the resonance curve, feedback routing, Spread mode, MIDI channel, footswitch function and the randomiser.

**Operating modes**
- **Modes named by Erica and retailers:** "Betriebsmodi: Filterbank, Multimode Filter, Clocked Modulation, Dynamic EQ", plus spectral analyser and "dynamischer Spektralkompressor" [MFR-retail, Music Store DE].
- **Mode names in Erica's video:** FILTERBANK, CLOCK, VCF, DYNAMIC EQ [MFR].
- **Eurorack main menu:** FB, FILTR, CLK, DYN, PLAY, plus LOAD, SPECT and SYST [EURO, proaudio.tech].

**Firmware**
- **Desktop:** updated over USB [REVIEW].
- **Eurorack:** an audio-file bootloader [EURO].
- **Manual version:** the Japanese manual matches FW 1.0. Firmware quirks were reported in June 2026: pickup and macros.

**Calibration**
- **Not found** for either unit.

**Reference videos** (not watchable from here)
- Erica Intro: https://www.youtube.com/watch?v=gffs03nRNS4
- Erica Sound Demo: https://www.youtube.com/watch?v=jOcxhh-Jh-c
- Starsky Carr review: https://www.youtube.com/watch?v=CZBDTV3NOj4
- SonicState demo: https://www.youtube.com/watch?v=uNb44FgnM1s (chapters: 22:00 Resonant Filterbank, 26:25 Configs, 28:50 Filter Mode, 31:45 Clk Mod, 34:23 Dynamic EQ Mode, 41:18 Macros)
- SOS Superbooth: https://www.youtube.com/watch?v=11Pe75TDZAQ
- "Resonant Filterbank Desktop": https://www.youtube.com/watch?v=m6DBkYDHO9o

---

## Summary of unknowns (resolve with the manual PDF)

1. **Section 1:** slider dB range; whether band amounts are per-band; main-loop level and whether there is anything in the loop; resonance-curve options on the desktop unit; whether feedback settings are stored in presets.
2. **Section 2:** what Spread actually offsets.
3. **Section 3:** the slider-to-parameter map in Filter mode, the parameter ranges, and whether type changes morph or step.
4. **Section 4:** internal tempo, divisions, the source signal, and the stereo patterns in Clocked Modulation.
5. **Section 5:** threshold, ratio, attack/release, per-band versus global, and the slider role in Dynamic EQ.
6. **Section 6:** LFO waveforms, rates, phase, and why there are 20.
7. **Section 7:** envelope-follower detector source and timing.
8. **Section 8:** macro count and targets.
9. **Section 9:** preset contents, pools, and morph triggers.
10. **Section 10:** CC map, program change, the MIDI Out-versus-Thru conflict, and the footswitch options.
11. **Section 11:** analyser details on the desktop unit.
12. **Section 12:** the menu list and any calibration.
