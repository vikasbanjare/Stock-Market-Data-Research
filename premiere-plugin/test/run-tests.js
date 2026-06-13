/*
 * CutPilot — unit tests for the pure logic modules.
 * Run with: node test/run-tests.js
 */
'use strict';

const path = require('path');
const CPSilence = require(path.join(__dirname, '..', 'js', 'silence.js'));
const CPCaptions = require(path.join(__dirname, '..', 'js', 'captions.js'));
const CPMulticam = require(path.join(__dirname, '..', 'js', 'multicam.js'));

let passed = 0, failed = 0;

function assert(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function close(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// ------------------------------------------------------------- silence ----
console.log('silence.js');
{
  // Synthetic signal: 1s tone, 1s silence, 1s tone @ 1000 Hz sample rate
  const sr = 1000;
  const samples = new Float32Array(3 * sr);
  for (let i = 0; i < sr; i++) samples[i] = Math.sin(i * 0.3) * 0.5;
  for (let i = 2 * sr; i < 3 * sr; i++) samples[i] = Math.sin(i * 0.3) * 0.5;

  const raw = CPSilence.detectSilences(samples, sr, { thresholdDb: -40 });
  assert(raw.length >= 1, 'detects the silent middle second');
  const mid = raw.find(r => r.start > 0.8 && r.end < 2.2);
  assert(!!mid, 'silence is located around t=1..2 (got ' + JSON.stringify(raw) + ')');

  const refined = CPSilence.refineSilences(raw, { minSilence: 0.5, padding: 0.1, totalDuration: 3 });
  assert(refined.length === 1, 'refine keeps exactly one silence');
  assert(refined[0].start > mid.start && refined[0].end < mid.end, 'padding shrinks the silence inward');

  const merged = CPSilence.mergeRanges(
    [{ start: 0, end: 1 }, { start: 1.02, end: 2 }, { start: 5, end: 6 }], 0.05);
  assert(merged.length === 2, 'mergeRanges merges near-adjacent ranges');
  assert(close(merged[0].end, 2), 'merged range spans both inputs');

  const keeps = CPSilence.invertToKeep([{ start: 1, end: 2 }, { start: 4, end: 5 }], 6, 0.25);
  assert(keeps.length === 3, 'invertToKeep yields 3 keep segments');
  assert(close(keeps[0].start, 0) && close(keeps[0].end, 1), 'first keep is [0,1]');
  assert(close(keeps[2].start, 5) && close(keeps[2].end, 6), 'last keep is [5,6]');

  const tiny = CPSilence.invertToKeep([{ start: 0.1, end: 2 }, { start: 2.05, end: 5 }], 6, 0.25);
  assert(tiny.every(k => k.end - k.start >= 0.25), 'slivers below minKeep are dropped');

  assert(close(CPSilence.totalDuration(keeps), 4), 'totalDuration sums kept time');

  const ff = CPSilence.parseFfmpegSilences(
    '[silencedetect @ 0x1] silence_start: 1.5\n' +
    'frame= 100\n' +
    '[silencedetect @ 0x1] silence_end: 3.25 | silence_duration: 1.75\n' +
    '[silencedetect @ 0x1] silence_start: 10\n', 12);
  assert(ff.length === 2, 'ffmpeg parser finds both silences');
  assert(close(ff[0].start, 1.5) && close(ff[0].end, 3.25), 'ffmpeg range values parsed');
  assert(close(ff[1].end, 12), 'trailing open silence closed at media duration');
}

// ------------------------------------------------------------ captions ----
console.log('captions.js');
{
  const srt = '1\n00:00:01,000 --> 00:00:03,000\nHello brave new world\n\n' +
              '2\n00:00:04,500 --> 00:00:06,000\nSecond line\n';
  const cues = CPCaptions.parseSRT(srt);
  assert(cues.length === 2, 'parses two cues');
  assert(close(cues[0].start, 1) && close(cues[0].end, 3), 'cue 1 timing parsed');
  assert(cues[1].text === 'Second line', 'cue 2 text parsed');

  const roundtrip = CPCaptions.parseSRT(CPCaptions.toSRT(cues));
  assert(roundtrip.length === 2 && close(roundtrip[1].start, 4.5), 'SRT roundtrips');

  const words = CPCaptions.explodeWords([cues[0]], { wordsPerCue: 1, uppercase: true });
  assert(words.length === 4, 'explodes into 4 word cues');
  assert(words[0].text === 'HELLO', 'uppercase applied');
  assert(close(words[0].start, 1), 'first word starts at cue start');
  assert(close(words[3].end, 3), 'last word ends at cue end');
  for (let i = 1; i < words.length; i++) {
    assert(words[i].start >= words[i - 1].end - 1e-9, 'word cues do not overlap (' + i + ')');
  }

  const pairs = CPCaptions.explodeWords([cues[0]], { wordsPerCue: 2 });
  assert(pairs.length === 2 && pairs[0].text === 'Hello brave', 'wordsPerCue=2 groups words');

  // Remap: cue at 2..4 over keeps [0..3] and [5..8] → portion 2..3 stays
  const remapped = CPCaptions.remapCuesToKeeps(
    [{ start: 2, end: 4, text: 'x' }], [{ start: 0, end: 3 }, { start: 5, end: 8 }]);
  assert(remapped.length === 1, 'remap keeps overlapping cue');
  assert(close(remapped[0].start, 2) && close(remapped[0].end, 3), 'remap clips to keep segment');

  const dropped = CPCaptions.remapCuesToKeeps(
    [{ start: 3.2, end: 4.8, text: 'gone' }], [{ start: 0, end: 3 }, { start: 5, end: 8 }]);
  assert(dropped.length === 0, 'cue inside removed range is dropped');

  assert(CPCaptions.STYLE_PRESETS.length >= 6, 'at least 6 style presets');
  assert(CPCaptions.getPreset('hormozi').uppercase === true, 'hormozi preset is uppercase');
}

// ------------------------------------------------ animation planners ----
console.log('captions.js (animation engine)');
{
  const cue = [{ start: 0, end: 4, text: 'one two three four' }];

  const kar = CPCaptions.planKaraoke(cue, 2);
  assert(kar.length === 4, 'karaoke: one frame per spoken word');
  assert(JSON.stringify(kar[0].words) === '["one","two"]' && kar[0].active === 0,
         'karaoke: first frame shows phrase with word 1 active');
  assert(JSON.stringify(kar[1].words) === '["one","two"]' && kar[1].active === 1,
         'karaoke: second frame highlights word 2');
  assert(JSON.stringify(kar[2].words) === '["three","four"]' && kar[2].active === 0,
         'karaoke: next phrase starts fresh');
  assert(close(kar[0].start, 0) && close(kar[3].end, 4), 'karaoke: timing spans the cue');

  const tw = CPCaptions.planTypewriter(cue);
  assert(tw.length === 4, 'typewriter: one frame per word');
  assert(tw[0].text === 'one' && tw[2].text === 'one two three',
         'typewriter: words accumulate');
  assert(close(tw[3].end, 4), 'typewriter: last frame ends at cue end');

  assert(CPCaptions.ANIMATIONS.length >= 11, 'animation catalog has 11+ entries');
  assert(CPCaptions.getAnimation('karaoke').kind === 'framed', 'karaoke is a framed animation');
  assert(CPCaptions.getAnimation('nonsense').id === 'pop', 'unknown animation falls back to pop');
  assert(CPCaptions.PRESET_ANIM_MAP['color-sweep'] === 'karaoke', 'preset anim concepts map to engine ids');
  ['scale', 'wave', 'shake'].forEach(function (id) {
    assert(CPCaptions.getAnimation(id).id === id, 'new animation present: ' + id);
  });
}

// ----------------------------------------------------- style merge / fonts ----
console.log('captions.js (style customizer)');
{
  assert(CPCaptions.STYLE_PRESETS.length >= 9, '9+ style presets');
  assert(CPCaptions.FONTS.length >= 12 && CPCaptions.FONTS.indexOf('Montserrat') >= 0,
         'font catalog includes trending faces');

  const base = CPCaptions.getPreset('hormozi');
  const merged = CPCaptions.mergeStyle(base, {});
  assert(merged.font === base.font && merged.fontSize === base.fontSize,
         'empty overrides fall back to preset');

  const custom = CPCaptions.mergeStyle(base, {
    font: 'Oswald', fontSize: 120, fill: '#00ff00', stroke: '#111111',
    strokeWidth: 0, boxColor: '#222222', uppercase: false, yPct: 0.5
  });
  assert(custom.font === 'Oswald' && custom.fontSize === 120, 'font/size overrides win');
  assert(custom.fill === '#00ff00' && custom.boxColor === '#222222', 'color/box overrides win');
  assert(custom.strokeWidth === 0, 'strokeWidth 0 override is honored (not treated as falsy fallback)');
  assert(custom.uppercase === false && custom.yPct === 0.5, 'boolean/number overrides honored');

  const noBox = CPCaptions.mergeStyle(CPCaptions.getPreset('highlight-box'), { boxColor: null });
  assert(noBox.boxColor === null, 'explicit null boxColor removes the box');

  // render.styleForFrame scales and applies the same precedence
  const CPRender2 = require(path.join(__dirname, '..', 'js', 'render.js'));
  const sf = CPRender2.styleForFrame(base, 540, { fontSize: 100, boxColor: '#abcdef', strokeWidth: 0 });
  assert(sf.size === 50, 'styleForFrame scales font to frame height');
  assert(sf.boxColor === '#abcdef', 'styleForFrame honors boxColor override');
  assert(sf.strokeWidth === 0, 'styleForFrame honors strokeWidth 0 override');
}

// --------------------------------------------------------------- render ----
console.log('render.js (pure layout helpers)');
{
  const CPRender = require(path.join(__dirname, '..', 'js', 'render.js'));
  const measure = s => s.length * 10; // fake: 10px per character

  const lines = CPRender.wrapLines(['hello', 'brave', 'new', 'world'], 120, measure);
  assert(lines.length === 2, 'wrapLines breaks at max width');
  assert(lines[0].join(' ') === 'hello brave' && lines[1].join(' ') === 'new world',
         'wrapLines keeps word order');
  assert(lines.flat().join(' ') === 'hello brave new world', 'wrapLines loses no words');

  const one = CPRender.wrapLines(['supercalifragilistic'], 50, measure);
  assert(one.length === 1, 'oversized single word still gets its own line');

  const preset = CPCaptions.getPreset('hormozi');
  const full = CPRender.styleForFrame(preset, 1080, {});
  const half = CPRender.styleForFrame(preset, 540, {});
  assert(full.size === preset.fontSize, 'style at 1080p uses native font size');
  assert(half.size === Math.round(preset.fontSize / 2), 'style scales with frame height');
  assert(CPRender.styleForFrame(preset, 1080, { fontSize: 120 }).size === 120,
         'fontSize override wins');
  assert(CPRender.styleForFrame(preset, 1080, { uppercase: false }).uppercase === false,
         'uppercase override wins over preset');
}

// ------------------------------------------------------------ multicam ----
console.log('multicam.js');
{
  const segs = [];
  for (let i = 0; i < 8; i++) segs.push({ start: i * 2, end: i * 2 + 1.5 });

  const rot = CPMulticam.buildAnglePlan(segs, 3, { mode: 'rotate' });
  assert(rot.length === 8, 'plan covers all segments');
  assert(rot[0].angle === 0 && rot[1].angle === 1 && rot[2].angle === 2 && rot[3].angle === 0,
         'rotate cycles 0,1,2,0');

  const pp = CPMulticam.buildAnglePlan(segs, 3, { mode: 'pingpong' });
  assert(pp.map(p => p.angle).join('') === '01210121', 'pingpong bounces between angles');

  const rnd = CPMulticam.buildAnglePlan(segs, 4, { mode: 'random', seed: 7 });
  let noRepeat = true;
  for (let i = 1; i < rnd.length; i++) if (rnd[i].angle === rnd[i - 1].angle) noRepeat = false;
  assert(noRepeat, 'random mode never repeats the previous angle');
  const rnd2 = CPMulticam.buildAnglePlan(segs, 4, { mode: 'random', seed: 7 });
  assert(JSON.stringify(rnd) === JSON.stringify(rnd2), 'random plans are reproducible per seed');

  const hold = CPMulticam.buildAnglePlan(segs, 2, { mode: 'rotate', holdCuts: 2 });
  assert(hold[0].angle === 0 && hold[1].angle === 0 && hold[2].angle === 1,
         'holdCuts=2 switches every second segment');

  const shortSegs = [{ start: 0, end: 5 }, { start: 5, end: 5.3 }, { start: 6, end: 10 }];
  const minSeg = CPMulticam.buildAnglePlan(shortSegs, 2, { mode: 'rotate', minSegmentForSwitch: 1 });
  assert(minSeg[1].angle === minSeg[0].angle, 'short segments keep the previous angle');

  const one = CPMulticam.buildAnglePlan(segs, 1, { mode: 'random' });
  assert(one.every(p => p.angle === 0), 'single angle never switches');

  const stats = CPMulticam.planStats(rot, 3);
  assert(stats.switches === 7 && stats.perAngle.reduce((a, b) => a + b) === 8,
         'planStats counts switches and per-angle totals');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
