/*
 * CutPilot — panel controller.
 * Wires the UI to the analysis engines (js/) and the ExtendScript host (jsx/).
 */
(function () {
  'use strict';

  // ------------------------------------------------------------- state ----
  var state = {
    clip: null,          // selected clip info from host
    silencesMedia: [],   // refined silences, media-relative seconds
    silencesSeq: [],     // same, mapped to sequence time
    keepsMedia: [],      // keep segments, media-relative
    keepsSeq: [],        // keep segments, sequence time
    mediaDuration: 0,
    srtCues: null,
    srtPath: null,
    mogrtPath: null,
    plan: null
  };

  var settings = loadSettings();

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem('cutpilot.settings')) || {}; }
    catch (e) { return {}; }
  }
  function saveSettings() {
    localStorage.setItem('cutpilot.settings', JSON.stringify(settings));
  }

  // ---------------------------------------------------------------- dom ----
  function $(id) { return document.getElementById(id); }

  function log(msg, cls) {
    var el = document.createElement('div');
    if (cls) el.className = cls;
    el.textContent = msg;
    $('log').appendChild(el);
    $('log').parentNode.scrollTop = 1e9;
  }

  function fmt(sec) {
    var m = Math.floor(sec / 60);
    var s = (sec - m * 60).toFixed(2);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // --------------------------------------------------------------- tabs ----
  var tabs = document.querySelectorAll('.tab');
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener('click', function () {
      document.querySelector('.tab.active').classList.remove('active');
      document.querySelector('.tab-page.active').classList.remove('active');
      this.classList.add('active');
      $('tab-' + this.dataset.tab).classList.add('active');
    });
  }

  // --------------------------------------------------------------- boot ----
  function boot() {
    $('set-ffmpeg').value = settings.ffmpegPath || '';
    $('set-dropframe').checked = !!settings.dropFrame;
    buildPresetSelect();

    if (!CPBridge.isCEP()) {
      $('env-status').textContent = 'browser preview (no Premiere)';
      $('env-status').className = 'env-status err';
      return;
    }
    CPBridge.callHost('CP_getEnv').then(function (env) {
      $('env-status').textContent = env.sequenceName + ' · ' + env.fps.toFixed(2) + ' fps';
      $('env-status').className = 'env-status ok';
    }).catch(function (e) {
      $('env-status').textContent = e.message;
      $('env-status').className = 'env-status err';
    });
  }

  // ---------------------------------------------------------- file pick ----
  function pickFile(title, exts) {
    if (window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx) {
      var r = window.cep.fs.showOpenDialogEx(false, false, title, null, exts);
      if (r && r.data && r.data.length) return r.data[0];
      return null;
    }
    var p = prompt(title + ' — enter full file path:');
    return p || null;
  }

  function writeTextFile(path, content) {
    var req = (typeof cep_node !== 'undefined' && cep_node.require) || window.require;
    var fs = req('fs');
    fs.writeFileSync(path, content, 'utf8');
  }

  function tempPath(name) {
    var req = (typeof cep_node !== 'undefined' && cep_node.require) || window.require;
    var os = req('os');
    var pathMod = req('path');
    return pathMod.join(os.tmpdir(), name);
  }

  // ============================================================ SILENCE ====
  $('btn-analyze').addEventListener('click', function () {
    var opts = {
      thresholdDb: parseFloat($('opt-threshold').value),
      minSilence: parseFloat($('opt-minsilence').value),
      padding: parseFloat($('opt-padding').value),
      minKeep: parseFloat($('opt-minkeep').value)
    };
    $('analyze-progress').classList.remove('hidden');
    $('analyze-progress').textContent = 'Reading selected clip…';

    CPBridge.callHost('CP_getSelectedClip').then(function (res) {
      state.clip = res.clip;
      $('analyze-progress').textContent = 'Analyzing audio… (this can take a moment)';

      if (settings.ffmpegPath) {
        return CPAudio.ffmpegDetect(state.clip.mediaPath, settings.ffmpegPath,
                                     opts.thresholdDb, Math.min(opts.minSilence, 0.3), CPSilence);
      }
      return CPAudio.webAudioDetect(state.clip.mediaPath, { thresholdDb: opts.thresholdDb }, CPSilence);
    }).then(function (det) {
      var clip = state.clip;
      state.mediaDuration = det.duration || clip.outPoint;

      var refined = CPSilence.refineSilences(det.silences, {
        minSilence: opts.minSilence,
        padding: opts.padding,
        totalDuration: state.mediaDuration
      });

      // Restrict to the portion of media actually used in the timeline.
      state.silencesMedia = [];
      for (var i = 0; i < refined.length; i++) {
        var s = Math.max(refined[i].start, clip.inPoint);
        var e = Math.min(refined[i].end, clip.outPoint);
        if (e > s) state.silencesMedia.push({ start: s, end: e });
      }

      state.silencesSeq = state.silencesMedia.map(function (r) {
        return { start: clip.seqStart + (r.start - clip.inPoint),
                 end: clip.seqStart + (r.end - clip.inPoint), keep: true };
      });

      var clipRangeSil = state.silencesMedia.map(function (r) {
        return { start: r.start - clip.inPoint, end: r.end - clip.inPoint };
      });
      var clipDur = clip.outPoint - clip.inPoint;
      state.keepsMedia = CPSilence.invertToKeep(clipRangeSil, clipDur, opts.minKeep)
        .map(function (k) { return { start: k.start + clip.inPoint, end: k.end + clip.inPoint }; });
      state.keepsSeq = state.keepsMedia.map(function (k) {
        return { start: clip.seqStart + (k.start - clip.inPoint),
                 end: clip.seqStart + (k.end - clip.inPoint) };
      });

      renderResults(clipDur);
      $('analyze-progress').classList.add('hidden');
      log('Analysis done: ' + state.silencesSeq.length + ' silences found.', 'ok');
    }).catch(function (e) {
      $('analyze-progress').classList.add('hidden');
      log('Analyze failed: ' + e.message, 'err');
    });
  });

  function selectedSilences() {
    return state.silencesSeq.filter(function (s) { return s.keep; })
      .map(function (s) { return { start: s.start, end: s.end }; });
  }

  function renderResults(clipDur) {
    var cut = CPSilence.totalDuration(selectedSilences());
    $('stats').innerHTML =
      'Clip length <b>' + fmt(clipDur) + '</b> · silences <b>' +
      state.silencesSeq.length + '</b> · time saved <b>' + fmt(cut) + '</b> (' +
      (clipDur ? Math.round(100 * cut / clipDur) : 0) + '%)';

    var list = $('silence-list');
    list.innerHTML = '';
    state.silencesSeq.forEach(function (s, i) {
      var item = document.createElement('div');
      item.className = 'seg-item';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = s.keep;
      cb.addEventListener('change', function () {
        s.keep = cb.checked;
        renderResults(clipDur);
      });
      item.appendChild(cb);
      var span = document.createElement('span');
      span.textContent = '#' + (i + 1) + '  ' + fmt(s.start) + ' → ' + fmt(s.end);
      item.appendChild(span);
      var dur = document.createElement('span');
      dur.className = 'dur';
      dur.textContent = (s.end - s.start).toFixed(2) + 's';
      item.appendChild(dur);
      list.appendChild(item);
    });
    $('results').classList.remove('hidden');
  }

  $('btn-markers').addEventListener('click', function () {
    CPBridge.callHost('CP_addMarkers', { ranges: selectedSilences(), label: 'Silence' })
      .then(function (r) { log('Added ' + r.created + ' preview markers.', 'ok'); })
      .catch(function (e) { log(e.message, 'err'); });
  });

  $('btn-clear-markers').addEventListener('click', function () {
    CPBridge.callHost('CP_clearCutPilotMarkers', { label: 'Silence' })
      .then(function (r) { log('Removed ' + r.removed + ' markers.', 'ok'); })
      .catch(function (e) { log(e.message, 'err'); });
  });

  $('btn-cut').addEventListener('click', function () {
    var ranges = selectedSilences();
    if (!ranges.length) return log('Nothing selected to cut.', 'err');
    if (!confirm('Cut ' + ranges.length + ' silent ranges in place?\n' +
                 'This edits the current sequence (QE razor + delete).')) return;
    CPBridge.callHost('CP_razorRipple', {
      ranges: ranges,
      closeGaps: $('opt-closegaps').checked,
      backup: $('opt-backup').checked,
      dropFrame: !!settings.dropFrame
    }).then(function (r) {
      log('Cut done: removed ' + r.removedClips + ' clip pieces, closed ' +
          r.closedGaps + ' gaps.', 'ok');
    }).catch(function (e) { log('Cut failed: ' + e.message, 'err'); });
  });

  $('btn-rebuild').addEventListener('click', function () {
    if (!state.clip) return log('Run an analysis first.', 'err');
    if (!state.keepsMedia.length) return log('No keep segments computed.', 'err');
    CPBridge.callHost('CP_rebuildTrimmed', {
      nodeId: state.clip.nodeId,
      keeps: state.keepsMedia,
      name: 'CutPilot · ' + state.clip.name
    }).then(function (r) {
      log('Built "' + r.sequence + '": ' + r.segmentsPlaced + ' segments, ' +
          fmt(r.finalDuration) + ' total.', 'ok');
    }).catch(function (e) { log('Rebuild failed: ' + e.message, 'err'); });
  });

  // =========================================================== MULTICAM ====
  $('btn-mc-plan').addEventListener('click', function () {
    if (!state.keepsSeq.length) {
      return log('Run a silence analysis first — the angle plan follows those cuts.', 'err');
    }
    var numAngles = parseInt($('mc-angles').value, 10);
    state.plan = CPMulticam.buildAnglePlan(state.keepsSeq, numAngles, {
      mode: $('mc-mode').value,
      holdCuts: parseInt($('mc-hold').value, 10),
      minSegmentForSwitch: parseFloat($('mc-minseg').value),
      seed: Date.now() & 0xffff
    });
    var stats = CPMulticam.planStats(state.plan, numAngles);

    var view = $('mc-plan-view');
    view.innerHTML = '';
    state.plan.forEach(function (p, i) {
      var item = document.createElement('div');
      item.className = 'seg-item';
      var chip = document.createElement('span');
      chip.className = 'angle-chip';
      chip.textContent = 'V' + (p.angle + 1);
      item.appendChild(chip);
      var span = document.createElement('span');
      span.textContent = '#' + (i + 1) + '  ' + fmt(p.start) + ' → ' + fmt(p.end);
      item.appendChild(span);
      view.appendChild(item);
    });
    view.classList.remove('hidden');
    $('btn-mc-apply').classList.remove('hidden');
    log('Plan: ' + stats.segments + ' segments, ' + stats.switches +
        ' switches (' + stats.perAngle.join('/') + ' per angle).', 'ok');
  });

  $('btn-mc-apply').addEventListener('click', function () {
    if (!state.plan) return;
    CPBridge.callHost('CP_applyMulticamPlan', {
      plan: state.plan,
      numAngles: parseInt($('mc-angles').value, 10)
    }).then(function (r) {
      log('Multicam applied: toggled ' + r.toggled + ' clips across ' +
          r.tracksUsed + ' tracks.', 'ok');
    }).catch(function (e) { log('Multicam failed: ' + e.message, 'err'); });
  });

  // =========================================================== CAPTIONS ====
  function buildPresetSelect() {
    var sel = $('cap-preset');
    CPCaptions.STYLE_PRESETS.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', renderPresetCard);
    renderPresetCard();
  }

  function currentPreset() {
    return CPCaptions.getPreset($('cap-preset').value) || CPCaptions.STYLE_PRESETS[0];
  }

  function renderPresetCard() {
    var p = currentPreset();
    var card = $('preset-card');
    var sample = p.uppercase ? 'YOUR CAPTION' : 'Your caption';
    card.innerHTML = '';
    var prev = document.createElement('div');
    prev.className = 'preview';
    prev.textContent = sample;
    prev.style.color = p.fill;
    prev.style.fontFamily = (p.font || 'sans-serif') + ', ' + (p.fallbackFonts || []).join(', ');
    if (p.stroke && p.strokeWidth) {
      prev.style.textShadow =
        '-2px -2px 0 ' + p.stroke + ', 2px -2px 0 ' + p.stroke +
        ', -2px 2px 0 ' + p.stroke + ', 2px 2px 0 ' + p.stroke;
    }
    if (p.boxColor) {
      prev.style.background = p.boxColor;
      prev.style.borderRadius = (p.boxRadius || 8) + 'px';
    }
    if (p.glow) prev.style.textShadow = '0 0 12px ' + p.glow;
    card.appendChild(prev);
    var meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = p.description + ' — Font: ' + p.font + ' · Size: ' + p.fontSize +
      ' · Animation: ' + p.anim + ' (' + p.animNotes + ')';
    card.appendChild(meta);

    $('cap-words').value = p.wordsPerCue;
    $('cap-upper').checked = !!p.uppercase;
  }

  $('btn-load-srt').addEventListener('click', function () {
    var path = pickFile('Choose an SRT caption file', ['srt']);
    if (!path) return;
    try {
      var req = (typeof cep_node !== 'undefined' && cep_node.require) || window.require;
      var text = req('fs').readFileSync(path, 'utf8');
      state.srtCues = CPCaptions.parseSRT(text);
      state.srtPath = path;
      $('srt-status').textContent = state.srtCues.length + ' cues loaded';
      log('Loaded ' + state.srtCues.length + ' cues from ' + path, 'ok');
    } catch (e) {
      log('Could not read SRT: ' + e.message, 'err');
    }
  });

  function styledCues() {
    if (!state.srtCues) return null;
    var words = parseInt($('cap-words').value, 10);
    var upper = $('cap-upper').checked;
    var cues = state.srtCues;
    if (words > 0) {
      cues = CPCaptions.explodeWords(cues, { wordsPerCue: words, uppercase: upper });
    } else if (upper) {
      cues = cues.map(function (c) {
        return { start: c.start, end: c.end, text: c.text.toUpperCase() };
      });
    }
    return cues;
  }

  $('btn-cap-native').addEventListener('click', function () {
    var cues = styledCues();
    if (!cues) return log('Load an SRT first.', 'err');
    var preset = currentPreset();
    try {
      var out = tempPath('cutpilot-' + preset.id + '-' + Date.now() + '.srt');
      writeTextFile(out, CPCaptions.toSRT(cues));
      CPBridge.callHost('CP_importSrtCaptions', { srtPath: out }).then(function () {
        log('Caption track created (' + cues.length + ' cues, ' + preset.name + ' timing). ' +
            'Style the track once in Essential Graphics with: ' + preset.font + ' ' +
            preset.fontSize + 'px, fill ' + preset.fill +
            (preset.stroke ? ', stroke ' + preset.stroke : '') +
            ' — then save it as a Track Style to reuse.', 'ok');
      }).catch(function (e) { log(e.message, 'err'); });
    } catch (e) {
      log('Could not write styled SRT: ' + e.message, 'err');
    }
  });

  $('btn-mogrt-pick').addEventListener('click', function () {
    var path = pickFile('Choose a .mogrt text template', ['mogrt']);
    if (!path) return;
    state.mogrtPath = path;
    $('mogrt-status').textContent = path.split(/[\\/]/).pop();
  });

  $('btn-cap-mogrt').addEventListener('click', function () {
    var cues = styledCues();
    if (!cues) return log('Load an SRT first.', 'err');
    if (!state.mogrtPath) return log('Choose a .mogrt template first.', 'err');
    if (cues.length > 400 &&
        !confirm(cues.length + ' cues = ' + cues.length + ' graphics. Continue?')) return;
    CPBridge.callHost('CP_insertMogrtCaptions', {
      mogrtPath: state.mogrtPath,
      cues: cues,
      videoTrack: null,
      audioTrack: 0
    }).then(function (r) {
      log('Inserted ' + r.inserted + ' graphics, set text on ' + r.textSet + '.' +
          (r.failed ? ' Failed: ' + r.failed : ''), r.failed ? 'err' : 'ok');
    }).catch(function (e) { log(e.message, 'err'); });
  });

  // =========================================================== SETTINGS ====
  $('btn-ffmpeg-pick').addEventListener('click', function () {
    var path = pickFile('Locate the ffmpeg binary', []);
    if (path) $('set-ffmpeg').value = path;
  });

  $('btn-save-settings').addEventListener('click', function () {
    settings.ffmpegPath = $('set-ffmpeg').value.trim();
    settings.dropFrame = $('set-dropframe').checked;
    saveSettings();
    log('Settings saved.', 'ok');
  });

  boot();
})();
