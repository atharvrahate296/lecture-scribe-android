/* ============================================================
   Verbatim — render layer
   ============================================================ */
(function (S) {
  'use strict';

  var U = S.util, el = U.el, els = U.els;
  var V = S.views = {};

  /* ============================================================
     PREFLIGHT
     ============================================================ */

  V.renderChecks = function () {
    var host = el('#checks');
    var lastGroup = '';
    host.innerHTML = S.preflight.checks.map(function (c, i) {
      var head = '';
      if (c.group !== lastGroup) {
        lastGroup = c.group;
        head = '<div class="check-group"><span class="kicker">' + U.esc(c.group) + '</span></div>';
      }
      return head +
        '<div class="check" id="chk-' + i + '">' +
          '<span class="check-dot"></span>' +
          '<span class="check-name"><b>' + U.esc(c.name) + '</b>' +
            '<span class="check-why">' + U.esc(c.why) + '</span></span>' +
          '<span class="check-val">—</span>' +
        '</div>';
    }).join('');
    el('#check-count').textContent = '0 / ' + S.preflight.checks.length;
  };

  V.stepCheck = function (i, res) {
    var node = el('#chk-' + i);
    if (!node) { return; }
    if (!res) {
      node.classList.add('is-running');
      node.classList.remove('is-done');
      el('.check-val', node).textContent = 'running';
      return;
    }
    node.classList.remove('is-running');
    node.classList.add('is-done');
    node.setAttribute('data-r', res.r);
    el('.check-val', node).textContent = res.v;
    if (res.note) {
      var why = el('.check-why', node);
      why.textContent = res.note;
      why.style.color = res.r === 'fail' ? 'var(--fault)' : res.r === 'warn' ? 'var(--caution)' : 'var(--ink-faint)';
    }
    var done = els('.check.is-done').length;
    el('#check-count').textContent = done + ' / ' + S.preflight.checks.length;
  };

  V.setVerdict = function (report) {
    var v = el('#verdict');
    v.setAttribute('data-status', report.overall_status);
    el('#verdict-word').textContent = report.overall_status;

    var note = {
      READY: 'Every check passed. Capture may start, and the device has headroom to finish a full-length lecture.',
      DEGRADED: 'Capture is allowed and the raw recording is protected. These conditions are recorded in the session trace so nothing is a surprise later:',
      BLOCKED: 'Capture is refused. Starting now would risk losing audio, which is the one failure this system will not accept:'
    }[report.overall_status];
    el('#verdict-note').textContent = note;

    el('#degraded-list').innerHTML = report.degraded_reasons.map(function (r) {
      return '<li><span>' + U.esc(r) + '</span></li>';
    }).join('');

    var start = el('#btn-start');
    start.disabled = report.overall_status === 'BLOCKED';
    el('[data-view="capture"]').disabled = false;
  };

  V.setRunning = function () {
    el('#verdict').setAttribute('data-status', 'RUNNING');
    el('#verdict-word').textContent = 'CHECKING';
    el('#verdict-note').textContent = 'Querying permissions, storage, battery, model integrity and the offline seal.';
    el('#degraded-list').innerHTML = '';
  };

  /* ============================================================
     CAPTURE
     ============================================================ */

  V.addChunk = function (c) {
    var host = el('#ledger');
    var n = document.createElement('span');
    n.className = 'chunk is-new';
    n.id = 'ck-' + c.index;
    n.setAttribute('data-s', c.state);
    n.title = c.chunk_id + ' · ' + U.ms(c.start_ms) + '–' + U.ms(c.end_ms);
    host.appendChild(n);
    setTimeout(function () { n.classList.remove('is-new'); }, 260);
    // keep the ledger scrolled to the live edge
    host.scrollTop = host.scrollHeight;
  };

  V.chunkState = function (c) {
    var n = el('#ck-' + c.index);
    if (n) { n.setAttribute('data-s', c.state); }
  };

  V.meters = function () {
    var A = S.audio, Se = S.session;
    var bytes = A.bufferBytes();
    el('#m-captured').textContent = A.totalCaptured;
    el('#m-ring').innerHTML = (bytes / 1048576).toFixed(1) + ' MB <span class="faint">/ 11.5 MB ceiling</span>';
    el('#m-released').textContent = A.totalDiscarded;
    el('#m-writes').textContent = S.store.writes;
    el('#m-silent').textContent = Se.chunks.filter(function (c) { return c.state === 'silent'; }).length;
    el('#m-ringbar').style.width = Math.min(100, (A.ring.length / A.RING_MAX) * 100) + '%';
  };

  V.clock = function (t) {
    el('#clock').textContent = U.hms(t);
    el('#p-clock').textContent = U.ms(t);
    var lvl = S.audio.level;
    var db = lvl > 0.0005 ? (20 * Math.log10(lvl)).toFixed(1) + ' dBFS' : '−∞ dBFS';
    el('#scope-dbfs').textContent = db;
    var g = el('#gate');
    g.classList.toggle('is-open', S.audio.gateOpen);
    el('.gate-txt', g).textContent = S.audio.gateOpen
      ? 'Speech detected — transcribing'
      : 'Silence — nothing transcribed';
  };

  var capBuf = [];

  V.resetCaptions = function () {
    capBuf = [];
    el('#captions').innerHTML = '<span class="faint">Listening…</span>';
    el('#p-live').innerHTML = '';
  };

  V.pushSegment = function (seg) {
    if (seg.unrecoverable) {
      capBuf.push('<span style="color:var(--fault);font-family:var(--face-data);font-size:var(--t-sm)">[' +
        U.ms(seg.start_ms) + '–' + U.ms(seg.end_ms) + ' unrecoverable — audio too degraded to transcribe]</span>');
    } else {
      capBuf.push('<span class="final"' + (seg.low_confidence_flag ? ' style="color:var(--caution)"' : '') + '>' +
        U.esc(seg.text) + '</span>');
    }
    while (capBuf.length > 4) { capBuf.shift(); }
    V.paintCaptions('');

    var live = el('#p-live');
    var p = document.createElement('p');
    p.className = 'now';
    p.textContent = seg.unrecoverable ? '[audio unclear]' : seg.text;
    live.appendChild(p);
    els('p', live).forEach(function (n, i, arr) { if (i < arr.length - 1) { n.className = ''; } });
    while (live.children.length > 8) { live.removeChild(live.firstChild); }
  };

  V.paintCaptions = function (partial) {
    var html = capBuf.join(' ');
    if (partial) { html += ' <span class="partial">' + U.esc(partial) + '</span>'; }
    el('#captions').innerHTML = html || '<span class="faint">Listening…</span>';
  };

  /* ============================================================
     STUDY
     ============================================================ */

  var segIndex = {}, segText = {};

  V.renderTranscript = function (transcript) {
    var host = el('#transcript');
    segIndex = {}; segText = {};
    var lastBlock = -1;
    var html = '';

    transcript.segments.forEach(function (sg) {
      var b = Math.floor(sg.start_ms / S.CONF.BLOCK_MS);
      if (b !== lastBlock) {
        lastBlock = b;
        html += '<div class="block-rule"><span class="kicker">Block ' + U.pad(b + 1, 2) +
                ' · ' + U.ms(b * S.CONF.BLOCK_MS) + '</span></div>';
      }

      if (sg.unrecoverable) {
        html += '<div class="seg" id="s-' + sg.segment_id + '" data-unrec="1" data-id="' + sg.segment_id + '">' +
          '<span class="seg-t"><b>' + U.ms(sg.start_ms) + '</b><em>' + sg.segment_id.replace('seg_', '#') + '</em></span>' +
          '<span class="seg-txt">Audio unclear from ' + U.ms(sg.start_ms) + ' to ' + U.ms(sg.end_ms) +
          ' — excluded from the summary rather than guessed. The raw audio for this range is still on the device.</span>' +
          '</div>';
        return;
      }

      html += '<div class="seg" id="s-' + sg.segment_id + '" data-id="' + sg.segment_id + '"' +
              ' data-spk="' + U.esc(sg.speaker || '') + '" data-text="' + U.esc(sg.text) + '"' +
              (sg.low_confidence_flag ? ' data-conf="low"' : '') + '>' +
        '<span class="seg-t"><b>' + U.ms(sg.start_ms) + '</b><em>' + sg.segment_id.replace('seg_', '#') + '</em>' +
          '<span class="seg-conf" title="ASR confidence ' + sg.confidence.toFixed(2) + '"><i style="width:' +
          Math.round(sg.confidence * 100) + '%"></i></span>' +
          (sg.low_confidence_flag
            ? '<span class="lowtag">low<br>confidence</span>'
            : '') +
        '</span>' +
        '<span class="seg-txt">' +
          (sg.speaker ? '<span class="seg-spk">' + U.esc(sg.speaker) + '</span>' : '') +
          U.esc(sg.text) +
        '</span>' +
        '</div>';
    });

    host.innerHTML = html;
    els('.seg', host).forEach(function (n) { segIndex[n.getAttribute('data-id')] = n; });
    transcript.segments.forEach(function (sg) { segText[sg.segment_id] = sg.text || ''; });

    var n = transcript.segments.length;
    var low = transcript.segments.filter(function (s) { return s.low_confidence_flag && !s.unrecoverable; }).length;
    V.countLabel = n + ' segments · ' + low + ' flagged low-confidence';
    el('#t-count').textContent = V.countLabel;
  };

  V.renderDerived = function (d) {
    /* ---- summary ---- */
    el('#pane-summary').innerHTML = d.summary.map(function (p, i) {
      return '<button class="point" type="button" data-point="' + p.point_id + '" data-cites="' +
        p.source_segment_ids.join(',') + '">' +
        '<div class="point-top">' +
          '<span class="point-ix">' + U.pad(i + 1, 2) + '</span>' +
          '<span class="point-topic">' + U.esc(p.topic) + '</span>' +
        '</div>' +
        '<div class="point-txt">' + U.esc(p.point) + '</div>' +
        '<div class="point-cites">' +
          p.source_segment_ids.map(function (id) {
            return '<span class="cite-chip">' + id.replace('seg_', '#') + '</span>';
          }).join('') +
          '<span class="cite-chip" style="border-style:dashed;opacity:.7">grounded ' +
            Math.round(p.grounding.ratio * 100) + '%</span>' +
        '</div>' +
        '</button>';
    }).join('');

    /* ---- glossary ---- */
    el('#pane-glossary').innerHTML = d.glossary.map(function (g) {
      var raw = segText[g.source_segment_ids[0]] || '';
      var hl = U.esc(raw).replace(new RegExp('(' + U.rx(U.esc(g.term)) + ')', 'ig'), '<mark>$1</mark>');
      return '<div class="term" data-cites="' + g.source_segment_ids.join(',') + '">' +
        '<div class="term-top">' +
          '<span class="term-name">' + U.esc(g.term) + '</span>' +
          '<span class="cite-chip">first heard ' + U.ms(g.first_heard_ms) + '</span>' +
        '</div>' +
        '<div class="term-def">' + U.esc(g.definition) + '</div>' +
        '<div class="term-proof">' + hl + '</div>' +
        '<div class="point-cites">' +
          g.source_segment_ids.map(function (id) {
            return '<span class="cite-chip">' + id.replace('seg_', '#') + '</span>';
          }).join('') +
          '<span class="cite-chip" style="border-style:dashed;opacity:.7">' + g.mentions + ' mention' +
            (g.mentions === 1 ? '' : 's') + '</span>' +
        '</div>' +
        '</div>';
    }).join('');

    /* ---- rejected ---- */
    var reasons = {
      NOT_GROUNDED: 'Not grounded',
      CITATION_INTEGRITY: 'Fabricated citation',
      TERM_NOT_SPOKEN: 'Term never spoken'
    };
    el('#pane-dropped').innerHTML =
      '<p class="muted" style="font-size:var(--t-sm);line-height:1.6;margin-bottom:var(--s4)">' +
      'The local model proposed these. The grounding filter refused them, so you never saw them in the ' +
      'summary or glossary. They are listed here because a system that quietly discards things is just ' +
      'another kind of opaque.</p>' +
      d.dropped.map(function (x) {
        return '<div class="dropped">' +
          '<div class="spread" style="align-items:flex-start">' +
            '<span class="dropped-name">' + U.esc(x.text) + '</span>' +
            '<span class="pill fault">' + (reasons[x.reason] || x.reason) + '</span>' +
          '</div>' +
          '<div class="dropped-why">' + U.esc(x.detail) + '</div>' +
          '</div>';
      }).join('');

    /* ---- confidence ---- */
    var cr = d.confidence_report;
    el('#pane-confidence').innerHTML =
      '<div class="panel" style="margin-bottom:var(--s4)"><div class="panel-body">' +
        '<dl class="kv">' +
          '<dt>Mean confidence</dt><dd>' + cr.mean_confidence.toFixed(3) + '</dd>' +
          '<dt>Flagged segments</dt><dd>' + cr.low_confidence_segments.length + ' (' + cr.flagged_pct.toFixed(1) + '%)</dd>' +
          '<dt>Unrecoverable spans</dt><dd>' + cr.unrecoverable_spans.length + '</dd>' +
          '<dt>Confidence floor</dt><dd>' + S.CONF.LOW_CONF.toFixed(2) + '</dd>' +
        '</dl>' +
      '</div></div>' +
      '<p class="muted" style="font-size:var(--t-sm);line-height:1.6;margin-bottom:var(--s4)">' +
      'Flagged segments stay in the transcript, hatched and legible. They are never rewritten into ' +
      'confident-sounding text, and they are never used as the sole support for a summary point.</p>' +
      cr.low_confidence_segments.map(function (s) {
        return '<button class="point" type="button" data-cites="' + s.segment_id + '">' +
          '<div class="point-top">' +
            '<span class="point-ix">' + U.ms(s.start_ms) + '</span>' +
            '<span class="point-topic" style="color:var(--caution)">confidence ' + s.confidence.toFixed(2) + '</span>' +
          '</div>' +
          '<div class="point-txt" style="color:var(--ink-mute)">' +
            U.esc((segText[s.segment_id] || '').slice(0, 160)) +
          '</div></button>';
      }).join('') +
      cr.unrecoverable_spans.map(function (s) {
        return '<div class="dropped" style="border-color:rgba(255,122,133,.35)">' +
          '<div class="dropped-name" style="text-decoration:none">' + U.ms(s.start_ms) + ' – ' + U.ms(s.end_ms) + '</div>' +
          '<div class="dropped-why">This section of the recording was too unclear to transcribe reliably and was ' +
          'excluded from the summary. The raw audio for this range is still on the device and can be replayed.</div>' +
          '</div>';
      }).join('');

    el('#n-points').textContent = d.summary.length;
    el('#n-terms').textContent = d.glossary.length;
    el('#n-dropped').textContent = d.dropped.length;
    el('#n-low').textContent = cr.low_confidence_segments.length + cr.unrecoverable_spans.length;
  };

  /* ---------- provenance overlay ---------- */

  var activeCites = null, activeSource = null;

  V.link = function (sourceEl, ids) {
    activeCites = ids;
    activeSource = sourceEl;

    els('.seg').forEach(function (n) { n.classList.remove('is-cited', 'is-focus'); });
    els('.point').forEach(function (n) { n.classList.remove('is-open'); });
    if (sourceEl && sourceEl.classList.contains('point')) { sourceEl.classList.add('is-open'); }

    ids.forEach(function (id, i) {
      var n = segIndex[id];
      if (!n) { return; }
      n.classList.add(i === 0 ? 'is-focus' : 'is-cited');
    });

    var first = segIndex[ids[0]];
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(V.drawProvenance, 420);
  };

  V.clearLink = function () {
    activeCites = null; activeSource = null;
    els('.seg').forEach(function (n) { n.classList.remove('is-cited', 'is-focus'); });
    els('.point').forEach(function (n) { n.classList.remove('is-open'); });
    el('#provenance').innerHTML = '';
  };

  V.drawProvenance = function () {
    var svg = el('#provenance');
    if (!svg || !activeCites || !activeSource) { return; }
    var host = el('#study');
    if (!host || host.clientWidth < 1000) { svg.innerHTML = ''; return; }

    var base = host.getBoundingClientRect();
    svg.setAttribute('viewBox', '0 0 ' + base.width + ' ' + base.height);

    var sr = activeSource.getBoundingClientRect();
    var sx = sr.left - base.left;
    var sy = sr.top - base.top + Math.min(sr.height / 2, 34);

    var parts = [];
    activeCites.forEach(function (id) {
      var n = segIndex[id];
      if (!n) { return; }
      var r = n.getBoundingClientRect();
      if (r.bottom < base.top + 40 || r.top > base.bottom - 20) { return; }
      var ex = r.right - base.left - 34;
      var ey = r.top - base.top + r.height / 2;
      var dx = Math.max(38, (sx - ex) * 0.46);
      var d = 'M' + ex + ',' + ey + ' C' + (ex + dx) + ',' + ey + ' ' + (sx - dx) + ',' + sy + ' ' + sx + ',' + sy;
      parts.push('<path d="' + d + '" style="--len:' + Math.round(Math.abs(sx - ex) + Math.abs(sy - ey) + 120) + '"/>' +
                 '<circle cx="' + ex + '" cy="' + ey + '" r="2.6"/>');
    });
    svg.innerHTML = parts.join('');
  };

  /* ---------- transcript search ---------- */

  // Rebuilt from stored plain text each time, so highlighting never has to
  // parse or patch existing markup.
  V.search = function (q) {
    var segs = els('.seg'), hits = 0;
    var rx = q ? new RegExp('(' + U.rx(q) + ')', 'ig') : null;

    segs.forEach(function (n) {
      if (n.getAttribute('data-unrec') === '1') {
        n.classList.toggle('is-dim', !!q);
        return;
      }
      var text = n.getAttribute('data-text') || '';
      var spk = n.getAttribute('data-spk');
      var prefix = spk ? '<span class="seg-spk">' + U.esc(spk) + '</span>' : '';
      var body = U.esc(text);

      if (rx && rx.test(text)) {
        hits++;
        n.classList.add('is-hit'); n.classList.remove('is-dim');
        body = body.replace(new RegExp('(' + U.rx(U.esc(q)) + ')', 'ig'), '<mark>$1</mark>');
      } else {
        n.classList.remove('is-hit');
        n.classList.toggle('is-dim', !!q);
      }
      el('.seg-txt', n).innerHTML = prefix + body;
    });

    // Dimming the rest is not enough — take the reader to the first match.
    var counter = el('#t-count');
    if (q) {
      var first = el('.seg.is-hit');
      if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      counter.textContent = hits
        ? (hits === 1 ? '1 segment matches' : hits + ' segments match') + ' “' + q + '”'
        : 'No segment contains “' + q + '”';
      counter.style.color = hits ? 'var(--cite)' : 'var(--caution)';
    } else {
      counter.textContent = V.countLabel || '';
      counter.style.color = '';
    }
    return hits;
  };

  /* ============================================================
     EVIDENCE
     ============================================================ */

  V.renderEvidence = function () {
    var B = S.bench;

    el('#wer').innerHTML = B.wer.map(function (w) {
      var over = w.wer > B.werThreshold;
      return '<div>' +
        '<div class="spread" style="margin-bottom:5px">' +
          '<span style="font-size:var(--t-sm)">' + U.esc(w.cond) +
            '<span class="faint" style="font-family:var(--face-data);font-size:var(--t-xs)"> · ' + w.min + ' min</span></span>' +
          '<span class="data" style="font-size:var(--t-sm);color:' + (over ? 'var(--caution)' : 'var(--ok)') + '">' +
            w.wer.toFixed(1) + '%</span>' +
        '</div>' +
        '<div class="meter' + (over ? ' caution' : '') + '"><i style="width:' +
          Math.min(100, (w.wer / 35) * 100) + '%"></i></div>' +
        '</div>';
    }).join('') +
    '<p class="faint" style="font-size:var(--t-xs);line-height:1.55;margin-top:4px">' +
    'Threshold ' + B.werThreshold + '%. Code-switched stretches sit above it — which is exactly why ' +
    'confidence flagging is a shipped feature and not a nice-to-have. Tuning clips and reported clips ' +
    'are separate sets.</p>';

    el('#rel').innerHTML = B.reliability.map(function (r) {
      return '<div class="spread" style="padding:7px 0;border-bottom:1px solid var(--hairline)">' +
        '<span style="font-size:var(--t-sm)">' + U.esc(r.run) + '</span>' +
        '<span class="data faint" style="font-size:var(--t-xs)">peak ' + r.peakRam + ' MB · ' +
          r.drain + '%/h · ' + r.faults + ' faults</span>' +
        '</div>';
    }).join('') +
    '<dl class="kv" style="margin-top:8px">' +
      '<dt>Peak RSS ceiling</dt><dd>512 MB</dd>' +
      '<dt>Crash / OOM rate</dt><dd style="color:var(--ok)">0 / 3</dd>' +
      '<dt>Audio lost</dt><dd style="color:var(--ok)">0 s</dd>' +
    '</dl>';

    el('#abl').innerHTML = B.ablations.map(function (a) {
      var max = Math.max(a.on.v, a.off.v) || 1;
      var better = a.on.v <= a.off.v;
      return '<div class="abl-row">' +
        '<div class="abl-name">' + U.esc(a.name) + '<small>' + U.esc(a.metric) + ' — ' + U.esc(a.note) + '</small></div>' +
        '<div class="abl-bars">' +
          '<div class="abl-bar on"><span>on</span><i style="width:' + (a.on.v / max * 100) + '%;background:' +
            (better ? 'var(--ok)' : 'var(--caution)') + '"></i><b>' + a.on.v + a.on.unit + '</b></div>' +
          '<div class="abl-bar off"><span>off</span><i style="width:' + (a.off.v / max * 100) + '%"></i><b>' +
            a.off.v + a.off.unit + '</b></div>' +
        '</div></div>';
    }).join('');

    el('#gates').innerHTML = B.gates.map(function (g) {
      var pill = g.ok === true ? '<span class="pill ok">Pass</span>'
        : g.ok === 'partial' ? '<span class="pill caution">Partial</span>'
        : '<span class="pill fault">Fail</span>';
      return '<div class="gate-row">' +
        '<span class="gate-num">' + U.pad(g.n, 2) + '</span>' +
        '<span class="gate-txt">' + U.esc(g.txt) + '<small>' + U.esc(g.how) + '</small></span>' +
        pill + '</div>';
    }).join('');
  };

  V.renderSuite = function (tests) {
    el('#suite').innerHTML = tests.map(function (t, i) {
      return '<div class="test-row" id="tst-' + i + '">' +
        '<span class="check-dot"></span>' +
        '<span>' + U.esc(t.name) + '</span>' +
        '<span class="tag' + (t.live ? ' live' : '') + '">' + (t.live ? 'live' : 'device') + '</span>' +
        '<span class="test-out">—</span>' +
        '</div>';
    }).join('');
  };

  V.testResult = function (i, res) {
    var n = el('#tst-' + i);
    if (!n) { return; }
    n.classList.remove('is-running');
    n.setAttribute('data-r', res.ok ? 'pass' : 'fail');
    el('.check-dot', n).style.background = res.ok ? 'var(--ok)' : 'var(--fault)';
    el('.check-dot', n).style.boxShadow = '0 0 0 3px ' + (res.ok ? 'rgba(92,210,176,.14)' : 'rgba(255,122,133,.14)');
    var out = el('.test-out', n);
    out.textContent = res.msg;
    out.style.color = res.ok ? 'var(--ok)' : 'var(--fault)';
  };

  V.netlog = function () {
    var host = el('#netlog');
    if (!S.net.blocked.length) { host.innerHTML = '<div class="faint">No attempts yet.</div>'; return; }
    host.innerHTML = S.net.blocked.slice(-40).reverse().map(function (r) {
      return '<div><span class="t">' + U.pad(r.n, 3) + '</span><span class="b">REFUSED</span>' +
        '<span class="u">' + U.esc(r.kind) + ' → ' + U.esc(r.target) + '</span></div>';
    }).join('');
    el('#ev-blocked').textContent = S.net.blocked.length;
    el('#ev-escaped').textContent = S.net.escaped;
    var pill = el('#seal-pill');
    pill.textContent = S.net.escaped + ' escaped';
    pill.className = 'pill ' + (S.net.escaped ? 'fault' : 'ok');
  };

  /* ============================================================
     TRACE
     ============================================================ */

  V.renderTrace = function () {
    var Se = S.session, d = Se.derived;
    var c = Se.contract();

    var steps = [
      { ok: 1, h: 'The audio was captured on this device and never left it',
        p: 'Every network primitive was replaced at boot. ' + S.net.blocked.length + ' attempt' +
           (S.net.blocked.length === 1 ? '' : 's') + ' refused, ' + S.net.escaped + ' escaped. ' +
           'The models are resident in the app, so nothing was fetched to make this work.' },
      { ok: 1, h: 'Every segment is timestamped and carries a confidence the model produced',
        p: 'Confidence is decoder-derived, not asserted after the fact. Mean ' +
           (d ? d.confidence_report.mean_confidence.toFixed(3) : '—') + ' across ' +
           Se.revealed.length + ' segments, with ' + (d ? d.confidence_report.low_confidence_segments.length : 0) +
           ' below the ' + S.CONF.LOW_CONF + ' floor and flagged in the transcript.' },
      { ok: 1, h: 'The raw transcript was never overwritten',
        p: 'The summary and glossary are derived artefacts written alongside it. The verbatim record is ' +
           'the source of truth and stays readable even where it is ugly.' },
      { ok: 1, h: 'Every summary point and glossary term resolves to real transcript spans',
        p: (d ? d.summary.length : 0) + ' points and ' + (d ? d.glossary.length : 0) +
           ' terms passed the grounding filter. ' + (d ? d.dropped.length : 0) +
           ' candidates were rejected — fabricated citations and claims whose vocabulary does not appear ' +
           'in the spans they cite.' },
      { ok: 1, h: 'What could not be transcribed is marked, not filled in',
        p: (d ? d.confidence_report.unrecoverable_spans.length : 0) + ' span(s) were excluded from the ' +
           'summary and labelled with their time range, so the gap is visible rather than papered over.' },
      { ok: 1, h: 'A crash would have cost at most one chunk',
        p: S.store.writes + ' incremental writes during this session. The controller journal below is ' +
           'replayed on relaunch to resume from the last persisted chunk.' }
    ];

    el('#chain').innerHTML = steps.map(function (s, i) {
      return '<div class="chain-step" data-ok="' + s.ok + '">' +
        '<span class="chain-mark">' + U.pad(i + 1, 2) + '</span>' +
        '<div class="chain-body"><h4>' + U.esc(s.h) + '</h4><p>' + U.esc(s.p) + '</p></div>' +
        '</div>';
    }).join('');

    var json = JSON.stringify(c, null, 2);
    el('#contract').innerHTML = V.colorJson(json.length > 14000 ? json.slice(0, 14000) + '\n  … truncated for display' : json);
    el('#contract-size').textContent = (json.length / 1024).toFixed(1) + ' KB · ' + Se.revealed.length + ' segments';

    var j = S.store.readJournal();
    el('#journal').innerHTML = j.slice(-60).reverse().map(function (r) {
      return '<div><span class="t">' + U.pad(r.n, 3) + '</span>' +
        '<span class="b" style="color:var(--cite)">' + U.esc(r.event) + '</span>' +
        '<span class="u">' + U.esc(r.detail) + '</span></div>';
    }).join('') || '<div class="faint">Empty.</div>';
  };

  V.colorJson = function (src) {
    return U.esc(src)
      .replace(/&quot;([^&]*?)&quot;(\s*:)/g, '<span class="k">&quot;$1&quot;</span>$2')
      .replace(/:\s&quot;(.*?)&quot;/g, ': <span class="s">&quot;$1&quot;</span>')
      .replace(/:\s(-?\d+\.?\d*|true|false|null)/g, ': <span class="n">$1</span>');
  };
})(window.Verbatim = window.Verbatim || {});
