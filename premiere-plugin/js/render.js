/*
 * CutPilot — built-in caption rendering engine.
 * Renders every caption frame to a transparent PNG via <canvas> (any font,
 * fill, stroke, glow, highlight box — full pixel control), saves them with
 * Node, and hands the list to the ExtendScript host which places them on
 * the timeline and keyframes the entry animation.
 * The pure layout helpers are exported for Node unit tests.
 */
(function (root, factory) {
  var lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  if (root) root.CPRender = lib;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /*
   * Greedy line wrap using an injected measure function (px width of a
   * string). Pure — tested in Node with a fake measurer.
   */
  function wrapLines(words, maxWidth, measure) {
    var lines = [];
    var line = [];
    for (var i = 0; i < words.length; i++) {
      var candidate = line.concat([words[i]]).join(' ');
      if (line.length && measure(candidate) > maxWidth) {
        lines.push(line);
        line = [words[i]];
      } else {
        line.push(words[i]);
      }
    }
    if (line.length) lines.push(line);
    return lines;
  }

  /*
   * Resolve a preset + user overrides into concrete pixel values for a
   * given frame height. Override precedence matches CPCaptions.mergeStyle.
   */
  function styleForFrame(preset, frameH, o) {
    o = o || {};
    var scale = frameH / 1080;
    var strokeW = (o.strokeWidth != null) ? o.strokeWidth : (preset.strokeWidth || 0);
    var box = (o.boxColor !== undefined) ? o.boxColor : (preset.boxColor || null);
    return {
      font: o.font || preset.font,
      fallbacks: (preset.fallbackFonts || []).join('", "'),
      size: Math.round((o.fontSize || preset.fontSize) * scale),
      fill: o.fill || preset.fill,
      highlight: o.highlight || preset.highlight || '#FFD400',
      stroke: (o.stroke !== undefined) ? o.stroke : (preset.stroke || null),
      strokeWidth: Math.round(strokeW * scale),
      boxColor: box,
      boxRadius: Math.round(((o.boxRadius != null ? o.boxRadius : preset.boxRadius) || 10) * scale),
      glow: (o.glow !== undefined) ? o.glow : (preset.glow || null),
      uppercase: o.uppercase != null ? o.uppercase : preset.uppercase,
      yPct: o.yPct != null ? o.yPct : 0.76,
      maxWidthPct: 0.86,
      lineGap: 1.18
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /*
   * Draw one caption frame onto a canvas.
   * frame: { text } or { words:[...], active } (karaoke).
   * Returns the canvas (caller turns it into a PNG).
   */
  function drawFrame(canvas, frame, style) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.font = '900 ' + style.size + 'px "' + style.font + '", "' + style.fallbacks + '", sans-serif';

    var words = frame.words ? frame.words.slice() : String(frame.text).split(' ');
    if (style.uppercase) {
      for (var u = 0; u < words.length; u++) words[u] = words[u].toUpperCase();
    }
    var maxW = W * style.maxWidthPct;
    var measure = function (s) { return ctx.measureText(s).width; };
    var lines = wrapLines(words, maxW, measure);

    var lineH = style.size * style.lineGap;
    var blockH = lines.length * lineH;
    var baseY = H * style.yPct - blockH + lineH; // baseline of first line

    var wordIndex = 0;
    for (var li = 0; li < lines.length; li++) {
      var lineWords = lines[li];
      var spaceW = measure(' ');
      var lineW = measure(lineWords.join(' '));
      var x = (W - lineW) / 2;
      var y = baseY + li * lineH;

      // Background box behind the whole line (Highlight Box style)
      if (style.boxColor) {
        var padX = style.size * 0.32, padY = style.size * 0.22;
        ctx.fillStyle = style.boxColor;
        roundRect(ctx, x - padX, y - style.size - padY + style.size * 0.18,
                  lineW + padX * 2, style.size + padY * 2, style.boxRadius);
        ctx.fill();
      }

      for (var wi = 0; wi < lineWords.length; wi++) {
        var word = lineWords[wi];
        var isActive = frame.words != null && wordIndex === frame.active;

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        if (style.glow) {
          ctx.shadowColor = style.glow;
          ctx.shadowBlur = style.size * 0.35;
        }
        if (style.stroke && style.strokeWidth) {
          ctx.strokeStyle = style.stroke;
          ctx.lineWidth = style.strokeWidth;
          ctx.strokeText(word, x, y);
        }
        ctx.fillStyle = isActive ? style.highlight : style.fill;
        ctx.fillText(word, x, y);

        x += measure(word) + spaceW;
        wordIndex++;
      }
    }
    return canvas;
  }

  function nodeRequire(mod) {
    var req = (typeof cep_node !== 'undefined' && cep_node.require) ||
              (typeof window !== 'undefined' && window.require) ||
              (typeof require !== 'undefined' && require);
    return req(mod);
  }

  /*
   * Render all frames to PNG files. Async (yields to the UI between
   * chunks). Returns Promise of [{path, start, end}].
   * opts: { width, height, preset, overrides, outDir, onProgress }
   */
  function renderFrames(frames, opts) {
    var fs = nodeRequire('fs');
    var pathMod = nodeRequire('path');
    // Buffer is not always a page global in CEP mixed context
    var NodeBuffer = (typeof Buffer !== 'undefined') ? Buffer : nodeRequire('buffer').Buffer;
    var outDir = opts.outDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    var style = styleForFrame(opts.preset, opts.height, opts.overrides);
    var canvas = document.createElement('canvas');
    canvas.width = opts.width;
    canvas.height = opts.height;

    var results = [];
    var i = 0;
    return new Promise(function (resolve, reject) {
      function chunk() {
        try {
          var stop = Math.min(i + 20, frames.length);
          for (; i < stop; i++) {
            drawFrame(canvas, frames[i], style);
            var b64 = canvas.toDataURL('image/png').split(',')[1];
            var file = pathMod.join(outDir, 'cap_' + String(10000 + i) + '.png');
            fs.writeFileSync(file, NodeBuffer.from(b64, 'base64'));
            results.push({ path: file, start: frames[i].start, end: frames[i].end });
          }
          if (opts.onProgress) opts.onProgress(i, frames.length);
          if (i < frames.length) setTimeout(chunk, 0);
          else resolve(results);
        } catch (e) { reject(e); }
      }
      chunk();
    });
  }

  return {
    wrapLines: wrapLines,
    styleForFrame: styleForFrame,
    drawFrame: drawFrame,
    renderFrames: renderFrames
  };
});
