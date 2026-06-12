/*
 * CutPilot — audio analysis engines (CEP panel side).
 * Two interchangeable detectors:
 *   1. webAudioDetect — decodes the media file with Chromium's Web Audio
 *      decoder (no external dependencies; fine for clips up to ~20 min).
 *   2. ffmpegDetect  — shells out to a user-configured ffmpeg binary and
 *      parses `silencedetect` output (fast, any format, any length).
 * Both resolve to raw silence ranges in media-relative seconds; the caller
 * pipes them through CPSilence.refineSilences().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CPAudio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function nodeRequire(mod) {
    // CEP with --enable-nodejs exposes require via cep_node or window.require
    var req = (typeof cep_node !== 'undefined' && cep_node.require) ||
              (typeof window !== 'undefined' && window.require) ||
              (typeof require !== 'undefined' && require);
    if (!req) throw new Error('Node.js is not available in this CEP panel. Check --enable-nodejs in the manifest.');
    return req(mod);
  }

  /* Read a file into an ArrayBuffer using Node fs (handles binary safely). */
  function readFileArrayBuffer(path) {
    var fs = nodeRequire('fs');
    var buf = fs.readFileSync(path);
    var ab = new ArrayBuffer(buf.length);
    var view = new Uint8Array(ab);
    for (var i = 0; i < buf.length; i++) view[i] = buf[i];
    return ab;
  }

  /* Downmix an AudioBuffer to a mono Float32Array. */
  function toMono(audioBuffer) {
    var ch = audioBuffer.numberOfChannels;
    if (ch === 1) return audioBuffer.getChannelData(0);
    var len = audioBuffer.length;
    var mono = new Float32Array(len);
    for (var c = 0; c < ch; c++) {
      var data = audioBuffer.getChannelData(c);
      for (var i = 0; i < len; i++) mono[i] += data[i] / ch;
    }
    return mono;
  }

  /*
   * Detector 1: Web Audio. Returns a Promise of
   * { silences: [{start,end}], duration, sampleRate }.
   */
  function webAudioDetect(mediaPath, detectOpts, CPSilenceLib) {
    return new Promise(function (resolve, reject) {
      var ab;
      try {
        ab = readFileArrayBuffer(mediaPath);
      } catch (e) {
        return reject(new Error('Could not read media file: ' + e.message));
      }
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      ctx.decodeAudioData(ab, function (audioBuffer) {
        try {
          var mono = toMono(audioBuffer);
          var silences = CPSilenceLib.detectSilences(mono, audioBuffer.sampleRate, detectOpts);
          resolve({
            silences: silences,
            duration: audioBuffer.duration,
            sampleRate: audioBuffer.sampleRate
          });
        } catch (e2) {
          reject(e2);
        } finally {
          ctx.close();
        }
      }, function () {
        ctx.close();
        reject(new Error(
          'Chromium could not decode this file (codec not supported in CEP). ' +
          'Set an ffmpeg path in Settings to analyze this format.'
        ));
      });
    });
  }

  /*
   * Detector 2: ffmpeg silencedetect. Returns a Promise of
   * { silences, duration }.
   * thresholdDb e.g. -40, minSilence in seconds.
   */
  function ffmpegDetect(mediaPath, ffmpegPath, thresholdDb, minSilence, CPSilenceLib) {
    return new Promise(function (resolve, reject) {
      var cp = nodeRequire('child_process');
      var args = [
        '-hide_banner', '-nostats',
        '-i', mediaPath,
        '-af', 'silencedetect=noise=' + thresholdDb + 'dB:d=' + minSilence,
        '-f', 'null', '-'
      ];
      var proc = cp.spawn(ffmpegPath, args);
      var stderr = '';
      proc.stderr.on('data', function (d) { stderr += d.toString(); });
      proc.on('error', function (e) {
        reject(new Error('Could not launch ffmpeg at "' + ffmpegPath + '": ' + e.message));
      });
      proc.on('close', function (code) {
        if (code !== 0 && stderr.indexOf('silence_') === -1) {
          return reject(new Error('ffmpeg exited with code ' + code + ':\n' + stderr.slice(-400)));
        }
        var dur = null;
        var dm = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(stderr);
        if (dm) dur = (+dm[1]) * 3600 + (+dm[2]) * 60 + (+dm[3]);
        resolve({
          silences: CPSilenceLib.parseFfmpegSilences(stderr, dur),
          duration: dur
        });
      });
    });
  }

  return {
    readFileArrayBuffer: readFileArrayBuffer,
    toMono: toMono,
    webAudioDetect: webAudioDetect,
    ffmpegDetect: ffmpegDetect
  };
});
