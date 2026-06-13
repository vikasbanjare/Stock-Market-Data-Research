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

  /*
   * Segment a timeline into fixed-length chunks (no Smart Cut needed).
   * segmentsByInterval(30, 4) -> 8 segments of ~4s covering [0,30].
   */
  function segmentsByInterval(duration, interval) {
    var segs = [];
    if (!(duration > 0) || !(interval > 0)) return segs;
    var t = 0;
    while (t < duration - 1e-6) {
      segs.push({ start: t, end: Math.min(t + interval, duration) });
      t += interval;
    }
    return segs;
  }

  /*
   * Turn a list of boundary times (e.g. markers) into segments spanning
   * [0, duration]. Boundaries outside the range are ignored.
   */
  function segmentsFromBoundaries(bounds, duration) {
    var pts = [0];
    (bounds || []).forEach(function (b) { if (b > 1e-3 && b < duration - 1e-3) pts.push(b); });
    pts.push(duration);
    pts.sort(function (a, b) { return a - b; });
    var segs = [];
    for (var i = 0; i < pts.length - 1; i++) {
      if (pts[i + 1] - pts[i] > 1e-3) segs.push({ start: pts[i], end: pts[i + 1] });
    }
    return segs;
  }

  /*
   * FireCut-style "virtual director": cut to whoever is talking.
   * speakerRegions: array indexed by angle; each entry is that speaker's
   *   speech regions [{start,end}] in sequence time (angle i ↔ camera V(i+1)).
   * opts:
   *   step             sampling resolution in seconds (default 0.12)
   *   minSegment       shortest allowed shot; shorter ones merge back (default 1.2)
   *   wideAngle        angle to use when nobody / everybody talks (-1 = hold)
   *   wideOnSilence    use the wide angle during silence too (default false = hold)
   * Returns [{start,end,angle}] ready for CP_applyMulticamPlan.
   */
  function directorPlan(speakerRegions, duration, opts) {
    opts = opts || {};
    var step = opts.step || 0.12;
    var minSeg = opts.minSegment != null ? opts.minSegment : 1.2;
    var wide = (opts.wideAngle != null) ? opts.wideAngle : -1;
    var nA = speakerRegions.length;
    if (!(duration > 0) || nA === 0) return [];

    function activeAt(regions, t) {
      for (var i = 0; i < regions.length; i++) {
        if (t >= regions[i].start - 1e-6 && t < regions[i].end - 1e-6) return true;
      }
      return false;
    }

    var prev = (wide >= 0) ? wide : 0;
    var segs = [];
    for (var t = 0; t < duration - 1e-9; t += step) {
      var actives = [];
      for (var a = 0; a < nA; a++) if (activeAt(speakerRegions[a], t)) actives.push(a);
      var angle;
      if (actives.length === 1) angle = actives[0];
      else if (actives.length > 1) angle = (wide >= 0) ? wide : prev;
      else angle = (wide >= 0 && opts.wideOnSilence) ? wide : prev;
      prev = angle;
      var end = Math.min(duration, t + step);
      if (segs.length && segs[segs.length - 1].angle === angle) segs[segs.length - 1].end = end;
      else segs.push({ start: t, end: end, angle: angle });
    }

    // merge shots shorter than minSegment into the preceding shot
    var merged = [];
    for (var i = 0; i < segs.length; i++) {
      if (merged.length && (segs[i].end - segs[i].start) < minSeg) {
        merged[merged.length - 1].end = segs[i].end;
      } else {
        merged.push({ start: segs[i].start, end: segs[i].end, angle: segs[i].angle });
      }
    }
    // coalesce any now-adjacent equal angles
    var out = [];
    for (i = 0; i < merged.length; i++) {
      if (out.length && out[out.length - 1].angle === merged[i].angle) out[out.length - 1].end = merged[i].end;
      else out.push(merged[i]);
    }
    return out;
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
    segmentsByInterval: segmentsByInterval,
    segmentsFromBoundaries: segmentsFromBoundaries,
    directorPlan: directorPlan,
    _mulberry32: mulberry32
  };
});
