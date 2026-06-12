# CutPilot — research notes & roadmap

*Compiled June 2026. Sources at the bottom.*

## 1. Platform decision: CEP today, UXP tomorrow

- **UXP graduated from beta in Premiere Pro 25.6** (Adobe developer blog,
  Dec 2025). Adobe's guidance: new development should start in UXP, and CEP
  will be supported for roughly **one more calendar year** before removal.
- However, the UXP editing API is still young: it covers project/sequence
  basics, `createRemoveItemsAction` (with ripple) and `createCaptionTrack`,
  but **not** the full razor/trim surface, QE-style operations, or MOGRT
  parameter access that commercial auto-editors rely on. Community threads
  still describe timeline manipulation as the weak spot.
- Every shipping competitor today (AutoCut, TimeBolt, Firecut) is a CEP
  panel. CEP gives us Node.js (file IO, ffmpeg) and the undocumented QE DOM
  (razor, ripple delete) — the only way to do in-place silence cutting.

**Decision:** ship v0.x on CEP, keep all decision logic in pure JS modules,
and treat ExtendScript/CEP as a thin adapter so the UXP port (target:
within 12 months) only replaces the adapter layer.

## 2. How silence removal actually works in this market

Pattern shared by TimeBolt, AutoCut, CutBack, Phantom Editor:

1. Read the source media's audio (not the program output).
2. Threshold-based detection — user sets **dB floor** (typically −35 to
   −45 dB) and **minimum pause duration** (0.4–1.0 s) so natural breaths
   survive. ffmpeg's `silencedetect` filter is the de-facto engine.
3. **Padding** around speech (~0.1 s) so consonants don't get clipped.
4. Apply as razor + ripple delete in the timeline, or export a cut list /
   rebuilt sequence.

Differentiators we adopted:

- **Dry-run as markers** before cutting (TimeBolt's "preview" is its most
  loved feature).
- **Safe rebuild mode** building a new sequence — zero risk, supported API.
- **Two detector engines** — Web Audio (zero-install) + ffmpeg (long files).
- Newer tools (Premiere Assistant / CutBack) market *contextual* silence
  detection that preserves laughter/breaths — that's our ML roadmap item.

## 3. Caption style trends (what's actually working in 2026)

- **Word-by-word "karaoke" captions dominate short-form.** Each word pops
  in sync with speech; measured ~**+15% engagement on educational
  content** versus static block subtitles.
- **Hormozi style** is the most copied look: ALL-CAPS, one word (or 2–3) at
  a time, heavy condensed sans (Montserrat Black / Anton / Bebas Neue),
  thick black stroke, **yellow highlight on emphasized keywords**,
  positioned lower-middle third.
- **High contrast is non-negotiable**: white-on-black-stroke or
  yellow-on-black; readable on any background, any phone, sound off.
- **Highlight-box style** (word sits on a colored rounded box that snaps
  word to word) — the CapCut/Submagic signature, second most requested.
- Counter-trend: **hand-drawn annotation layers** (highlighter swipes,
  red circles, scribbled arrows) layered *on top of* captions — reads as
  human attention.
- Long-form/corporate still wants **clean minimal lower-third sentences**.

These six looks became CutPilot's preset catalog (`js/captions.js`):
Hormozi Bold, Karaoke Highlight, Highlight Box, Clean Minimal, Neon Pop,
Typewriter — each with font, size, fill/highlight/stroke colors, casing,
words-per-cue, and an animation spec.

### Caption pipeline reality check (Premiere scripting)

- Premiere's Speech-to-Text is not scriptable, but its SRT export is the
  universal entry point — every competitor uses transcript → SRT → style.
- Native caption track *styling* is not exposed to ExtendScript. Workable
  v1: re-time/casing via SRT (word-explode does the trending animation
  feel), let the user save a Track Style once.
- Full animation control = one MOGRT per cue via `importMGT` + setting the
  text param. That's the AutoCaption/Firecut approach; CutPilot implements
  it generically for any one-text-field `.mogrt`.

## 4. Competitor feature matrix (June 2026)

| Feature | TimeBolt | AutoCut | Submagic* | Firecut | **CutPilot v0.1** |
|---|---|---|---|---|---|
| Silence removal | ✅ | ✅ | — | ✅ | ✅ (2 engines) |
| Preview before cut | ✅ | partial | — | ✅ | ✅ (markers + checklist) |
| Safe non-destructive mode | export | — | — | — | ✅ (rebuild) |
| Multicam angle switching | ✅ | partial | — | — | ✅ (4 modes) |
| Animated captions | — | ✅ | ✅ | ✅ | ✅ (native + MOGRT) |
| Word-by-word karaoke | — | ✅ | ✅ | ✅ | ✅ |
| Auto-zoom / punch-ins | ✅ | ✅ | ✅ | ✅ | roadmap |
| Filler-word removal ("um") | ✅ | ✅ | ✅ | ✅ | roadmap |
| AI B-roll / emoji / SFX | — | ✅ | ✅ | partial | roadmap |
| Price | $97–197 | sub | sub (web) | sub | TBD |

*Submagic is web-based, included for caption-feature reference.

## 5. Improvement roadmap

**v0.2 — polish the core**
- Waveform visualization with draggable silence boundaries in the panel.
- Per-silence "audition" (move playhead to silence on click). 
- Speed-ramp/reverse-aware time mapping.
- Caption remap after cutting (`remapCuesToKeeps` is already implemented
  and tested — wire it into the UI).

**v0.3 — transcript intelligence**
- Filler-word removal: parse the transcript SRT for "um/uh/like/you know",
  match word timings, feed the same cutting engine. (Pure extension of the
  existing range pipeline.)
- Keyword auto-highlight for Hormozi preset (TF-IDF over transcript picks
  the yellow words automatically).

**v0.4 — visual energy**
- Auto-zoom punch-ins: alternate 100%/110% scale per segment (the standard
  retention trick; trivial via clip Motion properties).
- Auto-reframe presets for 9:16 / 1:1 exports.
- SFX markers: whoosh/pop at every cut (insert audio clips from a bundled
  SFX folder).

**v0.5 — AI layer**
- Contextual silence detection (VAD model, e.g. Silero via ONNX in Node)
  that keeps laughter and intentional pauses.
- Local Whisper integration for transcripts without Premiere's STT.
- AI B-roll suggestions from transcript keywords (stock API search).

**v1.0 — UXP port + marketplace**
- Rewrite adapters on the UXP API (panel JS is already framework-free).
- Sign, package, ship to Adobe Exchange / aescripts.

## Sources

- [Adobe Developer Blog — UXP Arrives in Premiere (Dec 2025)](https://blog.developer.adobe.com/en/publish/2025/12/uxp-arrives-in-premiere-a-new-era-for-plugin-development)
- [Adobe — The Premiere UXP API](https://developer.adobe.com/premiere-pro/uxp/) · [Understanding UXP APIs](https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis/) · [Changelog](https://developer.adobe.com/premiere-pro/uxp/changelog/)
- [Hyper Brew — Premiere Pro UXP Beta analysis](https://hyperbrew.co/blog/premiere-pro-uxp-beta/)
- [Adobe CEP Samples — PProPanel](https://github.com/Adobe-CEP/Samples/blob/master/PProPanel/ReadMe.md)
- [Premiere Pro Scripting Guide (docsforadobe)](https://ppro-scripting.docsforadobe.dev/)
- [Adobe Community — Remove silence Script for Premiere Pro](https://community.adobe.com/t5/premiere-pro-discussions/remove-silence-script-for-premiere-pro/td-p/13579500) · [Perform a cut from script?](https://community.adobe.com/t5/premiere-pro-discussions/perform-a-cut-from-script/td-p/11389974)
- [FFmpeg silencedetect filter](https://ffmpeg.org/ffmpeg-filters.html#silencedetect)
- [TimeBolt for Premiere](https://www.timebolt.io/blog/timebolt-premiere-pro-extension) · [AutoCut](https://www.autocut.com/en/) · [CutBack — best auto silence removal](https://cutback.video/blog/the-best-auto-silence-removal-plugin-for-premiere-pro) · [Phantom Editor](https://phantomeditor.video/features/silence-remover)
- [Karadeo — How to make Hormozi captions](https://karadeo.com/resources/how-to-make-alex-hormozi-captions) · [Ascynd — Hormozi style guide](https://ascynd.io/en/blog/hormozi-captions)
- [Blitzcut — TikTok caption styles 2026](https://blitzcutai.com/blog/best-caption-style-tiktok) · [TikTok caption fonts](https://blitzcutai.com/blog/best-caption-fonts-tiktok)
- [Poko — Best caption styles for marketing videos 2026](https://poko.video/blog/best-caption-styles-for-marketing-videos-2026-guide)
- [FontMirror — Typography trends in short-form video](https://www.fontmirror.com/en/typography-trends-shaping-short-form-ai-video-content/)
