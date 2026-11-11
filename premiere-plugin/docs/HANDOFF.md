# CutPilot — Project Handoff

Read this first to continue work in a new chat. Everything below is already
in this repo; the conversation transcript is **not** needed — the code +
these docs are the source of truth.

- **Repo branch:** `claude/keen-meitner-0iyw86`
- **PR:** #4 (draft) on `vikasbanjare/Stock-Market-Data-Research`
- **Plugin folder:** `premiere-plugin/`
- **Current version:** v0.7.0 (see `CSXS/manifest.xml` + header badge)
- **Tests:** `node premiere-plugin/test/run-tests.js` → 138 passing
- **Companion docs:** `docs/RESEARCH.md` (decisions/competitor research),
  `docs/DESIGN.md` (full UI/UX spec), `README.md` (install + usage).

## What it is
CutPilot is a CEP extension panel for Adobe Premiere Pro that automates
talking-head / podcast editing, modeled on Captions.ai + FireCut:
1. **Captions** — auto-found transcript (SRT) → animated captions with a
   live preview, 36 templates, full customizer, audio-synced word timing,
   keyword highlight, speaker labels; plus a MOGRT path.
2. **Smart Cut** — silence/pause removal (rebuild-safe or in-place).
3. **Multicam** — FireCut-style: cut to whoever's loudest (per-mic
   loudness), plus switch-on-speech / interval / markers / Smart-Cut modes.
4. **Settings** — ffmpeg path + one-tap full diagnostic.

## Architecture (important)
All real logic is **pure, dependency-free JS** shared between the panel and
Node tests; thin adapters touch Premiere. So logic is testable without
Premiere, and a future UXP port only rewrites the adapters.

```
premiere-plugin/
  CSXS/manifest.xml      CEP manifest (PPRO 14+, Node enabled), version here
  index.html             panel UI (Captions/Smart Cut/Multicam/Settings)
  css/style.css          "Studio" dark theme (Claude clay #d97757, Hanken Grotesk)
  js/
    main.js              panel controller / all UI wiring (the big file)
    captions.js          SRT parse, templates(36), animations, keyword engine,
                         audio word-alignment, buildCaptionFrames  [pure, tested]
    render.js            canvas → PNG caption renderer (fonts/stroke/box/pill) [pure parts tested]
    silence.js           silence range math [pure, tested]
    multicam.js          angle planning, directorPlan, loudnessToRegions,
                         burstStarts, segment helpers [pure, tested]
    audio.js             ffmpeg detectors: silencedetect + ffmpegEnvelope (RMS)
    lib/cep-bridge.js    evalScript ↔ ExtendScript JSON bridge
  jsx/host.jsx           ExtendScript host (ES3!) — all CP_* functions:
                         razor/ripple, rebuild, multicam apply (razors tracks),
                         caption PNG placement + keyframed anim, MOGRT insert,
                         CP_inspectMogrt, CP_getAudioTracks, CP_saveProject, etc.
  test/run-tests.js      Node unit tests for the pure modules
  install-mac.command / install-windows.bat   one-click installers (clear CEP cache)
  docs/                  RESEARCH.md, DESIGN.md, HANDOFF.md
```

## Build / ship loop
1. Edit files. 2. `node premiere-plugin/test/run-tests.js`. 3. Bump version
in `CSXS/manifest.xml` + `index.html` (`#ver` badge + footer). 4. Commit +
push. 5. Zip the `premiere-plugin` folder as `CutPilot` and deliver.
- Host is ES3: **no** arrow funcs / let / const / template literals /
  Array.map/filter in `jsx/host.jsx`. Syntax-check via
  `cp jsx/host.jsx /tmp/h.js && node -c /tmp/h.js`.

## Hard constraints learned (don't re-litigate)
- **ffmpeg is required** to read audio inside `.MOV/.MP4` (Chromium can't
  decode video-container audio). Multicam + best caption sync need it.
  Panel auto-detects common paths; Settings shows status.
- **Premiere can't be told to transcribe from a plugin.** User exports an
  SRT once (Window→Text→Transcribe→export); panel auto-finds it.
- **MOGRT animations can't render inside the panel** — only Premiere can.
  Preview = place one on the timeline (CP_previewMogrt). Built-in Animated
  engine is the previewable path.
- **CEP caches the panel** until Premiere fully quits — installer clears
  cache; always tell the user to Cmd+Q first and check the version badge.

## Open issues / next steps
1. **Custom MOGRT text not filling** for some templates → need the field
   name from the panel's "🔍 Inspect fields"; then map it in
   `CP_insertMogrtCaptions` KEYS. (Word-count for MOGRT now uses the editor
   stepper.)
2. **Multicam wrong angle on mic bleed** — `loudnessToRegions` uses a
   gate+margin; add a "stickiness"/sensitivity control and temporal
   smoothing.
3. **Caption sync is approximate** — SRT only has phrase times; we snap
   words to audio onsets. True per-word needs word-level timestamps (not in
   SRT). Consider a manual offset nudge.
4. Optionally bundle Hanken Grotesk + an ffmpeg binary for offline.
5. UXP port (CEP support is time-limited) — rewrite adapter layer only.

## User preferences (from the engagement)
- Wants Captions.ai / FireCut parity and a premium look; chose the dark
  "Studio" theme (clay accent). Values it "just working" with minimal manual
  steps and clear, discoverable UI. Prefers being told the honest limitation
  over silent failures.
