/*
 * CutPilot — panel controller (v0.2, automated flow).
 * Captions: auto-found transcripts → visual style + animation pickers →
 * one button. The built-in render engine draws every caption frame to a
 * transparent PNG and the host keyframes the entry animation — no MOGRTs,
 * no manual files. SRT management lives under Advanced.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------- state ----
  var state = {
    env: null,
    clip: null,
    silencesSeq: [],
    keepsMedia: [],
    keepsSeq: [],
    plan: null,
    sources: [],        // transcript candidates
    sourceIdx: -1,
    presetId: 'hormozi',
    animId: 'pop',
    mcMode: 'rotate'
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

  var toastTimer = null;
  function toast(msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 4500);
    log(msg, isErr ? 'err' : 'ok');
  }

  function fmt(sec) {
    var m = Math.floor(sec / 60);
    var s = (sec - m * 60).toFixed(2);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function nodeReq(mod) {
    var req = (typeof cep_node !== 'undefined' && cep_node.require) || window.require;
    return req(mod);
  }

  function pickFile(title, exts) {
    if (window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx) {
      var r = window.cep.fs.showOpenDialogEx(false, false, title, null, exts);
      if (r && r.data && r.data.length) return r.data[0];
      return null;
    }
    return prompt(title + ' — enter full file path:') || null;
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
    buildStyleRail();
    buildAnimRail();
    updateEngineBadge();

    if (!CPBridge.isCEP()) {
      $('env-status').textContent = 'browser preview';
      $('env-status').className = 'env-status err';
      renderSources();
      return;
    }
    CPBridge.callHost('CP_getEnv').then(function (env) {
      state.env = env;
      $('env-status').textContent = env.sequenceName + ' · ' + env.width + '×' + env.height;
      $('env-status').className = 'env-status ok';
    }).catch(function (e) {
      $('env-status').textContent = e.message;
      $('env-status').className = 'env-status err';
    });
    scanTranscripts();
  }

  // ================================================== TRANSCRIPT FINDER ====
  function listCaptionFilesIn(dir, sub) {
    var out = [];
    try {
      var fs = nodeReq('fs');
      var pathMod = nodeReq('path');
      var names = fs.readdirSync(dir);
      for (var i = 0; i < names.length; i++) {
        if (/\.(srt|vtt)$/i.test(names[i])) {
          var full = pathMod.join(dir, names[i]);
          var mtime = 0;
          try { mtime = fs.statSync(full).mtimeMs; } catch (eS) {}
          out.push({ label: names[i], sub: sub, path: full, mtime: mtime });
        }
      }
    } catch (e) {}
    return out;
  }

  function scanTranscripts() {
    $('tr-badge').textContent = 'searching…';
    $('tr-badge').className = 'badge';
    var found = [];
    var seen = {};
    function add(src) {
      var key = (src.path || '').toLowerCase();
      if (key && seen[key]) return;
      seen[key] = true;
      found.push(src);
    }

    var pathMod = null;
    try { pathMod = nodeReq('path'); } catch (e) {}

    CPBridge.callHost('CP_findProjectSrts').then(function (r) {
      (r.items || []).forEach(function (it) {
        add({ label: it.name, sub: 'already in your project', path: it.path, mtime: 1e15 });
      });
      return CPBridge.callHost('CP_getSelectedClip').catch(function () { return null; });
    }).then(function (sel) {
      if (sel && sel.clip && sel.clip.mediaPath && pathMod) {
        var dir = pathMod.dirname(sel.clip.mediaPath);
        var base = pathMod.basename(sel.clip.mediaPath).replace(/\.[^.]+$/, '').toLowerCase();
        listCaptionFilesIn(dir, 'next to your footage').forEach(function (s) {
          if (s.label.toLowerCase().indexOf(base) === 0) s.mtime += 1e14; // same name first
          add(s);
        });
      }
      return CPBridge.callHost('CP_getProjectInfo').catch(function () { return null; });
    }).then(function (proj) {
      if (proj && proj.path && pathMod) {
        listCaptionFilesIn(pathMod.dirname(proj.path), 'next to your project').forEach(add);
      }
      found.sort(function (a, b) { return b.mtime - a.mtime; });
      state.sources = found;
      state.sourceIdx = found.length ? 0 : -1;
      renderSources();
    }).catch(function () {
      state.sources = [];
      state.sourceIdx = -1;
      renderSources();
    });
  }

  function renderSources() {
    var box = $('tr-sources');
    box.innerHTML = '';
    if (!state.sources.length) {
      $('tr-badge').textContent = 'none found yet';
      $('tr-badge').className = 'badge warn';
      var empty = document.createElement('div');
      empty.className = 'source-empty';
      empty.textContent = 'No transcript found. Premiere can make one for you — tap "How do I make one?" (takes ~1 minute), or choose a file.';
      box.appendChild(empty);
      return;
    }
    $('tr-badge').textContent = state.sources.length + ' found';
    $('tr-badge').className = 'badge ok';
    state.sources.forEach(function (src, i) {
      var el = document.createElement('div');
      el.className = 'source-item' + (i === state.sourceIdx ? ' on' : '');
      el.innerHTML =
        '<span class="src-ico">📄</span>' +
        '<span><div class="src-name"></div><div class="src-sub"></div></span>' +
        '<span class="src-check">✓</span>';
      el.querySelector('.src-name').textContent = src.label;
      el.querySelector('.src-sub').textContent = src.sub;
      el.addEventListener('click', function () {
        state.sourceIdx = i;
        renderSources();
      });
      box.appendChild(el);
    });
  }

  $('btn-tr-rescan').addEventListener('click', scanTranscripts);
  $('btn-tr-help').addEventListener('click', function () {
    $('tr-help').classList.toggle('hidden');
  });
  $('btn-tr-manual').addEventListener('click', function () {
    var p = pickFile('Choose a caption file (.srt / .vtt)', ['srt', 'vtt']);
    if (!p) return;
    state.sources.unshift({ label: p.split(/[\\/]/).pop(), sub: 'chosen by you', path: p, mtime: 1e16 });
    state.sourceIdx = 0;
    renderSources();
  });

  // ======================================================= STYLE PICKER ====
  function buildStyleRail() {
    var rail = $('style-rail');
    CPCaptions.STYLE_PRESETS.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'style-card' + (p.id === state.presetId ? ' on' : '');
      card.dataset.id = p.id;

      var demo = document.createElement('div');
      demo.className = 'demo';
      var word = document.createElement('span');
      var animId = CPCaptions.PRESET_ANIM_MAP[p.anim] || 'pop';
      var animDef = CPCaptions.getAnimation(animId);
      if (animDef.demo) word.className = animDef.demo;
      word.textContent = p.uppercase ? 'POP' : 'Pop';
      word.style.color = p.fill;
      word.style.fontFamily = '"' + p.font + '", ' + (p.fallbackFonts || []).join(', ') + ', sans-serif';
      if (p.stroke && p.strokeWidth) {
        word.style.textShadow =
          '-2px -2px 0 ' + p.stroke + ', 2px -2px 0 ' + p.stroke +
          ', -2px 2px 0 ' + p.stroke + ', 2px 2px 0 ' + p.stroke;
      }
      if (p.boxColor) { word.style.background = p.boxColor; word.style.padding = '2px 8px'; word.style.borderRadius = '6px'; }
      if (p.glow) word.style.textShadow = '0 0 10px ' + p.glow;
      if (animId === 'karaoke' && p.highlight) word.style.setProperty('--sweep', p.highlight);
      if (p.glow) word.style.setProperty('--glow', p.glow);
      demo.appendChild(word);
      card.appendChild(demo);

      var name = document.createElement('div');
      name.className = 's-name';
      name.textContent = p.name;
      card.appendChild(name);
      var sub = document.createElement('div');
      sub.className = 's-sub';
      sub.textContent = p.font;
      card.appendChild(sub);

      card.addEventListener('click', function () {
        state.presetId = p.id;
        var on = rail.querySelector('.style-card.on');
        if (on) on.classList.remove('on');
        card.classList.add('on');
        // preset carries its own defaults; user can still override below
        $('cap-words').value = p.wordsPerCue;
        $('cap-upper').checked = !!p.uppercase;
        selectAnim(animId);
      });
      rail.appendChild(card);
    });
  }

  function buildAnimRail() {
    var rail = $('anim-rail');
    CPCaptions.ANIMATIONS.forEach(function (a) {
      var chip = document.createElement('button');
      chip.className = 'anim-chip' + (a.id === state.animId ? ' on' : '');
      chip.dataset.id = a.id;
      chip.textContent = a.name;
      chip.title = a.description;
      chip.addEventListener('click', function () { selectAnim(a.id); });
      rail.appendChild(chip);
    });
  }

  function selectAnim(id) {
    state.animId = id;
    var chips = document.querySelectorAll('.anim-chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('on', chips[i].dataset.id === id);
    }
  }

  function updateEngineBadge() {
    var b = $('engine-badge');
    b.textContent = $('cap-engine').value === 'native' ? 'native captions' : 'built-in engine';
    b.className = 'badge ok';
  }
  $('cap-engine').addEventListener('change', updateEngineBadge);

  function currentPreset() {
    return CPCaptions.getPreset(state.presetId) || CPCaptions.STYLE_PRESETS[0];
  }

  // ===================================================== ADD CAPTIONS ====
  function readSelectedTranscript() {
    if (state.sourceIdx < 0) throw new Error('No transcript yet — hit Rescan or "How do I make one?"');
    var src = state.sources[state.sourceIdx];
    var text = nodeReq('fs').readFileSync(src.path, 'utf8');
    var cues = CPCaptions.parseSRT(text);
    if (!cues.length) throw new Error('No captions found inside ' + src.label);
    return cues;
  }

  function capProgress(msg) {
    var el = $('cap-progress');
    if (msg == null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = msg;
  }

  $('btn-magic').addEventListener('click', function () {
    var cues;
    try { cues = readSelectedTranscript(); }
    catch (e) { return toast(e.message, true); }

    var preset = currentPreset();
    var words = parseInt($('cap-words').value, 10) || 0;
    var upper = $('cap-upper').checked;

    if ($('cap-engine').value === 'native') {
      var ncues = words > 0
        ? CPCaptions.explodeWords(cues, { wordsPerCue: words, uppercase: upper })
        : (upper ? cues.map(function (c) { return { start: c.start, end: c.end, text: c.text.toUpperCase() }; }) : cues);
      try {
        var pathMod = nodeReq('path');
        var out = pathMod.join(nodeReq('os').tmpdir(), 'cutpilot-' + Date.now() + '.srt');
        nodeReq('fs').writeFileSync(out, CPCaptions.toSRT(ncues), 'utf8');
        capProgress('Creating caption track');
        CPBridge.callHost('CP_importSrtCaptions', { srtPath: out }).then(function () {
          capProgress(null);
          toast('✓ Caption track added (' + ncues.length + ' cues). Style it once in Essential Graphics: ' +
                preset.font + ' ' + preset.fontSize + 'px, ' + preset.fill +
                (preset.stroke ? ' + stroke ' + preset.stroke : ''));
        }).catch(function (e) { capProgress(null); toast(e.message, true); });
      } catch (e) { capProgress(null); toast(e.message, true); }
      return;
    }

    // ---- built-in animated engine ----
    if (!state.env) return toast('Open a sequence in Premiere first.', true);
    var anim = state.animId;
    var frames;
    if (anim === 'karaoke') {
      frames = CPCaptions.planKaraoke(cues, Math.max(2, words || 3));
    } else if (anim === 'typewriter') {
      frames = CPCaptions.planTypewriter(cues);
    } else if (words > 0) {
      frames = CPCaptions.explodeWords(cues, { wordsPerCue: words });
    } else {
      frames = cues.map(function (c) { return { start: c.start, end: c.end, text: c.text }; });
    }
    if (frames.length > 1500 &&
        !confirm(frames.length + ' caption frames will be rendered — that can take a few minutes. Continue?')) return;

    var sizeOverride = parseInt($('cap-size').value, 10) || 0;
    var outDir;
    try {
      var pm = nodeReq('path');
      outDir = pm.join(nodeReq('os').tmpdir(), 'cutpilot-frames-' + Date.now());
    } catch (e) { return toast('Node unavailable: ' + e.message, true); }

    $('btn-magic').disabled = true;
    capProgress('Rendering 0 / ' + frames.length);
    CPRender.renderFrames(frames, {
      width: state.env.width || 1920,
      height: state.env.height || 1080,
      preset: preset,
      overrides: {
        uppercase: upper,
        fontSize: sizeOverride || null,
        yPct: (parseInt($('cap-ypos').value, 10) || 76) / 100
      },
      outDir: outDir,
      onProgress: function (done, total) { capProgress('Rendering ' + done + ' / ' + total); }
    }).then(function (items) {
      capProgress('Placing ' + items.length + ' captions in your timeline');
      return CPBridge.callHost('CP_placeCaptionImages', { items: items, anim: anim });
    }).then(function (r) {
      $('btn-magic').disabled = false;
      capProgress(null);
      toast('🎉 ' + r.placed + ' captions added on V' + r.track +
            (r.animated ? ' with ' + CPCaptions.getAnimation(anim).name + ' animation' : ''));
    }).catch(function (e) {
      $('btn-magic').disabled = false;
      capProgress(null);
      toast('Captions failed: ' + e.message, true);
    });
  });

  // ========================================================== SMART CUT ====
  function selectedSilences() {
    return state.silencesSeq.filter(function (s) { return s.keep; })
      .map(function (s) { return { start: s.start, end: s.end }; });
  }

  $('btn-analyze').addEventListener('click', function () {
    var opts = {
      thresholdDb: parseFloat($('opt-threshold').value),
      minSilence: parseFloat($('opt-minsilence').value),
      padding: parseFloat($('opt-padding').value),
      minKeep: parseFloat($('opt-minkeep').value)
    };
    var prog = $('analyze-progress');
    prog.classList.remove('hidden');
    prog.textContent = 'Reading selected clip';

    CPBridge.callHost('CP_getSelectedClip').then(function (res) {
      state.clip = res.clip;
      $('clip-badge').textContent = res.clip.name;
      $('clip-badge').className = 'badge ok';
      prog.textContent = 'Listening for silences';
      if (settings.ffmpegPath) {
        return CPAudio.ffmpegDetect(state.clip.mediaPath, settings.ffmpegPath,
                                     opts.thresholdDb, Math.min(opts.minSilence, 0.3), CPSilence);
      }
      return CPAudio.webAudioDetect(state.clip.mediaPath, { thresholdDb: opts.thresholdDb }, CPSilence);
    }).then(function (det) {
      var clip = state.clip;
      var mediaDuration = det.duration || clip.outPoint;
      var refined = CPSilence.refineSilences(det.silences, {
        minSilence: opts.minSilence,
        padding: opts.padding,
        totalDuration: mediaDuration
      });

      var silencesMedia = [];
      for (var i = 0; i < refined.length; i++) {
        var s = Math.max(refined[i].start, clip.inPoint);
        var e = Math.min(refined[i].end, clip.outPoint);
        if (e > s) silencesMedia.push({ start: s, end: e });
      }
      state.silencesSeq = silencesMedia.map(function (r) {
        return { start: clip.seqStart + (r.start - clip.inPoint),
                 end: clip.seqStart + (r.end - clip.inPoint), keep: true };
      });

      var clipRangeSil = silencesMedia.map(function (r) {
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
      prog.classList.add('hidden');
      toast('Found ' + state.silencesSeq.length + ' silences.');
    }).catch(function (e) {
      prog.classList.add('hidden');
      toast('Analyze failed: ' + e.message, true);
    });
  });

  function renderResults(clipDur) {
    var cut = CPSilence.totalDuration(selectedSilences());
    $('stats').innerHTML =
      'Removing <b>' + fmt(cut) + '</b> of dead air — that\'s <b>' +
      (clipDur ? Math.round(100 * cut / clipDur) : 0) + '%</b> of your clip';

    var list = $('silence-list');
    list.innerHTML = '';
    state.silencesSeq.forEach(function (s, i) {
      var item = document.createElement('div');
      item.className = 'seg-item';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = s.keep;
      cb.addEventListener('change', function () { s.keep = cb.checked; renderResults(clipDur); });
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
      .then(function (r) { toast('Added ' + r.created + ' preview markers.'); })
      .catch(function (e) { toast(e.message, true); });
  });

  $('btn-clear-markers').addEventListener('click', function () {
    CPBridge.callHost('CP_clearCutPilotMarkers', { label: 'Silence' })
      .then(function (r) { toast('Removed ' + r.removed + ' markers.'); })
      .catch(function (e) { toast(e.message, true); });
  });

  $('btn-rebuild').addEventListener('click', function () {
    if (!state.clip) return toast('Run the analysis first.', true);
    if (!state.keepsMedia.length) return toast('No keep segments computed.', true);
    CPBridge.callHost('CP_rebuildTrimmed', {
      nodeId: state.clip.nodeId,
      keeps: state.keepsMedia,
      name: 'CutPilot · ' + state.clip.name
    }).then(function (r) {
      toast('🎉 Built "' + r.sequence + '" — ' + r.segmentsPlaced + ' segments, ' + fmt(r.finalDuration) + ' long.');
    }).catch(function (e) { toast('Rebuild failed: ' + e.message, true); });
  });

  $('btn-cut').addEventListener('click', function () {
    var ranges = selectedSilences();
    if (!ranges.length) return toast('Nothing selected to cut.', true);
    if (!confirm('Cut ' + ranges.length + ' silent ranges directly in this sequence?')) return;
    CPBridge.callHost('CP_razorRipple', {
      ranges: ranges,
      closeGaps: $('opt-closegaps').checked,
      backup: $('opt-backup').checked,
      dropFrame: !!settings.dropFrame
    }).then(function (r) {
      toast('Cut done — removed ' + r.removedClips + ' pieces, closed ' + r.closedGaps + ' gaps.');
    }).catch(function (e) { toast('Cut failed: ' + e.message, true); });
  });

  // =========================================================== MULTICAM ====
  var mcButtons = document.querySelectorAll('#mc-mode button');
  for (var m = 0; m < mcButtons.length; m++) {
    mcButtons[m].addEventListener('click', function () {
      document.querySelector('#mc-mode button.on').classList.remove('on');
      this.classList.add('on');
      state.mcMode = this.dataset.mode;
    });
  }

  $('btn-mc-plan').addEventListener('click', function () {
    if (!state.keepsSeq.length) {
      return toast('Run Smart Cut first — angles switch at those cut points.', true);
    }
    var numAngles = parseInt($('mc-angles').value, 10);
    state.plan = CPMulticam.buildAnglePlan(state.keepsSeq, numAngles, {
      mode: state.mcMode,
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
    $('mc-plan-card').classList.remove('hidden');
    $('btn-mc-apply').classList.remove('hidden');
    toast(stats.segments + ' segments, ' + stats.switches + ' camera switches planned.');
  });

  $('btn-mc-apply').addEventListener('click', function () {
    if (!state.plan) return;
    CPBridge.callHost('CP_applyMulticamPlan', {
      plan: state.plan,
      numAngles: parseInt($('mc-angles').value, 10)
    }).then(function (r) {
      toast('🎬 Multicam applied — ' + r.toggled + ' clips toggled across ' + r.tracksUsed + ' tracks.');
    }).catch(function (e) { toast('Multicam failed: ' + e.message, true); });
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
    toast('Settings saved.');
  });

  boot();
})();
