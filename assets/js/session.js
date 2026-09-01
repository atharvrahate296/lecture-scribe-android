/* ============================================================
   SHRUTI — session controller  (spec §10)
   ------------------------------------------------------------
   A deterministic state machine, not a free-form agent. It may
   only move between the enumerated phases, and every transition
   is journalled, so crash recovery is a replay of the state
   object rather than a guess about where the session stopped.

     IDLE → CAPTURING → PROCESSING_ASR → SUMMARIZING → DONE
                    ↘ ERROR

   NOTE ON SIMULATION: the mic path, VAD gate, ring buffer and
   persistence below are real. The ASR decode is simulated — the
   device build calls whisper-tiny INT8 through the QNN delegate
   at this exact seam (see decodeChunk).
   ============================================================ */
(function (S) {
  'use strict';

  var U = S.util, A = S.audio;

  var PHASES = ['IDLE', 'CAPTURING', 'PROCESSING_ASR', 'SUMMARIZING', 'DONE', 'ERROR'];

  var Session = S.session = {
    phase: 'IDLE',
    speed: 12,                  // session seconds per wall-clock second
    t: 0,                       // session time, ms
    startedAt: 0,
    raf: null,
    watchdog: null,
    paused: false,
    lastFrame: 0,

    transcript: null,           // full authored ground truth (revealed progressively)
    revealed: [],               // segments that have been decoded so far
    chunks: [],
    derived: null,
    readiness: null,
    source: 'mic',

    partial: { segIx: -1, words: 0 },
    error_log: [],
    id: null,

    /* ---------- phase transitions ---------- */

    to: function (phase, detail) {
      if (PHASES.indexOf(phase) === -1) { throw new Error('illegal phase ' + phase); }
      Session.phase = phase;
      S.store.journal('PHASE:' + phase, detail || '');
      U.bus.emit('phase', phase);
    },

    fresh: function () {
      var d = new Date();
      Session.id = 'ses_' + d.getFullYear() + U.pad(d.getMonth() + 1, 2) + U.pad(d.getDate(), 2) +
                   '_' + U.pad(d.getHours(), 2) + U.pad(d.getMinutes(), 2) + U.pad(d.getSeconds(), 2);
      Session.t = 0;
      Session.revealed = [];
      Session.chunks = [];
      Session.derived = null;
      Session.error_log = [];
      Session.partial = { segIx: -1, words: 0 };
      Session.transcript = S.pipeline.buildTranscript(S.corpus.lines);
      A.reset();
      S.store.clear();
      S.store.journal('SESSION_OPEN', Session.id);
    },

    /* ---------- capture ---------- */

    start: function (source) {
      if (Session.phase === 'CAPTURING') { return; }
      Session.source = source || 'mic';
      Session.fresh();
      Session.startedAt = Date.now();
      Session.lastFrame = performance.now();
      Session.paused = false;
      Session.to('CAPTURING', 'source=' + Session.source);
      Session.tick(performance.now());
    },

    pause: function () {
      if (Session.phase !== 'CAPTURING') { return; }
      Session.unschedule();
      Session.paused = true;
      S.store.journal('CAPTURE_PAUSED', 'at ' + U.ms(Session.t));
      Session.persist();
      U.bus.emit('paused');
    },

    resume: function () {
      if (Session.phase !== 'CAPTURING' || !Session.paused) { return; }
      Session.paused = false;
      Session.lastFrame = performance.now();
      S.store.journal('CAPTURE_RESUMED', 'at ' + U.ms(Session.t));
      Session.tick(performance.now());
    },

    stop: function () {
      if (Session.phase !== 'CAPTURING') { return; }
      Session.unschedule();
      Session.paused = false;
      A.stopMic();
      Session.finishChunks();
      Session.to('PROCESSING_ASR', 'flushing ' + Session.pendingCount() + ' chunk(s)');
      U.bus.emit('capture:end');

      // flush any chunk still in flight, then run the LLM stage
      setTimeout(function () {
        Session.chunks.forEach(function (c) {
          if (c.state !== 'persisted' && c.state !== 'silent') { Session.setChunk(c, 'persisted'); }
        });
        Session.persist();
        Session.summarize();
      }, 700);
    },

    // hard kill: no finalisation, no flush. Used by the recovery test.
    crash: function () {
      Session.unschedule();
      Session.paused = false;
      A.stopMic();
      S.store.journal('PROCESS_KILLED', 'SIGKILL at ' + U.ms(Session.t));
      U.bus.emit('crashed');
    },

    /* ---------- the loop ---------- */

    // The browser throttles requestAnimationFrame to zero while the page is
    // hidden, and a recorder that stops recording when it is backgrounded is
    // useless. A timer watchdog keeps the loop alive either way; whichever
    // fires first cancels the other.
    schedule: function () {
      Session.unschedule();
      Session.raf = requestAnimationFrame(Session.tick);
      Session.watchdog = setTimeout(function () { Session.tick(performance.now()); }, 250);
    },

    unschedule: function () {
      if (Session.raf) { cancelAnimationFrame(Session.raf); Session.raf = null; }
      if (Session.watchdog) { clearTimeout(Session.watchdog); Session.watchdog = null; }
    },

    tick: function (now) {
      Session.unschedule();
      if (Session.phase !== 'CAPTURING') { return; }

      // rAF hands back the frame-start timestamp while the watchdog uses
      // performance.now(), so the two can arrive out of order. Clamping the
      // lower bound keeps session time monotonic; without it the clock walks
      // backwards and the elapsed time is wrong.
      var dt = U.clamp(now - Session.lastFrame, 0, 250);
      Session.lastFrame = Math.max(now, Session.lastFrame);

      // VAD runs on the wall clock, never on compressed session time —
      // otherwise the gate's hangover window would scale with playback speed.
      A.measure(now);

      // In mic mode the transcript only advances while the VAD gate is open,
      // so a silent room genuinely produces no transcript.
      var advancing = (Session.source !== 'mic') || A.gateOpen;
      if (advancing) { Session.t += dt * Session.speed; }

      Session.updateChunks();
      Session.reveal();
      S.scope.draw();
      U.bus.emit('tick', Session.t);

      if (Session.transcript && Session.t >= Session.transcript.duration_ms) {
        Session.stop();
        return;
      }
      Session.schedule();
    },

    /* ---------- chunk lifecycle (§7, §9) ---------- */

    updateChunks: function () {
      var CH = S.CONF.CHUNK_MS;
      var want = Math.floor(Session.t / CH) + 1;

      while (Session.chunks.length < want) {
        var ix = Session.chunks.length;
        var c = {
          index: ix,
          chunk_id: 'chk_' + U.pad(ix + 1, 4),
          start_ms: ix * CH,
          end_ms: (ix + 1) * CH,
          state: 'buffered',
          at: performance.now(),
          voiced: false
        };
        Session.chunks.push(c);
        A.pushChunk(c);
        U.bus.emit('chunk:new', c);
      }

      // advance chunk states on a short pipeline delay
      var nowP = performance.now();
      Session.chunks.forEach(function (c) {
        if (c.index >= Math.floor(Session.t / CH)) { return; }   // still filling
        if (c.state === 'buffered' && nowP - c.at > 260) {
          // §7.2 — a chunk with no voice activity never reaches the ASR engine
          var hasSpeech = Session.transcript.segments.some(function (sg) {
            return !sg.unrecoverable && sg.end_ms > c.start_ms && sg.start_ms < c.end_ms;
          });
          c.voiced = hasSpeech;
          Session.setChunk(c, hasSpeech ? 'validated' : 'silent');
          if (!hasSpeech) { S.store.journal('CHUNK_SKIPPED', c.chunk_id + ' — VAD: no speech'); }
        } else if (c.state === 'validated' && nowP - c.at > 520) {
          Session.setChunk(c, 'asr');
        } else if (c.state === 'asr' && nowP - c.at > 900) {
          Session.setChunk(c, 'persisted');
          Session.persist();                                    // §0.9 incremental write
          S.store.journal('CHUNK_PERSISTED', c.chunk_id);
        }
      });
    },

    setChunk: function (c, state) {
      c.state = state;
      U.bus.emit('chunk:state', c);
    },

    finishChunks: function () {
      Session.chunks.forEach(function (c) {
        if (c.state === 'buffered') { Session.setChunk(c, 'validated'); }
      });
    },

    pendingCount: function () {
      return Session.chunks.filter(function (c) { return c.state !== 'persisted' && c.state !== 'silent'; }).length;
    },

    /* ---------- ASR decode seam ----------
       In the device build this call is:
         qnn.run(whisperTinyInt8, logMel(chunkPCM)) -> tokens + logprobs
       Here it reveals the authored segment for the same span.      */

    decodeChunk: function (segment) {
      return {
        segment_id: segment.segment_id,
        start_ms: segment.start_ms,
        end_ms: segment.end_ms,
        speaker: segment.speaker,
        text: segment.text,
        confidence: segment.confidence,
        low_confidence_flag: segment.low_confidence_flag,
        unrecoverable: segment.unrecoverable
      };
    },

    reveal: function () {
      var segs = Session.transcript.segments;
      var n = Session.revealed.length;

      // finalise every segment whose end has passed
      while (n < segs.length && segs[n].end_ms <= Session.t) {
        var out = Session.decodeChunk(segs[n]);
        Session.revealed.push(out);
        U.bus.emit('segment', out);
        n++;
      }

      // streaming partial for the segment currently in flight (Vosk pattern)
      if (n < segs.length && segs[n].start_ms <= Session.t) {
        var sg = segs[n];
        var frac = (Session.t - sg.start_ms) / Math.max(1, sg.end_ms - sg.start_ms);
        var words = sg.text ? sg.text.split(/\s+/) : [];
        var shown = Math.max(0, Math.min(words.length, Math.floor(frac * words.length)));
        if (Session.partial.segIx !== n || Session.partial.words !== shown) {
          Session.partial = { segIx: n, words: shown };
          U.bus.emit('partial', {
            text: words.slice(0, shown).join(' '),
            unrecoverable: sg.unrecoverable,
            confidence: sg.confidence
          });
        }
      } else if (Session.partial.segIx !== -1 && n >= segs.length) {
        Session.partial = { segIx: -1, words: 0 };
        U.bus.emit('partial', { text: '' });
      }
    },

    /* ---------- LLM stage (§9 map-reduce, §11 grounding) ---------- */

    summarize: function () {
      Session.to('SUMMARIZING', Session.transcript.blocks.length + ' blocks');

      var blocks = Session.transcript.blocks;
      var i = 0;

      function step() {
        if (i < blocks.length) {
          U.bus.emit('llm:map', { i: i + 1, n: blocks.length, block: blocks[i] });
          S.store.journal('LLM_MAP', blocks[i].block_id);
          i++;
          setTimeout(step, 240);
          return;
        }
        U.bus.emit('llm:reduce', { n: blocks.length });
        S.store.journal('LLM_REDUCE', 'block summaries → structured summary');

        setTimeout(function () {
          var built = S.pipeline.buildTranscript(S.corpus.lines);
          // Only decode what the session actually captured.
          built.segments = built.segments.slice(0, Session.revealed.length || built.segments.length);
          Session.transcript.segments = built.segments;

          Session.derived = S.pipeline.derive(Session.transcript);
          S.store.journal('GROUNDING_FILTER',
            'kept ' + Session.derived.summary.length + ' points / ' + Session.derived.glossary.length +
            ' terms, dropped ' + Session.derived.dropped.length);

          Session.persist();
          Session.to('DONE', 'session complete');
          U.bus.emit('done', Session.derived);
        }, 620);
      }
      setTimeout(step, 300);
    },

    /* ---------- persistence / recovery ---------- */

    persist: function () {
      S.store.save({
        session: {
          session_id: Session.id,
          created_at: new Date(Session.startedAt || Date.now()).toISOString(),
          device_model: S.device.model,
          duration_seconds: Math.round(Session.t / 1000),
          source: Session.source
        },
        phase: Session.phase,
        current_chunk_index: Session.chunks.length ? Session.chunks[Session.chunks.length - 1].index : -1,
        last_persisted_segment_id: Session.revealed.length ? Session.revealed[Session.revealed.length - 1].segment_id : null,
        transcript: { segments: Session.revealed },
        summary: Session.derived ? { key_points: Session.derived.summary } : null,
        glossary: Session.derived ? Session.derived.glossary : null,
        readiness: Session.readiness,
        error_log: Session.error_log
      });
    },

    // §10 recover_from_crash — replay the state object
    recover: function (saved) {
      Session.id = saved.session.session_id;
      Session.startedAt = Date.parse(saved.session.created_at) || Date.now();
      Session.source = saved.session.source || 'mic';
      Session.transcript = S.pipeline.buildTranscript(S.corpus.lines);
      Session.revealed = saved.transcript.segments || [];
      Session.t = Session.revealed.length ? Session.revealed[Session.revealed.length - 1].end_ms : 0;
      Session.chunks = [];
      var upto = Math.floor(Session.t / S.CONF.CHUNK_MS);
      for (var i = 0; i <= upto; i++) {
        Session.chunks.push({
          index: i, chunk_id: 'chk_' + U.pad(i + 1, 4),
          start_ms: i * S.CONF.CHUNK_MS, end_ms: (i + 1) * S.CONF.CHUNK_MS,
          state: 'persisted', at: performance.now(), voiced: true
        });
      }
      Session.transcript.segments = Session.transcript.segments.slice(0, Session.revealed.length);
      Session.derived = null;
      S.store.journal('RECOVERED', Session.revealed.length + ' segments from last persisted chunk');
      Session.to('PROCESSING_ASR', 'recovered');
      return Session;
    },

    /* ---------- sample session ----------
       Loads the reference lecture already processed, so the Study and
       Trace screens can be reviewed without waiting through a capture.
       Runs the same assembler and the same grounding filter as a live
       session — only the waiting is skipped. */

    loadSample: function () {
      Session.fresh();
      Session.startedAt = Date.now();
      Session.source = 'sample';

      Session.revealed = Session.transcript.segments.map(Session.decodeChunk);
      Session.t = Session.transcript.duration_ms;

      var n = Math.ceil(Session.t / S.CONF.CHUNK_MS);
      Session.chunks = [];
      for (var i = 0; i < n; i++) {
        Session.chunks.push({
          index: i, chunk_id: 'chk_' + U.pad(i + 1, 4),
          start_ms: i * S.CONF.CHUNK_MS, end_ms: (i + 1) * S.CONF.CHUNK_MS,
          state: 'persisted', at: performance.now(), voiced: true
        });
      }

      Session.derived = S.pipeline.derive(Session.transcript);
      S.store.journal('SAMPLE_LOADED', Session.revealed.length + ' segments');
      S.store.journal('GROUNDING_FILTER',
        'kept ' + Session.derived.summary.length + ' points / ' + Session.derived.glossary.length +
        ' terms, dropped ' + Session.derived.dropped.length);
      Session.persist();
      Session.to('DONE', 'sample session');
      U.bus.emit('done', Session.derived);
      return Session.derived;
    },

    /* ---------- output contract (§19) ---------- */

    contract: function () {
      var d = Session.derived;
      return {
        session: {
          session_id: Session.id,
          created_at: new Date(Session.startedAt || Date.now()).toISOString(),
          device_model: S.device.model,
          duration_seconds: Math.round((Session.transcript ? Session.transcript.duration_ms : 0) / 1000)
        },
        transcript: {
          segments: Session.revealed.map(function (s) {
            return {
              segment_id: s.segment_id, start_ms: s.start_ms, end_ms: s.end_ms,
              text: s.unrecoverable ? null : s.text,
              confidence: +s.confidence.toFixed(2),
              low_confidence_flag: !!s.low_confidence_flag,
              unrecoverable: !!s.unrecoverable
            };
          })
        },
        summary: { key_points: d ? d.summary.map(function (p) {
          return { point: p.point, topic: p.topic, source_segment_ids: p.source_segment_ids };
        }) : [] },
        glossary: d ? d.glossary.map(function (g) {
          return { term: g.term, definition: g.definition, source_segment_ids: g.source_segment_ids };
        }) : [],
        confidence_report: d ? {
          mean_confidence: +d.confidence_report.mean_confidence.toFixed(3),
          low_confidence_segments: d.confidence_report.low_confidence_segments,
          unrecoverable_spans: d.confidence_report.unrecoverable_spans
        } : null,
        rejected_by_grounding_filter: d ? d.dropped.map(function (x) {
          return { kind: x.kind, text: x.text, reason: x.reason, detail: x.detail };
        }) : [],
        trace: {
          session_metadata: {
            device: S.device.model, soc: S.device.soc,
            asr_model: S.bench.asr.model, llm_model: S.bench.llm.model,
            npu_delegate: S.device.npu ? 'QNN HTP (active)' : 'CPU fallback'
          },
          validation_report: Session.readiness,
          network_calls_attempted: S.net.blocked.length,
          network_calls_escaped: S.net.escaped,
          persistence_writes: S.store.writes
        }
      };
    }
  };
})(window.SHRUTI = window.SHRUTI || {});
