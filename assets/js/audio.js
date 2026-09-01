/* ============================================================
   Verbatim — audio capture layer
   ------------------------------------------------------------
   Real work happens here. The microphone path, the RMS/VAD gate,
   the bounded ring buffer and the audio-file header inspection
   are genuine — not simulated. What is simulated in this web
   prototype is only the ASR decode itself (see session.js).
   ============================================================ */
(function (S) {
  'use strict';

  var U = S.util;

  var A = S.audio = {
    ctx: null,
    stream: null,
    analyser: null,
    data: null,

    mode: 'demo',        // 'mic' | 'demo' | 'file'
    running: false,
    level: 0,            // smoothed RMS, 0..1
    gateOpen: false,
    history: [],         // waveform scrollback, bounded
    HISTORY: 240,

    // bounded ring buffer — the proof for §13.6 "memory stays bounded"
    ring: [],
    RING_MAX: 12,        // at most 12 × 30 s of PCM held at once
    ringBytesPerChunk: 30 * 16000 * 2,   // 30 s, 16 kHz, 16-bit mono
    totalCaptured: 0,
    totalDiscarded: 0,

    // VAD hysteresis
    OPEN_AT: 0.055,
    CLOSE_AT: 0.030,
    hangoverMs: 550,
    lastVoiceAt: 0,

    sampleRate: null,
    channels: null,
    resampled: false,

    /* ---------- microphone ---------- */

    async startMic() {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !Ctx) {
        throw new Error('This browser exposes no microphone API.');
      }
      A.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      A.ctx = new Ctx();
      if (A.ctx.state === 'suspended') { await A.ctx.resume(); }

      var src = A.ctx.createMediaStreamSource(A.stream);
      A.analyser = A.ctx.createAnalyser();
      A.analyser.fftSize = 1024;
      A.analyser.smoothingTimeConstant = 0.6;
      A.data = new Uint8Array(A.analyser.fftSize);
      src.connect(A.analyser);

      // §7.1 — read the real device rate, never assume 16 kHz
      var track = A.stream.getAudioTracks()[0];
      var settings = (track && track.getSettings) ? track.getSettings() : {};
      A.sampleRate = settings.sampleRate || A.ctx.sampleRate;
      A.channels = settings.channelCount || 1;
      A.resampled = A.sampleRate !== 16000;

      A.mode = 'mic';
      return { sampleRate: A.sampleRate, channels: A.channels, resampled: A.resampled };
    },

    stopMic() {
      if (A.stream) { A.stream.getTracks().forEach(function (t) { t.stop(); }); A.stream = null; }
      if (A.ctx && A.ctx.close) { try { A.ctx.close(); } catch (e) { /* already closed */ } }
      A.ctx = null; A.analyser = null;
    },

    /* ---------- per-frame measurement ---------- */

    measure(tMs) {
      var lvl;

      if (A.mode === 'mic' && A.analyser) {
        A.analyser.getByteTimeDomainData(A.data);
        var sum = 0;
        for (var i = 0; i < A.data.length; i++) {
          var v = (A.data[i] - 128) / 128;
          sum += v * v;
        }
        lvl = Math.sqrt(sum / A.data.length);
        lvl = Math.min(1, lvl * 3.1);           // headroom for classroom distance mics
      } else {
        // Deterministic stand-in so the scope reads plausibly in demo mode.
        // Speech-like envelope: phrase bursts with breath pauses.
        var t = tMs / 1000;
        var phrase = Math.sin(t * 0.44) * 0.5 + 0.5;
        var breath = phrase > 0.28 ? 1 : 0.06;
        var syl = 0.55 + 0.45 * Math.sin(t * 11.3) * Math.sin(t * 4.1);
        lvl = U.clamp(breath * (0.16 + 0.30 * syl * phrase), 0, 1);
      }

      A.level = A.level * 0.55 + lvl * 0.45;      // temporal smoothing

      // VAD gate with hysteresis + hangover (§7.2)
      var now = tMs;
      if (A.level > A.OPEN_AT) { A.gateOpen = true; A.lastVoiceAt = now; }
      else if (A.level < A.CLOSE_AT && now - A.lastVoiceAt > A.hangoverMs) { A.gateOpen = false; }

      A.history.push({ v: A.level, g: A.gateOpen });
      while (A.history.length > A.HISTORY) { A.history.shift(); }

      return A.level;
    },

    /* ---------- bounded ring buffer ---------- */

    pushChunk(chunk) {
      A.ring.push(chunk);
      A.totalCaptured++;
      while (A.ring.length > A.RING_MAX) {
        A.ring.shift();                 // processed PCM is released, never accumulated
        A.totalDiscarded++;
      }
      return A.ring.length;
    },

    bufferBytes() { return A.ring.length * A.ringBytesPerChunk; },

    reset() {
      A.history = []; A.ring = []; A.level = 0; A.gateOpen = false;
      A.totalCaptured = 0; A.totalDiscarded = 0;
    },

    /* ---------- file ingestion (§7.1, §7.3, §13.8) ---------- */

    async inspectFile(file) {
      var report = { name: file.name, size: file.size, ok: false, problems: [] };

      if (file.size === 0) { report.problems.push('File is empty (0 bytes).'); return report; }
      if (file.size > 400 * 1024 * 1024) { report.problems.push('File exceeds the 400 MB session ceiling.'); }

      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { report.problems.push('No audio decoder available in this browser.'); return report; }

      var buf = await file.arrayBuffer();
      var ctx = new Ctx();
      try {
        // A decoder that never answers is as bad as one that crashes:
        // bound it and treat silence as a rejection, not as success.
        var decoded = await U.withTimeout(ctx.decodeAudioData(buf.slice(0)), 5000, null);
        if (!decoded) { throw new Error('decoder did not respond'); }
        report.sampleRate = decoded.sampleRate;
        report.channels = decoded.numberOfChannels;
        report.duration_ms = Math.round(decoded.duration * 1000);
        report.resampleNeeded = decoded.sampleRate !== 16000;
        report.downmixNeeded = decoded.numberOfChannels > 1;
        if (decoded.duration < 1) { report.problems.push('Audio is shorter than one second — likely truncated.'); }
        report.ok = report.problems.length === 0;
      } catch (e) {
        // §7 fail-closed: reject clearly, never guess at content
        report.problems.push('Decoder rejected the container or the stream is truncated. Nothing was transcribed.');
        report.detail = e.message;
      } finally {
        try { ctx.close(); } catch (e2) { /* noop */ }
      }
      return report;
    }
  };

  /* ============================================================
     SCOPE — waveform renderer
     ============================================================ */

  S.scope = {
    canvas: null, g: null, dpr: 1, ink: {},

    attach(canvas) {
      S.scope.canvas = canvas;
      S.scope.g = canvas.getContext('2d');
      S.scope.readPalette();
      S.scope.resize();
      window.addEventListener('resize', U.debounce(S.scope.resize, 120));
    },

    // Colours come from the stylesheet, so the scope can never drift
    // out of step with the rest of the interface.
    readPalette() {
      var cs = getComputedStyle(document.documentElement);
      var pick = function (n, f) { return (cs.getPropertyValue(n) || '').trim() || f; };
      S.scope.ink = {
        line: pick('--line', '#E7E6E1'),
        line2: pick('--line-2', '#DBD9D2'),
        quiet: pick('--ink-ghost', '#C6C3BA'),
        live: pick('--live', '#B4453C'),
        ok: pick('--ok-line', '#CFE0CE')
      };
    },

    resize() {
      var c = S.scope.canvas;
      if (!c) { return; }
      var dpr = window.devicePixelRatio || 1;
      var r = c.getBoundingClientRect();
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      S.scope.dpr = dpr;
      S.scope.draw();
    },

    draw() {
      var c = S.scope.canvas, g = S.scope.g;
      if (!c || !g) { return; }
      var W = c.width, H = c.height, dpr = S.scope.dpr, mid = H / 2;
      var ink = S.scope.ink;

      g.clearRect(0, 0, W, H);

      // baseline only — a full graticule would be noise at this density
      g.strokeStyle = ink.line;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, Math.round(mid) + 0.5); g.lineTo(W, Math.round(mid) + 0.5); g.stroke();

      // VAD thresholds, drawn so the gate reads as a measurement
      var open = A.OPEN_AT * 3.4;
      g.strokeStyle = ink.ok;
      g.setLineDash([2 * dpr, 5 * dpr]);
      [mid - open * mid, mid + open * mid].forEach(function (py) {
        g.beginPath(); g.moveTo(0, py); g.lineTo(W, py); g.stroke();
      });
      g.setLineDash([]);

      var hist = A.history;
      if (!hist.length) { return; }

      var bw = Math.max(1.5 * dpr, W / A.HISTORY);
      var n = hist.length;
      var startX = W - n * bw;

      for (var i = 0; i < n; i++) {
        var h = hist[i];
        var amp = Math.max(dpr, Math.pow(h.v, 0.72) * mid * 0.92);
        var x = startX + i * bw;
        g.globalAlpha = 0.35 + (i / n) * 0.65;
        g.fillStyle = h.g ? ink.live : ink.quiet;
        g.fillRect(x, mid - amp, Math.max(dpr, bw - dpr * 1.4), amp * 2);
      }
      g.globalAlpha = 1;

      // leading edge
      g.fillStyle = A.gateOpen ? ink.live : ink.line2;
      g.fillRect(W - dpr, 0, dpr, H);
    }
  };
})(window.Verbatim = window.Verbatim || {});
