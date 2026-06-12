/*
 * CutPilot — caption tooling.
 * SRT parse/serialize, word-by-word "karaoke" exploding, and the style
 * preset catalog used by both the native-caption and MOGRT pipelines.
 * Pure functions, unit-testable in Node.
 */
(function (root, factory) {
  var lib = factory();
  // CEP panels with --enable-nodejs have BOTH `module` and `window` — register in both.
  if (typeof module === 'object' && module.exports) module.exports = lib;
  if (root) root.CPCaptions = lib;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* "00:01:02,345" -> seconds */
  function srtTimeToSeconds(t) {
    var m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t.trim());
    if (!m) return 0;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
  }

  function secondsToSrtTime(sec) {
    if (sec < 0) sec = 0;
    var ms = Math.round(sec * 1000);
    var h = Math.floor(ms / 3600000); ms -= h * 3600000;
    var min = Math.floor(ms / 60000); ms -= min * 60000;
    var s = Math.floor(ms / 1000); ms -= s * 1000;
    function p(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
    return p(h, 2) + ':' + p(min, 2) + ':' + p(s, 2) + ',' + p(ms, 3);
  }

  /* Parse SRT text into [{start, end, text}] */
  function parseSRT(text) {
    var blocks = text.replace(/\r/g, '').split(/\n\n+/);
    var cues = [];
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split('\n').filter(function (l) { return l.trim() !== ''; });
      if (!lines.length) continue;
      if (/^\d+$/.test(lines[0].trim())) lines.shift(); // optional index line
      if (!lines.length) continue;
      var tm = /([\d:,.]+)\s*-->\s*([\d:,.]+)/.exec(lines[0]);
      if (!tm) continue;
      cues.push({
        start: srtTimeToSeconds(tm[1]),
        end: srtTimeToSeconds(tm[2]),
        text: lines.slice(1).join('\n').trim()
      });
    }
    return cues;
  }

  function toSRT(cues) {
    var out = [];
    for (var i = 0; i < cues.length; i++) {
      out.push(String(i + 1));
      out.push(secondsToSrtTime(cues[i].start) + ' --> ' + secondsToSrtTime(cues[i].end));
      out.push(cues[i].text);
      out.push('');
    }
    return out.join('\n');
  }

  /*
   * Explode sentence-level cues into word-by-word (or N-words-per-cue) cues
   * with timing interpolated by word length. This is what turns plain
   * captions into the trending "karaoke pop" style using Premiere's own
   * caption engine — no MOGRT required.
   * opts: { wordsPerCue (default 1), uppercase (default false), minCueDur }
   */
  function explodeWords(cues, opts) {
    opts = opts || {};
    var per = Math.max(1, opts.wordsPerCue || 1);
    var minDur = opts.minCueDur != null ? opts.minCueDur : 0.08;
    var out = [];
    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i];
      var words = cue.text.replace(/\s+/g, ' ').trim().split(' ');
      if (!words.length || words[0] === '') continue;

      var groups = [];
      for (var g = 0; g < words.length; g += per) {
        groups.push(words.slice(g, g + per).join(' '));
      }
      // Weight timing by character count so long words get more screen time.
      var weights = [], totalW = 0;
      for (var w = 0; w < groups.length; w++) {
        var weight = Math.max(2, groups[w].replace(/\s/g, '').length);
        weights.push(weight);
        totalW += weight;
      }
      var dur = cue.end - cue.start;
      var t = cue.start;
      for (var k = 0; k < groups.length; k++) {
        var d = Math.max(minDur, dur * weights[k] / totalW);
        var end = (k === groups.length - 1) ? cue.end : Math.min(cue.end, t + d);
        var txt = opts.uppercase ? groups[k].toUpperCase() : groups[k];
        out.push({ start: t, end: end, text: txt });
        t = end;
      }
    }
    return out;
  }

  /*
   * Shift cue timings to follow silence removal: given keep-segments in
   * source time, remap each cue into the trimmed timeline. Cues that fall
   * entirely inside removed ranges are dropped.
   */
  function remapCuesToKeeps(cues, keeps) {
    var out = [];
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i];
      var offset = 0; // accumulated kept duration before current segment
      for (var k = 0; k < keeps.length; k++) {
        var seg = keeps[k];
        var s = Math.max(c.start, seg.start);
        var e = Math.min(c.end, seg.end);
        if (e > s) {
          out.push({
            start: offset + (s - seg.start),
            end: offset + (e - seg.start),
            text: c.text
          });
          break; // keep the first overlapping segment's portion
        }
        offset += seg.end - seg.start;
      }
    }
    return out;
  }

  /*
   * Style presets — the catalog the panel UI shows. Each preset carries:
   *  - native:  recommended settings for Premiere's built-in caption styling
   *  - mogrt:   parameter hints applied when inserting a .mogrt per cue
   *  - anim:    the animation concept (used by MOGRT templates / docs)
   * Based on 2026 short-form trends: word-by-word karaoke, Hormozi bold,
   * highlight-box, clean minimal, neon, typewriter.
   */
  var STYLE_PRESETS = [
    {
      id: 'hormozi',
      name: 'Hormozi Bold',
      description: 'ALL-CAPS word-by-word, heavy condensed sans, thick black stroke, yellow highlight on keywords. The dominant short-form style.',
      font: 'Montserrat Black', fallbackFonts: ['Anton', 'Bebas Neue', 'Arial Black'],
      fontSize: 90, fill: '#FFFFFF', highlight: '#FFD400', stroke: '#000000', strokeWidth: 12,
      uppercase: true, wordsPerCue: 1, anim: 'pop-scale',
      animNotes: 'Each word scales 0%→110%→100% over ~120ms with ease-out.'
    },
    {
      id: 'karaoke',
      name: 'Karaoke Highlight',
      description: 'Full phrase visible, the spoken word lights up in a highlight color as it is said. Best retention for educational content (~+15% engagement).',
      font: 'Poppins SemiBold', fallbackFonts: ['Inter', 'Arial'],
      fontSize: 70, fill: '#FFFFFF', highlight: '#00E676', stroke: '#000000', strokeWidth: 8,
      uppercase: false, wordsPerCue: 3, anim: 'color-sweep',
      animNotes: 'Active word fill animates white→highlight; others stay white.'
    },
    {
      id: 'highlight-box',
      name: 'Highlight Box',
      description: 'Words sit on a solid rounded box that snaps from word to word (Submagic/CapCut style).',
      font: 'Inter Bold', fallbackFonts: ['Helvetica', 'Arial'],
      fontSize: 64, fill: '#FFFFFF', highlight: '#FF3B6B', stroke: null, strokeWidth: 0,
      boxColor: '#FF3B6B', boxRadius: 12,
      uppercase: false, wordsPerCue: 2, anim: 'box-snap',
      animNotes: 'Background box width-animates to each new word in ~80ms.'
    },
    {
      id: 'minimal',
      name: 'Clean Minimal',
      description: 'Lower-third sentence captions, soft shadow, no gimmicks. For long-form YouTube and corporate.',
      font: 'Inter Medium', fallbackFonts: ['Helvetica Neue', 'Arial'],
      fontSize: 48, fill: '#FFFFFF', highlight: null, stroke: '#000000', strokeWidth: 3,
      uppercase: false, wordsPerCue: 0 /* keep full sentences */, anim: 'fade',
      animNotes: 'Simple 150ms opacity fade in/out.'
    },
    {
      id: 'neon',
      name: 'Neon Pop',
      description: 'Glowing neon text with chromatic flicker on entry. Gaming / music content.',
      font: 'Bebas Neue', fallbackFonts: ['Anton', 'Impact'],
      fontSize: 80, fill: '#F8F8FF', highlight: '#00F0FF', stroke: '#7B2FFF', strokeWidth: 6,
      glow: '#00F0FF',
      uppercase: true, wordsPerCue: 1, anim: 'glitch-in',
      animNotes: '2-frame RGB-split glitch on entry, outer glow pulses with audio.'
    },
    {
      id: 'typewriter',
      name: 'Typewriter',
      description: 'Characters type on with a blinking caret. Storytelling and documentary openers.',
      font: 'JetBrains Mono', fallbackFonts: ['Courier New'],
      fontSize: 54, fill: '#EAEAEA', highlight: null, stroke: null, strokeWidth: 0,
      uppercase: false, wordsPerCue: 0, anim: 'typewriter',
      animNotes: 'Per-character reveal at ~30 chars/sec with caret.'
    }
  ];

  function getPreset(id) {
    for (var i = 0; i < STYLE_PRESETS.length; i++) {
      if (STYLE_PRESETS[i].id === id) return STYLE_PRESETS[i];
    }
    return null;
  }

  return {
    srtTimeToSeconds: srtTimeToSeconds,
    secondsToSrtTime: secondsToSrtTime,
    parseSRT: parseSRT,
    toSRT: toSRT,
    explodeWords: explodeWords,
    remapCuesToKeeps: remapCuesToKeeps,
    STYLE_PRESETS: STYLE_PRESETS,
    getPreset: getPreset
  };
});
