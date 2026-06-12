/*
 * CutPilot — multicam angle planning.
 * Takes the keep-segments produced by silence detection and assigns a
 * camera angle to each one. The ExtendScript host then enables/disables
 * the stacked camera tracks per segment.
 * Pure functions, unit-testable in Node.
 */
(function (root, factory) {
  var lib = factory();
  // CEP panels with --enable-nodejs have BOTH `module` and `window` — register in both.
  if (typeof module === 'object' && module.exports) module.exports = lib;
  if (root) root.CPMulticam = lib;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* Deterministic PRNG so "random" plans are reproducible per seed. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /*
   * Build an angle plan.
   * segments: [{start, end}] in sequence time
   * numAngles: number of camera tracks (V1..Vn)
   * opts:
   *   mode: 'rotate' | 'pingpong' | 'random' | 'weighted'
   *   holdCuts: switch angle only every N segments (default 1)
   *   seed: PRNG seed for 'random'
   *   mainAngle / mainWeight: for 'weighted' — how often to return to the
   *     hero cam (e.g. wide shot 60% of the time)
   *   minSegmentForSwitch: segments shorter than this keep the previous
   *     angle (rapid-fire angle flips read as mistakes)
   * Returns [{start, end, angle}] with angle as 0-based track index.
   */
  function buildAnglePlan(segments, numAngles, opts) {
    opts = opts || {};
    if (numAngles < 1) numAngles = 1;
    var mode = opts.mode || 'rotate';
    var hold = Math.max(1, opts.holdCuts || 1);
    var minSeg = opts.minSegmentForSwitch || 0;
    var rand = mulberry32(opts.seed != null ? opts.seed : 42);
    var mainAngle = opts.mainAngle || 0;
    var mainWeight = opts.mainWeight != null ? opts.mainWeight : 0.5;

    var plan = [];
    var angle = mode === 'weighted' ? mainAngle : 0;
    var direction = 1; // for pingpong
    var switchCount = 0;

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var wantSwitch = i > 0 && (i % hold === 0) && (seg.end - seg.start >= minSeg);

      if (wantSwitch && numAngles > 1) {
        switchCount++;
        if (mode === 'rotate') {
          angle = (angle + 1) % numAngles;
        } else if (mode === 'pingpong') {
          if (angle + direction >= numAngles || angle + direction < 0) direction = -direction;
          angle += direction;
        } else if (mode === 'random') {
          var next = Math.floor(rand() * (numAngles - 1));
          if (next >= angle) next++; // never repeat the same angle
          angle = next;
        } else if (mode === 'weighted') {
          if (angle !== mainAngle) {
            angle = mainAngle; // always come back to hero cam first
          } else if (rand() >= mainWeight) {
            var alt = Math.floor(rand() * (numAngles - 1));
            if (alt >= mainAngle) alt++;
            angle = alt;
          }
        }
      }
      plan.push({ start: seg.start, end: seg.end, angle: angle });
    }
    return plan;
  }

  /* Quick stats for the UI: how many cuts per angle. */
  function planStats(plan, numAngles) {
    var counts = [];
    for (var a = 0; a < numAngles; a++) counts.push(0);
    var switches = 0;
    for (var i = 0; i < plan.length; i++) {
      counts[plan[i].angle]++;
      if (i > 0 && plan[i].angle !== plan[i - 1].angle) switches++;
    }
    return { perAngle: counts, switches: switches, segments: plan.length };
  }

  return {
    buildAnglePlan: buildAnglePlan,
    planStats: planStats,
    _mulberry32: mulberry32
  };
});
