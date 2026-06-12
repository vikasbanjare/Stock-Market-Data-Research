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
