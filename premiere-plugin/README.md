# CutPilot — auto-editing panel for Adobe Premiere Pro

CutPilot is a CEP extension panel for Premiere Pro that automates the three
most repetitive parts of talking-head and multicam editing:

1. **Silence / pause removal** — analyzes the selected clip's audio, finds
   dead air, and either cuts it in place or rebuilds a trimmed sequence.
2. **Multicam auto-switching** — assigns a camera angle to every kept
   segment (rotate / ping-pong / random / hero-cam modes) and toggles the
   stacked camera tracks accordingly.
3. **Trend-styled animated captions** — finds your transcript
   automatically (in the project, next to your footage, or next to the
   project file), then renders captions with CutPilot's **built-in
   animation engine**: every caption frame is drawn to a transparent PNG
   (any font, color, stroke, glow, highlight box) and placed on a fresh
   top track with real Premiere keyframes for the entry animation. No
   MOGRTs, no manual files. Six style presets (Hormozi Bold, Karaoke
   Highlight, Highlight Box, Clean Minimal, Neon Pop, Typewriter) ×
   eight animations (Pop, Bounce, Slide up, Fade, Glitch, Karaoke,
   Typewriter, None) — mix and match freely, Captions.ai-style.

See [`docs/RESEARCH.md`](docs/RESEARCH.md) for the market/trend research and
the feature roadmap behind this design.

---

## Requirements

- Adobe Premiere Pro 2020 (14.0) or newer. Captions API needs 22.0+.
- Windows or macOS.
- Optional but recommended: an `ffmpeg` binary for fast silence analysis on
  long files and exotic codecs (set the path in the Settings tab).

## Easy install (no technical steps)

1. Download this repository as a ZIP (green **Code** button → Download ZIP)
   and unzip it.
2. Open the `premiere-plugin` folder and run the installer:
   - **Windows:** double-click `install-windows.bat`
   - **Mac:** right-click `install-mac.command` → Open
     (or run `bash install-mac.command` in Terminal)
3. Restart Premiere Pro and open **Window → Extensions → CutPilot**.

The installer enables CEP debug mode and copies the panel into Premiere's
extensions folder for you. Prefer doing it by hand? See below.

## Manual install (development / unsigned)

CEP refuses unsigned panels unless debug mode is on:

**macOS**

```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
# Premiere 24+ may also read CSXS.12:
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

**Windows** — add a String value `PlayerDebugMode` = `1` under
`HKEY_CURRENT_USER\Software\Adobe\CSXS.11` (and `CSXS.12`).

Then copy this `premiere-plugin` folder into the CEP extensions directory:

- macOS: `~/Library/Application Support/Adobe/CEP/extensions/CutPilot`
- Windows: `C:\Users\<you>\AppData\Roaming\Adobe\CEP\extensions\CutPilot`

Restart Premiere and open **Window → Extensions → CutPilot**.

## Usage

### Silence / pause removal

1. Select the clip to analyze in the timeline (the A/V clip of your talking
   head).
2. Tune the knobs: **Threshold** (audio below this dB counts as silence),
   **Min pause** (shorter pauses survive — keeps natural breaths), **Padding**
   (safety margin kept around speech), **Min keep** (slivers shorter than
   this are cut too).
3. **Analyze selected clip** → review the list, untick silences you want to
   keep, and use **Preview as markers** to audition before cutting.
4. Apply with one of two engines:
   - **Rebuild trimmed sequence (safe)** — builds a brand-new sequence from
     only the kept segments using fully supported APIs. Your original
     sequence is untouched. *Recommended.*
   - **Cut in place (QE)** — razors every track at each boundary and deletes
     the silent pieces in the current sequence (optionally closing gaps).
     Uses the undocumented QE DOM; the panel clones your sequence first as a
     backup by default.

### Multicam

1. Stack your synced cameras on V1, V2, … (audio on A1).
2. Run a silence analysis (the angle plan follows those cut points).
3. Pick the number of camera tracks and a switching mode, build the plan,
   review the per-segment angle list, then **Apply plan** — CutPilot
   enables the chosen camera and disables the others per segment.

The Captions tab is two simple steps, then one button.

**Step 1 — Transcript.** CutPilot finds it automatically: SRT/VTT files
already in your project, sitting next to your footage, or next to the
project file. No transcript yet? Premiere makes one — **Window → Text →
Transcribe sequence**, export to SRT next to your video, hit **Refresh**.
The "No transcript? →" button walks you through it. You can also **Pick a
file** manually.

**Step 2 — Pick a look.** Three modes, and only the chosen mode's controls
are shown (progressive disclosure):

- **Animated** *(recommended)* — CutPilot's built-in engine. Choose a
  **style** card (live animated previews) and an **animation** chip:
  Pop, Bounce, Slide up, Fade, Glitch, Karaoke, Typewriter, None. Every
  caption frame is rendered to a transparent PNG and placed on a new top
  track with real Premiere keyframes. No templates needed.
- **Template** — use a Premiere Motion Graphics Template (.mogrt) for the
  animation. Two sources:
  - **Installed in Premiere** — CutPilot scans the templates already
    installed in your copy of Premiere (the Essential Graphics library)
    and lists them in a dropdown, grouped by folder. Pick one.
  - **From a file** — choose any `.mogrt` you downloaded or made. CutPilot
    adds one graphic per caption line and types the words into its text
    field.
- **Plain** — a normal, editable caption track. Set the font once in
  Essential Graphics and save it as a Track Style.

**Fine-tune** (optional): words-at-a-time (1 = word-by-word pop, 0 = full
lines), UPPERCASE, text size, vertical position.

Then press **✨ Add captions**.

## Project layout

```
premiere-plugin/
├── CSXS/manifest.xml      CEP manifest (panel, PPRO 14+, Node enabled)
├── index.html             Panel UI (4 tabs)
├── css/style.css          Premiere-dark theme
├── js/
│   ├── main.js            Panel controller / UI glue
│   ├── audio.js           Web Audio + ffmpeg silence detectors
│   ├── silence.js         Range math (pure, unit-tested)
│   ├── captions.js        SRT tooling, style presets, animation planners
│   ├── render.js          Built-in caption render engine (canvas → PNG)
│   ├── multicam.js        Angle planning (pure, unit-tested)
│   └── lib/cep-bridge.js  Minimal CSInterface replacement
├── jsx/host.jsx           ExtendScript: razor, ripple, rebuild, multicam,
│                          caption placement + keyframed animations, MOGRT
│                          insertion, installed-template discovery
├── install-windows.bat    One-click installer (Windows)
├── install-mac.command    One-click installer (macOS)
└── test/run-tests.js      Node unit tests (node test/run-tests.js)
```

## Tests

```bash
node test/run-tests.js
```

The pure logic modules (silence math, SRT tooling, angle planning) run in
both the CEP panel and Node, so the cutting decisions are testable without
launching Premiere.

## Packaging for distribution

Use Adobe's ZXPSignCmd to sign and package:

```bash
ZXPSignCmd -selfSignedCert US NY CutPilot cert-pass certificate.p12
ZXPSignCmd -sign premiere-plugin CutPilot.zxp certificate.p12 cert-pass -tsa http://timestamp.digicert.com
```

Distribute the `.zxp` via [aescripts](https://aescripts.com),
[ZXP Installer](https://aescripts.com/learn/zxp-installer/), or the Adobe
Exchange marketplace.

## Known limitations (v0.1)

- The Web Audio decoder loads the whole file into memory — use the ffmpeg
  engine for files over ~20 minutes.
- "Cut in place" relies on the undocumented QE DOM. It is the same
  mechanism community silence-cutters use, but Adobe doesn't guarantee it;
  the safe rebuild mode is the supported path.
- Rendered captions are images: fully styled and animated automatically,
  but editing a word means re-running (or use the native caption engine,
  whose text stays editable in Premiere).
- Word-by-word on long videos renders many PNGs (≈1 per word). The panel
  warns above 1,500 frames; karaoke phrase mode reduces the count.
- Speed-ramped or reversed clips aren't compensated in the time mapping yet.

## Why CEP and not UXP?

UXP officially arrived for Premiere in 25.6 (December 2025) and is the
future, but its editing API doesn't yet cover everything this panel needs
(QE-style razor/ripple, MOGRT parameter access). Adobe has committed to
roughly a year of continued CEP support. CutPilot keeps every business rule
in pure JS modules (`js/silence.js`, `js/captions.js`, `js/multicam.js`)
with thin CEP/ExtendScript adapters, so the UXP port is a rewrite of the
adapter layer only. See `docs/RESEARCH.md` for the migration plan.
