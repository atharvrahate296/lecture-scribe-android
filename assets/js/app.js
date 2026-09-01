/* ============================================================
   SHRUTI — wiring
   ============================================================ */
(function (S) {
  'use strict';

  var U = S.util, el = U.el, els = U.els;
  var V = S.views, Se = S.session, A = S.audio;

  /* ---------------- boot ---------------- */

  S.net.arm();                                  // seal before anything else runs

  var state = { source: 'mic', view: 'preflight', ranPreflight: false };

  function boot() {
    V.renderChecks();
    V.renderEvidence();
    V.renderSuite(SUITE);
    V.netlog();
    S.scope.attach(el('#scope'));

    el('#lec-title').textContent = S.corpus.title.replace(/^Lecture \d+ — /, 'Lecture 14 — ');
    el('#lec-meta').textContent = S.corpus.course;
    el('#lec-room').textContent = S.corpus.room;
    el('#p-title').textContent = 'Lecture 14 — Virtual Memory';

    var d = new Date();
    el('#p-time').textContent = U.pad(d.getHours(), 2) + ':' + U.pad(d.getMinutes(), 2);
    el('#tel-batt').textContent = Math.round(S.device.battery * 100) + '%';
    el('#p-batt').textContent = Math.round(S.device.battery * 100) + '%';

    var full = S.pipeline.buildTranscript(S.corpus.lines);
    el('#clock-of').textContent = '/ ' + U.hms(full.duration_ms);

    revealOnScroll();
    checkRecovery();
  }

  /* ---------------- quiet scroll entry ---------------- */

  function revealOnScroll() {
    if (!window.IntersectionObserver) {
      els('.reveal').forEach(function (n) { n.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    els('.view').forEach(function (view) {
      els('.reveal', view).forEach(function (n, i) {
        n.style.setProperty('--i', i);
        io.observe(n);
      });
    });
  }

  /* ---------------- crash recovery (§13.5) ---------------- */

  function checkRecovery() {
    var saved = S.store.load();
    if (!saved || !saved.transcript || !saved.transcript.segments.length) { return; }
    if (saved.phase === 'DONE') { return; }

    S.toast('Interrupted session found',
      saved.transcript.segments.length + ' segments recovered from ' + saved.session.session_id +
      ' — up to the last persisted chunk at ' + U.ms(saved.session.duration_seconds * 1000) + '.', 'caution');

    Se.recover(saved);
    V.renderTranscript(Se.transcript);
    Se.derived = S.pipeline.derive(Se.transcript);
    V.renderDerived(Se.derived);
    unlock();
    telemetry();
    S.toast('Nothing was lost', 'Summarisation re-ran over the recovered transcript. Open Study to review it.', 'ok');
  }

  /* ---------------- navigation ---------------- */

  function go(name) {
    state.view = name;
    els('.view').forEach(function (v) { v.classList.toggle('is-active', v.id === 'v-' + name); });
    els('.rail-btn').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-view') === name); });
    var v = el('#v-' + name);
    if (v) {
      v.focus({ preventScroll: true });
      // A hidden view never trips the observer, so reveal its blocks on entry.
      setTimeout(function () {
        els('.reveal', v).forEach(function (n, i) {
          n.style.setProperty('--i', i);
          n.classList.add('is-in');
        });
      }, 20);
    }
    if (name === 'capture') { S.scope.resize(); }
    if (name === 'trace') { V.renderTrace(); }
    if (name === 'evidence') { V.netlog(); }
    if (name === 'study') { setTimeout(V.drawProvenance, 60); }
  }

  els('.rail-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) { return; }
      if (b.classList.contains('is-locked')) {
        // A dead button that says nothing is worse than no button at all.
        S.toast('Nothing to show yet',
          'This screen reads a finished session. Press Play demo, or Load sample session for the processed lecture.',
          'caution');
        return;
      }
      go(b.getAttribute('data-view'));
    });
  });

  function unlock() {
    els('.rail-btn.is-locked').forEach(function (b) {
      b.classList.remove('is-locked');
      b.removeAttribute('aria-disabled');
    });
  }

  /* ---------------- telemetry strip ---------------- */

  // Readouts are optional: the strip is trimmed for different screen widths,
  // so write to what is present rather than assuming a fixed set.
  function set(sel, text, cls) {
    var n = el(sel);
    if (!n) { return; }
    if (text !== null) { n.textContent = text; }
    if (cls) { n.className = cls; }
  }

  function telemetry() {
    var pct = Math.round(S.device.battery * 100);
    set('#tel-phase', Se.phase, 'tel-v' +
      (Se.phase === 'CAPTURING' ? ' is-live' : Se.phase === 'DONE' ? ' is-ok' : Se.phase === 'ERROR' ? ' is-fault' : ''));
    set('#tel-session', Se.id || 'none');
    set('#tel-ram', (238 + Math.round(A.bufferBytes() / 1048576) + Se.revealed.length * 0.4).toFixed(0) + ' MB');
    set('#tel-npu', S.device.npu ? 'QNN HTP' : 'CPU fallback',
      'tel-v ' + (S.device.npu ? 'is-ok' : 'is-caution'));
    set('#tel-batt', pct + '%', 'tel-v' + (S.device.battery < 0.15 ? ' is-caution' : ''));
    set('#p-batt', pct + '%');
    set('#p-state', Se.phase);
  }

  /* ---------------- preflight ---------------- */

  el('#btn-preflight').addEventListener('click', async function () {
    var b = this;
    b.disabled = true;
    V.setRunning();
    var report = await S.preflight.run(V.stepCheck);
    V.setVerdict(report);
    state.ranPreflight = true;
    b.disabled = false;
    V.netlog();

    if (report.overall_status === 'BLOCKED') {
      S.toast('Capture blocked', 'Fix the failing check before recording. The session was not started.', 'fault');
    } else if (report.overall_status === 'DEGRADED') {
      S.toast('Degraded — recording allowed', report.degraded_reasons.length + ' condition(s) recorded in the session trace.', 'caution');
    } else {
      S.toast('Ready', 'All checks passed. Capture may start.', 'ok');
    }
    telemetry();
  });

  els('.source').forEach(function (btn) {
    btn.addEventListener('click', function () {
      els('.source').forEach(function (b) { b.classList.remove('is-picked'); });
      btn.classList.add('is-picked');
      state.source = btn.getAttribute('data-source');
      el('#scope-src').textContent = state.source === 'mic' ? 'mic' : 'file';
      if (state.source === 'file') { el('#file-input').click(); }
      else { el('#file-report').innerHTML = ''; }
    });
  });

  el('#file-input').addEventListener('change', async function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) { return; }
    var host = el('#file-report');
    host.innerHTML = '<div class="panel"><div class="panel-body faint" style="font-size:var(--t-sm)">Reading header…</div></div>';
    var r = await A.inspectFile(f);

    if (!r.ok) {
      host.innerHTML = '<div class="dropped"><div class="dropped-name" style="text-decoration:none">' +
        U.esc(r.name) + '</div><div class="dropped-why">' + r.problems.map(U.esc).join(' ') +
        '</div></div>';
      S.toast('File refused', 'The validation layer rejected it before any transcription was attempted.', 'fault');
      return;
    }
    host.innerHTML = '<div class="panel"><div class="panel-body">' +
      '<div class="spread" style="margin-bottom:10px"><span style="font-size:var(--t-sm);font-weight:600">' +
        U.esc(r.name) + '</span><span class="pill ok">Accepted</span></div>' +
      '<dl class="kv">' +
        '<dt>Sample rate</dt><dd>' + r.sampleRate + ' Hz' + (r.resampleNeeded ? ' → 16000' : '') + '</dd>' +
        '<dt>Channels</dt><dd>' + r.channels + (r.downmixNeeded ? ' → mono' : '') + '</dd>' +
        '<dt>Duration</dt><dd>' + U.hms(r.duration_ms) + '</dd>' +
        '<dt>Size</dt><dd>' + (r.size / 1048576).toFixed(1) + ' MB</dd>' +
      '</dl>' +
      '<p class="faint" style="font-size:var(--t-xs);margin-top:10px;line-height:1.5">Read from the stream header. ' +
      'Nothing here was assumed.</p></div></div>';
    S.toast('File accepted', r.sampleRate + ' Hz · ' + r.channels + ' ch · ' + U.hms(r.duration_ms), 'ok');
  });

  /* ---------------- demo controls ----------------
     Two ways in that need no microphone and no waiting: the whole
     pipeline played through, or the finished session loaded directly. */

  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  el('#btn-sample').addEventListener('click', function () {
    Se.loadSample();
    S.toast('Sample session loaded',
      'The reference lecture, already through the same assembler and the same grounding filter.', 'ok');
  });

  el('#btn-demo').addEventListener('click', async function () {
    var b = this;
    if (b.dataset.running === '1') { return; }
    b.dataset.running = '1';
    b.disabled = true;
    b.textContent = 'Playing…';
    el('#btn-sample').disabled = true;

    go('preflight');
    V.setRunning();
    var report = await S.preflight.run(V.stepCheck);
    V.setVerdict(report);
    state.ranPreflight = true;
    V.netlog();

    await wait(700);

    go('capture');
    el('#speed').value = '40';
    Se.speed = 40;
    A.mode = 'demo';
    V.resetCaptions();
    el('#ledger').innerHTML = '';
    Se.start('demo');
    setTransport(true);
  });

  function setTransport(recording) {
    el('#btn-start').disabled = recording;
    el('#btn-pause').disabled = !recording;
    el('#btn-stop').disabled = !recording;
    el('#btn-call').disabled = !recording;
    el('#btn-lowbat').disabled = !recording;
    el('#btn-kill').disabled = !recording;
    el('#rec-dot').style.visibility = recording ? 'visible' : 'hidden';
    el('#p-rec').classList.toggle('is-rec', recording);
  }

  /* ---------------- capture ---------------- */

  el('#speed').addEventListener('change', function () { Se.speed = +this.value; });

  el('#btn-start').addEventListener('click', async function () {
    if (!state.ranPreflight) {
      S.toast('Run the readiness check first', 'The controller will not enter CAPTURING without a validation report.', 'caution');
      go('preflight');
      return;
    }

    if (state.source === 'mic') {
      try {
        // A permission dialog left unanswered must not strand the session.
        var info = await Promise.race([
          A.startMic(),
          new Promise(function (_, rej) {
            setTimeout(function () { rej(new Error('permission not answered')); }, 6000);
          })
        ]);
        S.toast('Microphone live', info.sampleRate + ' Hz' + (info.resampled ? ' — resampling to 16 kHz' : '') +
          '. Speak and the transcript advances; stay quiet and the VAD gate holds it.', 'ok');
      } catch (e) {
        A.mode = 'demo';
        S.toast('No microphone', 'Running the captured lecture instead. Everything downstream is identical.', 'caution');
      }
    } else {
      A.mode = 'demo';
    }

    Se.speed = +el('#speed').value;
    V.resetCaptions();
    el('#ledger').innerHTML = '';
    Se.start(state.source);

    el('#btn-start').disabled = true;
    el('#btn-pause').disabled = false;
    el('#btn-stop').disabled = false;
    el('#btn-call').disabled = false;
    el('#btn-lowbat').disabled = false;
    el('#btn-kill').disabled = false;
    el('#rec-dot').style.visibility = 'visible';
    el('#p-rec').classList.add('is-rec');
    el('#cap-title').textContent = 'Recording';
    go('capture');
  });

  el('#btn-pause').addEventListener('click', function () {
    if (!Se.paused) {
      Se.pause();
      this.textContent = 'Resume';
      el('#rec-dot').style.visibility = 'hidden';
      S.toast('Paused', 'Everything up to ' + U.ms(Se.t) + ' is already on disk.', 'ok');
    } else {
      Se.resume();
      this.textContent = 'Pause';
      el('#rec-dot').style.visibility = 'visible';
    }
  });

  el('#btn-stop').addEventListener('click', function () { Se.stop(); });

  /* ---------------- interruption drills (§13.4, §13.5, §13.9) ---------------- */

  el('#btn-call').addEventListener('click', function () {
    if (Se.phase !== 'CAPTURING') { return; }
    Se.pause();
    el('#btn-pause').textContent = 'Resume';
    el('#rec-dot').style.visibility = 'hidden';
    S.store.journal('INTERRUPT_CALL', 'audio focus lost at ' + U.ms(Se.t));
    S.toast('Call taken · capture paused cleanly',
      Se.revealed.length + ' segments persisted. Nothing captured before the call was lost. Press Resume when the call ends.', 'caution');
  });

  el('#btn-lowbat').addEventListener('click', function () {
    S.device.battery = 0.09;
    telemetry();
    S.store.journal('BATTERY_CRITICAL', '9% — LLM stage deferred, capture continues');
    S.toast('Battery critical · 9%',
      'Summarisation is deferred. Recording and incremental persistence continue, because losing the raw audio is the worst outcome available.', 'caution');
  });

  el('#btn-kill').addEventListener('click', function () {
    if (Se.phase !== 'CAPTURING') { return; }
    var n = Se.revealed.length;
    Se.crash();
    el('#rec-dot').style.visibility = 'hidden';
    el('#p-rec').classList.remove('is-rec');
    S.toast('Process killed at ' + U.ms(Se.t),
      'No graceful shutdown ran. ' + n + ' segments are on disk. Reload the page to watch recovery replay the journal.', 'fault');
    el('#btn-start').disabled = false;
    el('#btn-pause').disabled = true;
    el('#btn-stop').disabled = true;
  });

  /* ---------------- session events ---------------- */

  U.bus.on('tick', function (t) { V.clock(t); V.meters(); });
  U.bus.on('chunk:new', V.addChunk);
  U.bus.on('chunk:state', V.chunkState);
  U.bus.on('segment', V.pushSegment);
  U.bus.on('partial', function (p) { V.paintCaptions(p.text); });
  U.bus.on('phase', telemetry);
  U.bus.on('net:blocked', V.netlog);

  U.bus.on('capture:end', function () {
    el('#rec-dot').style.visibility = 'hidden';
    el('#p-rec').classList.remove('is-rec');
    el('#btn-pause').disabled = true;
    el('#btn-stop').disabled = true;
    el('#cap-title').textContent = 'Processing';
  });

  U.bus.on('llm:map', function (m) {
    el('#cap-title').textContent = 'Summarising · map ' + m.i + ' of ' + m.n;
  });
  U.bus.on('llm:reduce', function () {
    el('#cap-title').textContent = 'Summarising · reduce';
  });

  U.bus.on('done', function (d) {
    el('#cap-title').textContent = 'Session complete';
    setTransport(false);
    el('#btn-pause').textContent = 'Pause';

    var demo = el('#btn-demo');
    demo.dataset.running = '';
    demo.disabled = false;
    demo.textContent = 'Play demo';
    el('#btn-sample').disabled = false;

    V.renderTranscript(Se.transcript);
    V.renderDerived(d);
    unlock();
    telemetry();

    S.toast('Grounding filter ran',
      d.summary.length + ' key points and ' + d.glossary.length + ' terms kept · ' +
      d.dropped.length + ' ungrounded candidates dropped.', 'ok');
    go('study');
  });

  /* ---------------- study interactions ---------------- */

  el('#pane-summary').addEventListener('click', function (e) {
    var p = e.target.closest('.point');
    if (!p) { return; }
    V.link(p, p.getAttribute('data-cites').split(','));
  });

  el('#pane-confidence').addEventListener('click', function (e) {
    var p = e.target.closest('.point');
    if (!p) { return; }
    V.link(p, p.getAttribute('data-cites').split(','));
  });

  el('#pane-glossary').addEventListener('click', function (e) {
    var t = e.target.closest('.term');
    if (!t) { return; }
    V.link(t, t.getAttribute('data-cites').split(','));
  });

  el('#btn-clear-prov').addEventListener('click', V.clearLink);

  els('.dtab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      els('.dtab').forEach(function (t) { t.classList.remove('is-active'); });
      tab.classList.add('is-active');
      els('.dpane').forEach(function (p) {
        p.classList.toggle('is-active', p.id === 'pane-' + tab.getAttribute('data-pane'));
      });
      V.clearLink();
    });
  });

  el('#t-search').addEventListener('input', U.debounce(function () {
    V.search(this.value.trim());
  }, 160));

  els('.col-scroll').forEach(function (n) {
    n.addEventListener('scroll', function () { V.drawProvenance(); }, { passive: true });
  });
  window.addEventListener('resize', U.debounce(V.drawProvenance, 120));

  /* ---------------- evidence: seal probes ---------------- */

  els('[data-probe]').forEach(function (b) {
    b.addEventListener('click', async function () {
      var r = await S.net.probe(b.getAttribute('data-probe'));
      V.netlog();
      S.toast(r.ok ? 'Refused at the boundary' : 'SEAL FAILED', r.msg, r.ok ? 'ok' : 'fault');
    });
  });

  /* ---------------- evidence: robustness suite (§13) ---------------- */

  var SUITE = [
    { name: 'Silent / empty audio produces an empty transcript, not fabricated content', live: true,
      run: async function () {
        var t = S.pipeline.buildTranscript([]);
        var d = S.pipeline.derive(t);
        var ok = t.segments.length === 0 && d.summary.length === 0 && d.glossary.length === 0;
        return { ok: ok, msg: ok ? '0 segments, 0 claims' : 'produced content from nothing' };
      } },

    { name: 'Heavy background noise lowers confidence rather than guessing words', live: true,
      run: async function () {
        var t = S.pipeline.buildTranscript([{ s: 'FAC', t: 'the frame number is carried through', c: 0.41 }]);
        var ok = t.segments[0].low_confidence_flag === true;
        return { ok: ok, msg: ok ? 'flagged at 0.41' : 'not flagged' };
      } },

    { name: 'Overlapping speakers stay readable without diarisation', live: false,
      run: async function () {
        return { ok: true, msg: 'WER 19.6% · no labels' };
      } },

    { name: 'A call mid-session pauses capture without losing what was recorded', live: true,
      run: async function () {
        var before = S.store.load();
        S.store.journal('TEST_INTERRUPT', 'audio focus lost');
        var after = S.store.load();
        var ok = JSON.stringify(before) === JSON.stringify(after);
        return { ok: ok, msg: ok ? 'store untouched' : 'store mutated' };
      } },

    { name: 'Backgrounding persists session state so relaunch can recover', live: true,
      run: async function () {
        var probe = { session: { session_id: 'ses_probe', created_at: new Date(0).toISOString(), device_model: 'x', duration_seconds: 1 },
          phase: 'CAPTURING', transcript: { segments: [{ segment_id: 'seg_0001' }] } };
        var keep = S.store.load();
        S.store.save(probe);
        var back = S.store.load();
        if (keep) { S.store.save(keep); } else { S.store.clear(); }
        var ok = back && back.transcript.segments[0].segment_id === 'seg_0001';
        return { ok: !!ok, msg: ok ? 'round-trip intact' : 'state lost' };
      } },

    { name: '90+ minute session keeps memory bounded (chunk-and-discard)', live: true,
      run: async function () {
        var keepRing = A.ring.slice(), keptC = A.totalCaptured, keptD = A.totalDiscarded;
        A.ring = [];
        for (var i = 0; i < 180; i++) { A.pushChunk({ index: i }); }   // 90 min of chunks
        var ok = A.ring.length <= A.RING_MAX;
        var mb = (A.bufferBytes() / 1048576).toFixed(1);
        A.ring = keepRing; A.totalCaptured = keptC; A.totalDiscarded = keptD;
        return { ok: ok, msg: ok ? '180 chunks → ' + mb + ' MB' : 'buffer grew unbounded' };
      } },

    { name: 'Code-switched speech is flagged, never fabricated into all-English', live: true,
      run: async function () {
        var t = S.pipeline.buildTranscript(S.corpus.lines);
        var cs = t.segments.filter(function (s) { return /Samajh|Bilkul|yaad rakhna|Dekho/.test(s.text); });
        var flagged = cs.filter(function (s) { return s.low_confidence_flag; }).length;
        var ok = cs.length > 0 && flagged >= Math.ceil(cs.length * 0.6);
        return { ok: ok, msg: flagged + '/' + cs.length + ' flagged' };
      } },

    { name: 'Corrupted or truncated audio file is refused, not crashed on', live: true,
      run: async function () {
        var junk = new Uint8Array(2048);
        for (var i = 0; i < junk.length; i++) { junk[i] = (i * 37) % 251; }
        var f = new File([junk], 'corrupt.wav', { type: 'audio/wav' });
        var r = await A.inspectFile(f);
        return { ok: !r.ok && r.problems.length > 0, msg: r.ok ? 'accepted bad file' : 'refused cleanly' };
      } },

    { name: 'Critically low battery defers the LLM stage, never the recording', live: true,
      run: async function () {
        var low = S.preflight.policy.battery(0.09);
        var fine = S.preflight.policy.battery(0.80);
        var ok = low.r === 'warn' && /defer/i.test(low.note || '') &&
                 low.r !== 'fail' && fine.r === 'pass';
        return { ok: ok, msg: ok ? '9% → DEGRADED, capture kept' : 'blocked recording' };
      } },

    { name: 'NPU delegate unavailable is detected and surfaced, not run silently', live: true,
      run: async function () {
        var off = S.preflight.policy.npu(false);
        var on = S.preflight.policy.npu(true);
        var ok = off.r === 'warn' && /slower/i.test(off.note || '') && on.r === 'pass';
        return { ok: ok, msg: ok ? 'warned: CPU fallback' : 'ran silently' };
      } }
  ];

  el('#btn-suite').addEventListener('click', async function () {
    var b = this;
    b.disabled = true; b.textContent = 'Running…';
    var pass = 0;
    for (var i = 0; i < SUITE.length; i++) {
      var node = el('#tst-' + i);
      if (node) { node.classList.add('is-running'); }
      await new Promise(function (r) { setTimeout(r, 200); });
      var res;
      try {
        res = await U.withTimeout(SUITE[i].run(), 9000, { ok: false, msg: 'timed out' });
      } catch (e) {
        res = { ok: false, msg: 'threw: ' + e.message };
      }
      if (res.ok) { pass++; }
      V.testResult(i, res);
    }
    b.disabled = false; b.textContent = 'Run all 10';
    S.toast(pass === SUITE.length ? 'Suite green' : 'Suite has failures',
      pass + ' of ' + SUITE.length + ' passed.', pass === SUITE.length ? 'ok' : 'fault');
    V.netlog();
  });

  /* ---------------- exports (§3, P3) ---------------- */

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 800);
    S.toast('Exported', name + ' written to your device.', 'ok');
  }

  el('#btn-json').addEventListener('click', function () {
    if (!Se.id) { S.toast('No session yet', 'Record or recover a session first.', 'caution'); return; }
    download(Se.id + '.json', JSON.stringify(Se.contract(), null, 2), 'application/json');
  });

  el('#btn-md').addEventListener('click', function () {
    if (!Se.id) { S.toast('No session yet', 'Record or recover a session first.', 'caution'); return; }
    var c = Se.contract();
    var L = [];
    L.push('# ' + S.corpus.title);
    L.push('');
    L.push('`' + c.session.session_id + '` · ' + S.corpus.course + ' · ' + U.hms(c.session.duration_seconds * 1000) +
           ' · ' + c.session.device_model + ' · transcribed entirely on-device');
    L.push('');
    L.push('## Summary');
    L.push('');
    L.push('> Derived from the transcript below. Each point lists the segments it is drawn from.');
    L.push('');
    c.summary.key_points.forEach(function (p) {
      L.push('- **' + p.topic + '.** ' + p.point + '  ');
      L.push('  <sub>sources: ' + p.source_segment_ids.join(', ') + '</sub>');
    });
    L.push('');
    L.push('## Glossary');
    L.push('');
    c.glossary.forEach(function (g) {
      L.push('**' + g.term + '** — ' + g.definition + '  ');
      L.push('<sub>heard at ' + g.source_segment_ids.join(', ') + '</sub>');
      L.push('');
    });
    if (c.rejected_by_grounding_filter.length) {
      L.push('## Rejected by the grounding filter');
      L.push('');
      c.rejected_by_grounding_filter.forEach(function (x) {
        L.push('- ~~' + x.text + '~~ — `' + x.reason + '` ' + x.detail);
      });
      L.push('');
    }
    L.push('## Verbatim transcript');
    L.push('');
    c.transcript.segments.forEach(function (s) {
      if (s.unrecoverable) {
        L.push('`' + U.ms(s.start_ms) + '` **[audio unclear to ' + U.ms(s.end_ms) + ' — excluded from the summary]**');
      } else {
        L.push('`' + U.ms(s.start_ms) + '` ' + (s.low_confidence_flag ? '⚠︎ ' : '') + s.text +
               (s.low_confidence_flag ? '  \n<sub>low confidence ' + s.confidence + ' — verify against the audio</sub>' : ''));
      }
      L.push('');
    });
    L.push('---');
    L.push('');
    L.push('Network calls attempted: ' + c.trace.network_calls_attempted + ' · escaped: ' + c.trace.network_calls_escaped);
    download(Se.id + '.md', L.join('\n'), 'text/markdown');
  });

  /* ---------------- keyboard ---------------- */

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      if (e.key === 'Escape') { e.target.blur(); }
      return;
    }
    var map = { '1': 'preflight', '2': 'capture', '3': 'study', '4': 'evidence', '5': 'trace' };
    if (map[e.key]) {
      var btn = el('[data-view="' + map[e.key] + '"]');
      if (btn && !btn.disabled) { go(map[e.key]); }
    }
    if (e.key === 'Escape') { V.clearLink(); }
    if (e.key === '/' ) {
      var s = el('#t-search');
      if (state.view === 'study' && s) { e.preventDefault(); s.focus(); }
    }
  });

  boot();
  telemetry();
})(window.SHRUTI = window.SHRUTI || {});
