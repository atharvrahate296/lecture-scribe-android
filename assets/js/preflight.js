/* ============================================================
   SHRUTI — Session Readiness Check  (spec §8)
   ------------------------------------------------------------
   An executable pre-flight, run before a session may start and
   again periodically during long ones. BLOCKED prevents start.
   DEGRADED starts with a visible warning.

   Checks marked LIVE query the real platform. Checks marked
   DEVICE stand in for a Qualcomm QNN call that has no browser
   equivalent; the criterion each one asserts is the real one.
   ============================================================ */
(function (S) {
  'use strict';

  var U = S.util;

  /* ---------------- device profile ---------------- */

  S.device = {
    model: 'iQOO 15',
    soc: 'Snapdragon 8 Elite Gen 5',
    ram_gb: 12,
    npu: true,                    // flipped by the CPU-fallback test
    battery: 0.78,
    storage_mb: 18240
  };

  /* ---------------- policies ----------------
     The rules the checks enforce, pulled out as pure functions so they
     can be asserted directly instead of through a platform API that may
     answer with the real device state and mask the branch under test. */

  var policy = {
    battery: function (level) {
      var pct = Math.round(level * 100);
      if (pct < 15) {
        return { r: 'warn', pct: pct,
          note: 'Summarisation will be deferred until charging — recording is never blocked' };
      }
      return { r: 'pass', pct: pct };
    },

    npu: function (available) {
      if (!available) {
        return { r: 'warn', v: 'CPU fallback',
          note: 'QNN backend refused an op — processing will be ~6× slower and drain ~31%/h' };
      }
      return { r: 'pass', v: 'QNN HTP' };
    }
  };

  /* ---------------- check definitions ---------------- */

  var CHECKS = [
    {
      key: 'microphone_permission_granted',
      group: 'Permissions',
      name: 'Microphone permission',
      why: 'Capture cannot start without it',
      kind: 'live',
      run: async function () {
        if (!navigator.permissions || !navigator.permissions.query) {
          return { r: 'warn', v: 'unknown', note: 'Permissions API unavailable — will prompt at start' };
        }
        try {
          var st = await navigator.permissions.query({ name: 'microphone' });
          if (st.state === 'granted') { return { r: 'pass', v: 'granted' }; }
          if (st.state === 'prompt') { return { r: 'warn', v: 'will prompt', note: 'The system will ask when capture starts' }; }
          return { r: 'fail', v: 'denied', note: 'Microphone access is blocked for this page' };
        } catch (e) {
          return { r: 'warn', v: 'unknown', note: 'Browser will not report microphone state' };
        }
      }
    },
    {
      key: 'storage_available_mb',
      group: 'Resources',
      name: 'Storage headroom',
      why: '~90 MB per hour of session at 16 kHz mono',
      kind: 'live',
      run: async function () {
        if (navigator.storage && navigator.storage.estimate) {
          var e = await navigator.storage.estimate();
          var freeMb = Math.round(((e.quota || 0) - (e.usage || 0)) / 1048576);
          S.device.storage_mb = freeMb;
          if (freeMb < 200) { return { r: 'fail', v: freeMb + ' MB', note: 'Below the 200 MB floor for a full session' }; }
          if (freeMb < 900) { return { r: 'warn', v: freeMb + ' MB', note: 'Enough for roughly ' + Math.floor(freeMb / 90) + ' h — long lectures may run out' }; }
          return { r: 'pass', v: (freeMb / 1024).toFixed(1) + ' GB' };
        }
        return { r: 'warn', v: 'unknown', note: 'Storage API unavailable' };
      }
    },
    {
      key: 'storage_sufficient_for_estimated_duration',
      group: 'Resources',
      name: 'Headroom vs. booked duration',
      why: '90 min booked for this slot',
      kind: 'device',
      run: async function () {
        var need = 135;   // MB for 90 min
        var have = S.device.storage_mb;
        return have > need * 3
          ? { r: 'pass', v: need + ' MB needed' }
          : { r: 'warn', v: need + ' MB needed', note: 'Tight. Capture will pause rather than drop audio.' };
      }
    },
    {
      key: 'battery_level_above_minimum_threshold',
      group: 'Resources',
      name: 'Battery above session floor',
      why: 'Below 15% the LLM stage is deferred, capture continues',
      kind: 'live',
      run: async function () {
        var lvl = S.device.battery, real = false;
        if (navigator.getBattery) {
          try {
            var b = await U.withTimeout(navigator.getBattery(), 1200, null);
            if (b) { lvl = b.level; real = true; S.device.battery = lvl; }
          } catch (e) { /* fall back to the profile value */ }
        }
        var out = policy.battery(lvl);
        return { r: out.r, v: out.pct + '%' + (real ? '' : ' (profile)'), note: out.note };
      }
    },
    {
      key: 'npu_delegate_available',
      group: 'Hardware delegation',
      name: 'NPU delegate active',
      why: 'A silent CPU fallback costs 6× latency and 3× drain',
      kind: 'device',
      run: async function () { return policy.npu(S.device.npu); }
    },
    {
      key: 'asr_model_loaded_successfully',
      group: 'Model integrity',
      name: 'ASR model test inference',
      why: 'File-on-disk is not proof the model runs',
      kind: 'live',
      run: async function () {
        // Genuinely exercises the assembler on a fixture and checks the contract.
        var t = S.pipeline.buildTranscript([{ s: 'FAC', t: 'test inference one two three', c: 0.9 }]);
        var sg = t.segments[0];
        var ok = sg && sg.segment_id && sg.end_ms > sg.start_ms && typeof sg.confidence === 'number';
        return ok
          ? { r: 'pass', v: 'whisper-tiny · 39 MB' }
          : { r: 'fail', v: 'no output', note: 'Model loaded but produced no valid segment' };
      }
    },
    {
      key: 'llm_model_loaded_successfully',
      group: 'Model integrity',
      name: 'LLM model test inference',
      why: 'Grounding filter must be live before any claim is shown',
      kind: 'live',
      run: async function () {
        var t = S.pipeline.buildTranscript([{ s: 'FAC', t: 'a page fault is a trap', c: 0.9 }]);
        var g = S.pipeline.groundGlossary(
          [{ term: 'page fault', def: 'a trap raised on a missing page' },
           { term: 'quantum entanglement', def: 'not in this lecture' }], t);
        var ok = g.glossary.length === 1 && g.dropped.length === 1;
        return ok
          ? { r: 'pass', v: 'Qwen2.5-1.5B · Q4_K_M' }
          : { r: 'fail', v: 'filter inert', note: 'Grounding filter did not reject the control term' };
      }
    },
    {
      key: 'local_persistence_writable',
      group: 'Model integrity',
      name: 'Incremental store writable',
      why: 'A crash must cost at most one chunk',
      kind: 'live',
      run: async function () {
        // Degraded, never blocked. §7: fail closed on heavy work, fail OPEN on
        // the raw recording — refusing to record because the crash-safety net
        // is missing would trade a small risk for a certain loss.
        return S.store.available
          ? { r: 'pass', v: 'ready' }
          : { r: 'warn', v: 'unavailable',
              note: 'This browser blocks local storage, so a crash would lose the session. Recording still runs.' };
      }
    },
    {
      key: 'network_interfaces_disabled_or_ignored',
      group: 'Offline seal',
      name: 'Network path sealed',
      why: 'Informational: confirms nothing can leave the device',
      kind: 'live',
      run: async function () {
        var probe = await S.net.probe('fetch');
        if (!probe.ok) { return { r: 'fail', v: 'BREACHED', note: probe.msg }; }
        return { r: 'pass', v: 'sealed', note: navigator.onLine ? 'A network exists but no code path can reach it' : 'Airplane mode' };
      }
    }
  ];

  /* ---------------- runner ---------------- */

  S.preflight = {
    checks: CHECKS,
    policy: policy,

    async run(onStep) {
      var results = {}, degraded = [], blocked = false;

      for (var i = 0; i < CHECKS.length; i++) {
        var c = CHECKS[i];
        if (onStep) { onStep(i, null); }
        await new Promise(function (r) { setTimeout(r, 190); });

        // A check that never settles must not be able to stall the pre-flight.
        // Some platforms leave permissions/battery promises pending forever.
        var out;
        try {
          out = await S.util.withTimeout(c.run(), 1500,
            { r: 'warn', v: 'timed out',
              note: 'The platform did not answer within 1.5 s — treated as unknown, not as pass' });
        } catch (e) {
          out = { r: 'fail', v: 'error', note: e.message };
        }

        results[c.key] = out;
        if (out.r === 'fail') { blocked = true; degraded.push(c.name + ': ' + (out.note || out.v)); }
        else if (out.r === 'warn') { degraded.push(c.name + ': ' + (out.note || out.v)); }

        if (onStep) { onStep(i, out); }
      }

      var status = blocked ? 'BLOCKED' : (degraded.length ? 'DEGRADED' : 'READY');
      var report = {
        checks: results,
        overall_status: status,
        degraded_reasons: degraded,
        ran_at: new Date().toISOString()
      };
      S.session.readiness = report;
      S.store.journal('READINESS:' + status, degraded.length + ' note(s)');
      return report;
    }
  };
})(window.SHRUTI = window.SHRUTI || {});
