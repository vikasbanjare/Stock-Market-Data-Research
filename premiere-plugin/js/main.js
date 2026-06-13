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
    transcript: null,        // { label, path } — the one chosen transcript
    presetId: 'hormozi',
    animId: 'pop',
    mcMode: 'rotate',
    tplSource: 'installed',  // installed | file
    installedMogrts: [],
    mogrtFile: null,
    // template library
    customTemplates: [],
    favs: {},
    recent: [],
    libCategory: 'All',
    libSearch: '',
    libSort: 'popular'
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
      // Re-check for a transcript when returning to Captions (e.g. after
      // exporting one), and refresh the preview now the frame has a size.
      if (this.dataset.tab === 'captions' && CPBridge.isCEP()) {
        if (!state.transcript) findTranscript();
        renderPreview();
      }
    });
  }

  // --------------------------------------------------------------- boot ----
  function boot() {
    $('set-ffmpeg').value = settings.ffmpegPath || '';
    $('set-dropframe').checked = !!settings.dropFrame;
    loadLibraryPrefs();
    buildFontSelect();
    buildAnimRail();
    wireCustomizer();
    wireTranscriptBar();
    wireAltMode();
    wireSubviews();
    buildLibrary();
    applyTemplate(currentPreset(), { silent: true });  // seeds controls + first preview

    if (!CPBridge.isCEP()) {
      $('env-status').textContent = 'browser preview';
      $('env-status').className = 'env-status err';
      setTranscriptBar('warn', '⚠️', 'Open this inside Premiere to find your transcript', 'How?');
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
    findTranscript();
  }

  // ===================================================== TRANSCRIPT (1-line) ==
  function listCaptionFilesIn(dir) {
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
          out.push({ label: names[i], path: full, mtime: mtime });
        }
      }
    } catch (e) {}
    return out;
  }

  function setTranscriptBar(cls, ico, text, btn) {
    $('tr-bar').className = 'tr-bar' + (cls ? ' ' + cls : '');
    $('tr-ico').textContent = ico;
    $('tr-text').textContent = text;
    var b = $('btn-tr-change');
    if (btn) { b.textContent = btn; b.classList.remove('hidden'); }
    else b.classList.add('hidden');
  }

  /* Find the single best transcript and confirm it in the bar. */
  function findTranscript() {
    setTranscriptBar('', '🔎', 'looking for your words…', null);
    var found = [];
    var seen = {};
    function add(s) {
      var k = (s.path || '').toLowerCase();
      if (!k || seen[k]) return; seen[k] = true; found.push(s);
    }
    var pathMod = null;
    try { pathMod = nodeReq('path'); } catch (e) {}

    CPBridge.callHost('CP_findProjectSrts').then(function (r) {
      (r.items || []).forEach(function (it) { add({ label: it.name, path: it.path, mtime: 1e15 }); });
      return CPBridge.callHost('CP_getSelectedClip').catch(function () { return null; });
    }).then(function (sel) {
      if (sel && sel.clip && sel.clip.mediaPath && pathMod) {
        var dir = pathMod.dirname(sel.clip.mediaPath);
        var base = pathMod.basename(sel.clip.mediaPath).replace(/\.[^.]+$/, '').toLowerCase();
        listCaptionFilesIn(dir).forEach(function (s) {
          if (s.label.toLowerCase().indexOf(base) === 0) s.mtime += 1e14;
          add(s);
        });
      }
      return CPBridge.callHost('CP_getProjectInfo').catch(function () { return null; });
    }).then(function (proj) {
      if (proj && proj.path && pathMod) listCaptionFilesIn(pathMod.dirname(proj.path)).forEach(add);
      found.sort(function (a, b) { return b.mtime - a.mtime; });
      if (found.length) {
        state.transcript = found[0];
        setTranscriptBar('ok', '✅', 'Using ' + found[0].label, 'Change');
      } else {
        state.transcript = null;
        setTranscriptBar('warn', '⚠️', 'No transcript found yet', 'Get one →');
      }
    }).catch(function () {
      state.transcript = null;
      setTranscriptBar('warn', '⚠️', 'No transcript found yet', 'Get one →');
    });
  }

  function wireTranscriptBar() {
    $('btn-tr-change').addEventListener('click', function () {
      if (state.transcript) {
        var p = pickFile('Choose a caption file (.srt / .vtt)', ['srt', 'vtt']);
        if (p) {
          state.transcript = { label: p.split(/[\\/]/).pop(), path: p, mtime: 1e16 };
          setTranscriptBar('ok', '✅', 'Using ' + state.transcript.label, 'Change');
        }
      } else {
        $('tr-help').classList.toggle('hidden');
      }
    });
    $('btn-tr-again').addEventListener('click', findTranscript);
    $('btn-tr-pick').addEventListener('click', function () {
      var p = pickFile('Choose a caption file (.srt / .vtt)', ['srt', 'vtt']);
      if (!p) return;
      state.transcript = { label: p.split(/[\\/]/).pop(), path: p, mtime: 1e16 };
      setTranscriptBar('ok', '✅', 'Using ' + state.transcript.label, 'Change');
      $('tr-help').classList.add('hidden');
    });
  }

  function readSelectedTranscript() {
    if (!state.transcript) throw new Error('No transcript yet — tap "Get one →" for the 1-minute steps.');
    var text = nodeReq('fs').readFileSync(state.transcript.path, 'utf8');
    var cues = CPCaptions.parseSRT(text);
    if (!cues.length) throw new Error('No captions found inside ' + state.transcript.label);
    return cues;
  }

  // ===================================================== TEMPLATE LIBRARY ====
  var LS = { fav: 'cutpilot.favs', recent: 'cutpilot.recent', custom: 'cutpilot.custom' };

  function loadLibraryPrefs() {
    try { state.favs = JSON.parse(localStorage.getItem(LS.fav)) || {}; } catch (e) { state.favs = {}; }
    try { state.recent = JSON.parse(localStorage.getItem(LS.recent)) || []; } catch (e2) { state.recent = []; }
    try { state.customTemplates = JSON.parse(localStorage.getItem(LS.custom)) || []; } catch (e3) { state.customTemplates = []; }
  }
  function saveFavs() { localStorage.setItem(LS.fav, JSON.stringify(state.favs)); }
  function saveRecent() { localStorage.setItem(LS.recent, JSON.stringify(state.recent.slice(0, 12))); }
  function saveCustom() { localStorage.setItem(LS.custom, JSON.stringify(state.customTemplates)); }

  /* All templates = built-ins + the user's saved custom ones. */
  function allTemplates() { return CPCaptions.TEMPLATES.concat(state.customTemplates); }

  function findTemplate(id) {
    var all = allTemplates();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return CPCaptions.TEMPLATES[0];
  }

  function currentPreset() { return findTemplate(state.presetId); }

  function buildLibrary() {
    // niche suggester
    var nsel = $('lib-niche');
    CPCaptions.NICHES.forEach(function (n) {
      var o = document.createElement('option'); o.value = n; o.textContent = n; nsel.appendChild(o);
    });
    nsel.addEventListener('change', function () {
      var id = CPCaptions.NICHE_RECOMMEND[this.value];
      if (id) { applyTemplate(findTemplate(id)); toast('Suggested "' + findTemplate(id).name + '" for ' + this.value + '.'); }
      this.value = '';
    });

    // category chips
    var cats = ['All', 'Favorites', 'Recent', 'My Templates'].concat(CPCaptions.CATEGORIES);
    var chipBox = $('lib-cats');
    cats.forEach(function (c) {
      var chip = document.createElement('button');
      chip.className = 'cat-chip' + (c === state.libCategory ? ' on' : '');
      chip.textContent = c;
      chip.addEventListener('click', function () {
        state.libCategory = c;
        var on = chipBox.querySelector('.cat-chip.on'); if (on) on.classList.remove('on');
        chip.classList.add('on');
        renderTemplateGrid();
      });
      chipBox.appendChild(chip);
    });

    $('lib-search').addEventListener('input', function () { state.libSearch = this.value.toLowerCase(); renderTemplateGrid(); });
    $('lib-sort').addEventListener('change', function () { state.libSort = this.value; renderTemplateGrid(); });
    $('btn-tpl-import').addEventListener('click', importTemplate);
    renderTemplateGrid();
  }

  function filteredTemplates() {
    var list = allTemplates().slice();
    var cat = state.libCategory;
    if (cat === 'Favorites') list = list.filter(function (t) { return state.favs[t.id]; });
    else if (cat === 'Recent') {
      list = state.recent.map(findTemplate).filter(Boolean);
    } else if (cat === 'My Templates') list = state.customTemplates.slice();
    else if (cat !== 'All') list = list.filter(function (t) { return t.category === cat; });

    if (state.libSearch) {
      var q = state.libSearch;
      list = list.filter(function (t) {
        return (t.name + ' ' + t.category + ' ' + t.font + ' ' + (t.anim || '')).toLowerCase().indexOf(q) >= 0;
      });
    }
    if (state.libSort === 'popular' && cat !== 'Recent') list.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    else if (state.libSort === 'az') list.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    else if (state.libSort === 'favorites') list.sort(function (a, b) { return (state.favs[b.id] ? 1 : 0) - (state.favs[a.id] ? 1 : 0); });
    return list;
  }

  function renderTemplateGrid() {
    var grid = $('tpl-grid');
    grid.innerHTML = '';
    var list = filteredTemplates();
    if (!list.length) {
      var e = document.createElement('div');
      e.className = 'lib-empty';
      e.textContent = state.libCategory === 'Favorites' ? 'No favorites yet — tap the ☆ on any template.'
        : state.libCategory === 'My Templates' ? 'No custom templates yet. Open a style, tweak it, and hit ＋ Save.'
        : 'No templates match your search.';
      grid.appendChild(e);
      return;
    }
    list.forEach(function (t) {
      grid.appendChild(buildTemplateCard(t));
    });
  }

  function buildTemplateCard(t) {
    var card = document.createElement('div');
    card.className = 'tpl-card' + (t.id === state.presetId ? ' on' : '');

    var thumb = document.createElement('div');
    thumb.className = 'tpl-thumb';
    var cap = document.createElement('div');
    cap.className = 't-cap';
    var animId = CPCaptions.animIdForConcept(t.anim);
    var def = CPCaptions.getAnimation(animId);
    // cards only loop the keyframed entrances; framed ones (karaoke/typewriter) just fade
    var demo = (def.kind === 'framed') ? 'anim-fade' : (def.demo || 'anim-fade');
    // a 2-word sample so keyword highlight is visible
    var w1 = t.uppercase ? 'BIG' : 'Big';
    var w2 = t.uppercase ? 'IDEA' : 'idea';
    cap.innerHTML = w1 + ' <span class="kwd">' + w2 + '</span>';
    cap.style.fontFamily = '"' + t.font + '", ' + (t.fallbackFonts || []).join(', ') + ', sans-serif';
    cap.style.color = t.fill;
    if (t.letterSpacing) cap.style.letterSpacing = t.letterSpacing + 'px';
    if (t.stroke && t.strokeWidth) {
      cap.style.textShadow = '-1.5px -1.5px 0 ' + t.stroke + ',1.5px -1.5px 0 ' + t.stroke +
        ',-1.5px 1.5px 0 ' + t.stroke + ',1.5px 1.5px 0 ' + t.stroke;
    }
    if (t.glow) cap.style.textShadow = '0 0 10px ' + t.glow;
    if (t.boxColor) { cap.style.background = t.boxColor; cap.style.padding = '2px 8px'; cap.style.borderRadius = '6px'; }
    var kwd = cap.querySelector('.kwd');
    kwd.style.color = t.highlight || t.fill;
    if (demo) cap.className = 't-cap ' + demo;
    thumb.appendChild(cap);

    var pop = document.createElement('span');
    pop.className = 'tpl-pop';
    pop.textContent = '🔥 ' + (t.popularity || 60);
    thumb.appendChild(pop);

    var fav = document.createElement('button');
    fav.className = 'tpl-fav' + (state.favs[t.id] ? ' on' : '');
    fav.textContent = state.favs[t.id] ? '★' : '☆';
    fav.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (state.favs[t.id]) delete state.favs[t.id]; else state.favs[t.id] = 1;
      saveFavs();
      fav.classList.toggle('on');
      fav.textContent = state.favs[t.id] ? '★' : '☆';
      if (state.libCategory === 'Favorites') renderTemplateGrid();
    });
    thumb.appendChild(fav);
    card.appendChild(thumb);

    var meta = document.createElement('div');
    meta.className = 'tpl-meta';
    var nm = document.createElement('span'); nm.className = 'tpl-name'; nm.textContent = t.name;
    var ct = document.createElement('span'); ct.className = 'tpl-cat'; ct.textContent = t.category;
    meta.appendChild(nm); meta.appendChild(ct);
    card.appendChild(meta);

    card.addEventListener('click', function () { applyTemplate(t); showView('editor'); });
    return card;
  }

  function trackRecent(id) {
    state.recent = [id].concat(state.recent.filter(function (x) { return x !== id; }));
    saveRecent();
  }

  // ----------------------------------------------------- editor controls ----
  function buildFontSelect() {
    var sel = $('c-font');
    CPCaptions.FONTS.forEach(function (f) {
      var o = document.createElement('option');
      o.value = f; o.textContent = f; o.style.fontFamily = '"' + f + '", sans-serif';
      sel.appendChild(o);
    });
  }

  function setFontValue(font) {
    var sel = $('c-font');
    var has = false;
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === font) has = true;
    if (!has) {
      var o = document.createElement('option');
      o.value = font; o.textContent = font;
      sel.insertBefore(o, sel.firstChild);
    }
    sel.value = font;
  }

  function toHex(c, fb) {
    return (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : (fb || '#ffffff');
  }

  /* Load a template into all customizer controls, refresh preview.
     opts.silent skips the recent-tracking + toast (used on boot). */
  function applyTemplate(p, opts) {
    opts = opts || {};
    state.presetId = p.id;
    $('editor-tpl-name').textContent = p.name;

    setFontValue(p.font);
    $('c-size').value = p.fontSize;
    $('c-pos').value = (p.layout === 'top') ? 18 : (p.layout === 'center') ? 50 : 76;
    setLayoutButton($('c-pos').value);
    $('c-fill').value = toHex(p.fill, '#ffffff');
    $('c-hl').value = toHex(p.highlight, '#ffd400');
    $('c-stroke').value = toHex(p.stroke, '#000000');
    $('c-strokew').value = p.strokeWidth || 0;
    $('c-box-on').checked = !!p.boxColor;
    $('c-box').value = toHex(p.boxColor, '#ff3b6b');
    $('c-upper').checked = !!p.uppercase;
    $('c-words').value = p.wordsPerCue;
    $('c-kw').checked = !!p.keyword;
    $('c-kw-mode-wrap').classList.toggle('hidden', !p.keyword);
    selectAnim(CPCaptions.animIdForConcept(p.anim));
    updateVals();
    renderPreview();

    if (!opts.silent) { trackRecent(p.id); toast('Applied "' + p.name + '". Tweak it below, then Add captions.'); }
  }

  function setLayoutButton(pos) {
    var btns = document.querySelectorAll('#c-layout button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].dataset.pos === String(pos));
  }

  function buildAnimRail() {
    var rail = $('anim-rail');
    CPCaptions.ANIMATIONS.forEach(function (a) {
      var chip = document.createElement('button');
      chip.className = 'anim-chip' + (a.id === state.animId ? ' on' : '');
      chip.dataset.id = a.id;
      chip.textContent = a.name;
      chip.title = a.description;
      chip.addEventListener('click', function () { selectAnim(a.id); renderPreview(); });
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

  function updateVals() {
    $('c-size-val').textContent = $('c-size').value;
    $('c-pos-val').textContent = $('c-pos').value + '%';
    $('c-strokew-val').textContent = $('c-strokew').value;
  }

  function wireCustomizer() {
    var ids = ['c-font', 'c-size', 'c-pos', 'c-fill', 'c-hl', 'c-stroke', 'c-box',
               'c-strokew', 'c-box-on', 'c-upper', 'c-words', 'c-kw', 'c-kw-mode'];
    ids.forEach(function (id) {
      $(id).addEventListener('input', function () { updateVals(); renderPreview(); });
      $(id).addEventListener('change', function () { updateVals(); renderPreview(); });
    });
    $('c-kw').addEventListener('change', function () {
      $('c-kw-mode-wrap').classList.toggle('hidden', !this.checked);
    });
    // layout quick buttons set the position slider
    var lay = document.querySelectorAll('#c-layout button');
    for (var i = 0; i < lay.length; i++) {
      lay[i].addEventListener('click', function () {
        $('c-pos').value = this.dataset.pos;
        setLayoutButton(this.dataset.pos);
        updateVals(); renderPreview();
      });
    }
    $('c-pos').addEventListener('input', function () { setLayoutButton(this.value); });
    $('btn-replay').addEventListener('click', renderPreview);
  }

  function readKeyword() {
    return { on: $('c-kw').checked, mode: $('c-kw-mode').value };
  }

  // ----------------------------------------------------- sub-views / save ----
  function showView(v) {
    $('view-templates').classList.toggle('hidden', v !== 'templates');
    $('view-editor').classList.toggle('hidden', v !== 'editor');
    var btns = document.querySelectorAll('#cap-view button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].dataset.view === v);
    if (v === 'editor') renderPreview();
    if (v === 'templates') renderTemplateGrid();
  }

  function wireSubviews() {
    var btns = document.querySelectorAll('#cap-view button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () { showView(this.dataset.view); });
    }
    $('btn-back-lib').addEventListener('click', function () { showView('templates'); });
    $('btn-save-tpl').addEventListener('click', saveAsTemplate);
    $('btn-dup-tpl').addEventListener('click', duplicateTemplate);
    $('btn-export-tpl').addEventListener('click', exportTemplate);
  }

  /* Build a template object from the current customizer state. */
  function styleFromControls(name, id) {
    var o = readOverrides();
    return {
      id: id || ('custom-' + Date.now()),
      name: name || 'My Template',
      category: 'My Templates',
      popularity: 50,
      custom: true,
      font: o.font, fallbackFonts: currentPreset().fallbackFonts || [],
      fontSize: o.fontSize, fill: o.fill, highlight: o.highlight,
      stroke: o.strokeWidth ? o.stroke : null, strokeWidth: o.strokeWidth,
      boxColor: o.boxColor, boxRadius: currentPreset().boxRadius || 10,
      glow: currentPreset().glow || null,
      letterSpacing: currentPreset().letterSpacing || 0,
      uppercase: o.uppercase,
      layout: o.yPct <= 0.3 ? 'top' : o.yPct >= 0.66 ? 'bottom' : 'center',
      keyword: $('c-kw').checked,
      wordsPerCue: parseInt($('c-words').value, 10) || 0,
      anim: state.animId
    };
  }

  function saveAsTemplate() {
    var name = prompt('Name this template:', currentPreset().name + ' Custom');
    if (!name) return;
    var tpl = styleFromControls(name);
    state.customTemplates.push(tpl);
    saveCustom();
    state.presetId = tpl.id;
    $('editor-tpl-name').textContent = tpl.name;
    toast('Saved "' + name + '" to My Templates.');
  }

  function duplicateTemplate() {
    var tpl = styleFromControls(currentPreset().name + ' Copy');
    state.customTemplates.push(tpl);
    saveCustom();
    state.presetId = tpl.id;
    $('editor-tpl-name').textContent = tpl.name;
    toast('Duplicated as "' + tpl.name + '".');
  }

  function exportTemplate() {
    var tpl = styleFromControls(currentPreset().name, currentPreset().id);
    var json = JSON.stringify(tpl, null, 2);
    try {
      var p = nodeReq('path');
      var out = p.join(nodeReq('os').homedir(), (tpl.name.replace(/[^\w]+/g, '_')) + '.cutpilot.json');
      nodeReq('fs').writeFileSync(out, json, 'utf8');
      toast('Exported to ' + out);
    } catch (e) { toast('Export failed: ' + e.message, true); }
  }

  function importTemplate() {
    var p = pickFile('Choose a CutPilot template (.json)', ['json']);
    if (!p) return;
    try {
      var tpl = JSON.parse(nodeReq('fs').readFileSync(p, 'utf8'));
      if (!tpl || !tpl.font) throw new Error('Not a CutPilot template file.');
      tpl.id = 'custom-' + Date.now();
      tpl.category = 'My Templates';
      tpl.custom = true;
      state.customTemplates.push(tpl);
      saveCustom();
      state.libCategory = 'My Templates';
      var on = $('lib-cats').querySelector('.cat-chip.on'); if (on) on.classList.remove('on');
      renderTemplateGrid();
      toast('Imported "' + (tpl.name || 'template') + '".');
    } catch (e) { toast('Import failed: ' + e.message, true); }
  }

  /* Read the customizer into an overrides object for mergeStyle / render. */
  function readOverrides() {
    return {
      font: $('c-font').value,
      fontSize: parseInt($('c-size').value, 10),
      yPct: parseInt($('c-pos').value, 10) / 100,
      fill: $('c-fill').value,
      highlight: $('c-hl').value,
      stroke: $('c-stroke').value,
      strokeWidth: parseInt($('c-strokew').value, 10),
      boxColor: $('c-box-on').checked ? $('c-box').value : null,
      uppercase: $('c-upper').checked
    };
  }

  function fontStack(font, fallbacks) {
    return '"' + font + '", "' + (fallbacks || []).join('", "') + '", sans-serif';
  }

  // --------------------------------------------------------- live preview ----
  var previewTimer = null;
  var SAMPLE = ['THIS', 'LOOKS', 'INSANE'];

  function renderPreview() {
    if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
    var st = CPCaptions.mergeStyle(currentPreset(), readOverrides());
    var cap = $('preview-caption');
    var frame = $('preview-frame');
    var frameH = frame.clientHeight || 168;
    var px = Math.max(11, Math.round(st.fontSize * frameH / 1080));

    cap.style.fontFamily = fontStack(st.font, st.fallbackFonts);
    cap.style.fontSize = px + 'px';
    cap.style.color = st.fill;
    cap.style.top = Math.max(2, Math.round(st.yPct * frameH - px)) + 'px';

    // outline / glow
    var shadow = '';
    if (st.stroke && st.strokeWidth) {
      var sw = Math.max(1, Math.round(st.strokeWidth * frameH / 1080));
      shadow = [-sw + 'px -' + sw + 'px 0 ' + st.stroke, sw + 'px -' + sw + 'px 0 ' + st.stroke,
                '-' + sw + 'px ' + sw + 'px 0 ' + st.stroke, sw + 'px ' + sw + 'px 0 ' + st.stroke].join(', ');
    }
    if (st.glow) shadow = (shadow ? shadow + ', ' : '') + '0 0 ' + Math.round(px * 0.5) + 'px ' + st.glow;
    cap.style.textShadow = shadow;

    // background box
    if (st.boxColor) {
      cap.style.background = st.boxColor;
      cap.style.borderRadius = Math.round((st.boxRadius || 10) * frameH / 1080) + 'px';
      cap.style.padding = '2px ' + Math.round(px * 0.3) + 'px';
    } else {
      cap.style.background = 'transparent';
      cap.style.padding = '2px 6px';
    }

    var anim = state.animId;
    var words = parseInt($('c-words').value, 10) || 0;
    var caps = st.uppercase;

    // reset animation classes
    cap.className = 'preview-caption';

    if (anim === 'karaoke') {
      var idx = 0;
      var paint = function () {
        cap.innerHTML = SAMPLE.map(function (word, i) {
          var t = caps ? word.toUpperCase() : word.charAt(0) + word.slice(1).toLowerCase();
          return i === idx ? '<span style="color:' + st.highlight + '">' + t + '</span>' : t;
        }).join(' ');
        idx = (idx + 1) % SAMPLE.length;
      };
      paint();
      previewTimer = setInterval(paint, 520);
    } else if (anim === 'typewriter') {
      var full = SAMPLE.map(function (s) { return caps ? s : s.charAt(0) + s.slice(1).toLowerCase(); });
      var n = 1;
      var typ = function () {
        cap.textContent = full.slice(0, n).join(' ');
        n = n >= full.length ? 1 : n + 1;
      };
      typ();
      previewTimer = setInterval(typ, 480);
    } else {
      var kwOn = $('c-kw').checked;
      if (words === 1) {
        var oneWord = caps ? 'INSANE' : 'Insane';
        cap.innerHTML = kwOn ? '<span style="color:' + st.highlight + '">' + oneWord + '</span>' : oneWord;
      } else {
        var ws = caps ? ['THIS', 'LOOKS', 'INSANE'] : ['This', 'looks', 'insane'];
        cap.innerHTML = ws.map(function (word, i) {
          return (i === 2 && kwOn) ? '<span style="color:' + st.highlight + '">' + word + '</span>' : word;
        }).join(' ');
      }
      if (anim !== 'none') {
        void cap.offsetWidth; // re-trigger the CSS animation
        cap.classList.add('pa-' + anim);
      }
    }
  }

  // ============================================================ ADD CAPTIONS ==
  function capProgress(msg) {
    var el = $('cap-progress');
    if (msg == null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = msg;
  }

  function textCues(cues, words, upper) {
    if (words > 0) return CPCaptions.explodeWords(cues, { wordsPerCue: words, uppercase: upper });
    if (upper) return cues.map(function (c) { return { start: c.start, end: c.end, text: c.text.toUpperCase() }; });
    return cues;
  }

  // ---- main button: the animated engine ----
  $('btn-magic').addEventListener('click', function () {
    var cues;
    try { cues = readSelectedTranscript(); }
    catch (e) { return toast(e.message, true); }
    if (!state.env) return toast('Open a sequence in Premiere first.', true);

    var preset = currentPreset();
    var overrides = readOverrides();
    var words = parseInt($('c-words').value, 10) || 0;
    var anim = state.animId;

    var frames = CPCaptions.buildCaptionFrames(cues, {
      anim: anim,
      wordsPerCue: words,
      uppercase: overrides.uppercase,
      keyword: readKeyword()
    });

    if (frames.length > 1500 &&
        !confirm(frames.length + ' caption frames will be rendered — that can take a few minutes. Continue?')) return;

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
      overrides: overrides,
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

  // ---- advanced: Premiere template / plain track ----
  function wireAltMode() {
    var modeBtns = document.querySelectorAll('#cap-altmode button');
    for (var i = 0; i < modeBtns.length; i++) {
      modeBtns[i].addEventListener('click', function () {
        document.querySelector('#cap-altmode button.on').classList.remove('on');
        this.classList.add('on');
        var m = this.dataset.mode;
        $('alt-template').classList.toggle('hidden', m !== 'template');
        $('alt-native').classList.toggle('hidden', m !== 'native');
        if (m === 'template' && !state.installedMogrts.length) scanInstalledMogrts();
      });
    }
    var subs = document.querySelectorAll('#tpl-source button');
    for (var s = 0; s < subs.length; s++) {
      subs[s].addEventListener('click', function () {
        document.querySelector('#tpl-source button.on').classList.remove('on');
        this.classList.add('on');
        state.tplSource = this.dataset.src;
        $('tpl-installed').classList.toggle('hidden', state.tplSource !== 'installed');
        $('tpl-file').classList.toggle('hidden', state.tplSource !== 'file');
      });
    }
    $('btn-tpl-rescan').addEventListener('click', scanInstalledMogrts);
    $('btn-tpl-pick').addEventListener('click', function () {
      var p = pickFile('Choose a Motion Graphics Template', ['mogrt']);
      if (!p) return;
      state.mogrtFile = p;
      $('tpl-file-name').textContent = p.split(/[\\/]/).pop();
    });
    $('btn-alt-apply').addEventListener('click', applyMogrtTemplate);
    $('btn-native-apply').addEventListener('click', applyNative);
  }

  function scanInstalledMogrts() {
    var sel = $('tpl-select');
    sel.innerHTML = '<option>scanning…</option>';
    CPBridge.callHost('CP_findInstalledMogrts').then(function (r) {
      state.installedMogrts = r.items || [];
      sel.innerHTML = '';
      if (!state.installedMogrts.length) {
        sel.innerHTML = '<option value="">No installed templates</option>';
        $('tpl-installed-hint').textContent =
          'No Motion Graphics Templates are installed in Premiere yet. Install one ' +
          '(Essential Graphics panel → Install Motion Graphics Template), or use "From a ' +
          'file". Note: this lists Essential Graphics templates, not the Effects panel.';
        return;
      }
      var lastCat = null, group = null;
      state.installedMogrts.forEach(function (m, i) {
        if (m.category !== lastCat) {
          group = document.createElement('optgroup');
          group.label = m.category || 'Templates';
          sel.appendChild(group);
          lastCat = m.category;
        }
        var o = document.createElement('option');
        o.value = String(i); o.textContent = m.name;
        group.appendChild(o);
      });
      $('tpl-installed-hint').textContent =
        state.installedMogrts.length + ' templates found in your Premiere.';
    }).catch(function (e) {
      sel.innerHTML = '<option value="">scan failed</option>';
      $('tpl-installed-hint').textContent = e.message;
    });
  }

  function applyMogrtTemplate() {
    var cues;
    try { cues = readSelectedTranscript(); } catch (e) { return toast(e.message, true); }
    var mogrtPath = null;
    if (state.tplSource === 'installed') {
      var idx = parseInt($('tpl-select').value, 10);
      if (isNaN(idx) || !state.installedMogrts[idx]) {
        return toast('Pick an installed template, or switch to "From a file".', true);
      }
      mogrtPath = state.installedMogrts[idx].path;
    } else {
      if (!state.mogrtFile) return toast('Choose a .mogrt file first.', true);
      mogrtPath = state.mogrtFile;
    }
    var tcues = textCues(cues, parseInt($('c-words').value, 10) || 0, $('c-upper').checked);
    if (tcues.length > 400 &&
        !confirm(tcues.length + ' graphics will be added (one per line). Continue?')) return;
    capProgress('Adding ' + tcues.length + ' template graphics');
    $('btn-alt-apply').disabled = true;
    CPBridge.callHost('CP_insertMogrtCaptions', {
      mogrtPath: mogrtPath, cues: tcues, videoTrack: null, audioTrack: 0
    }).then(function (r) {
      $('btn-alt-apply').disabled = false;
      capProgress(null);
      toast('🎬 Added ' + r.inserted + ' template captions' +
            (r.failed ? ' · ' + r.failed + ' failed' : '') +
            (r.textSet === 0 && r.inserted ? ' — this template has no editable text field.' : ''),
            r.inserted === 0);
    }).catch(function (e) { $('btn-alt-apply').disabled = false; capProgress(null); toast(e.message, true); });
  }

  function applyNative() {
    var cues;
    try { cues = readSelectedTranscript(); } catch (e) { return toast(e.message, true); }
    var preset = currentPreset();
    var ncues = textCues(cues, parseInt($('c-words').value, 10) || 0, $('c-upper').checked);
    try {
      var pathMod = nodeReq('path');
      var out = pathMod.join(nodeReq('os').tmpdir(), 'cutpilot-' + Date.now() + '.srt');
      nodeReq('fs').writeFileSync(out, CPCaptions.toSRT(ncues), 'utf8');
      capProgress('Creating caption track');
      CPBridge.callHost('CP_importSrtCaptions', { srtPath: out }).then(function () {
        capProgress(null);
        toast('✓ Caption track added (' + ncues.length + ' lines). Style it once in Essential ' +
              'Graphics: ' + preset.font + ' ' + preset.fontSize + 'px, ' + preset.fill +
              (preset.stroke ? ' + stroke ' + preset.stroke : ''));
      }).catch(function (e) { capProgress(null); toast(e.message, true); });
    } catch (e) { capProgress(null); toast(e.message, true); }
  }

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
