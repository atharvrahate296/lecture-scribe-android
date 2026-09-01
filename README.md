# Shruti — Offline Lecture Transcriber & Summariser

**Working prototype for the spec in [`offline-lecture-transcriber-spec.md`](offline-lecture-transcriber-spec.md).**
Reference device: iQOO 15 · Snapdragon 8 Elite Gen 5.

> *Shruti* (श्रुति) — "that which is heard." The oral record, before anyone wrote it down.

Open [`index.html`](index.html) in a browser. No server, no install, no network.
Or open the single-file build at `dist/shruti.html`.

**For a demo or a pitch video**, two controls in the top-right need no microphone and no setup:

- **Play demo** — runs the whole pipeline start to finish and lands on the Study screen.
  About 25 s at the default rate: ~4 s readiness checks, ~17 s of live capture, ~3 s
  summarisation. Drop the capture rate to *Sprint 110×* for a ~10 s run, or *Real time 1×*
  if you want to talk over it.
- **Load sample session** — jumps straight to the finished lecture, instantly. Same
  assembler, same grounding filter; only the waiting is skipped.

---

## What this prototype is

The spec's thesis is not "transcribe lectures." It is:

> maximise the probability that a student can **trust** the transcript, summary and
> glossary as a faithful record of what was said — entirely offline, on a phone NPU.

So the prototype is built to make trust *inspectable*. Every screen answers a question a
sceptical judge would ask:

| Screen | Answers |
|---|---|
| **Preflight** | Can this device finish a 90-minute session without losing audio? (§8) |
| **Capture** | Where is the audio right now, and what happens if the phone rings? (§7, §13) |
| **Study** | Which exact words support this summary point? (§6, §11) |
| **Evidence** | How do I check any of this rather than believe it? (§12–§14, §18) |
| **Trace** | The §21 question: *how do you know this is correct?* |

### The design decision that drives the interface

The spec's §0.10 requires three visible trust tiers. Here they are encoded in **typeface**,
so you can tell what you are allowed to trust by how it is set:

- **Serif** — the verbatim transcript. Human speech, highest trust, never rewritten.
- **Mono** — machine-generated data: segment ids, timestamps, confidence scores.
- **Sans** — interface chrome.

Colour is reserved for meaning, never decoration: green = grounded/verified,
amber = low confidence, red = rejected/unrecoverable, blue = a citation link,
and one warm red used *only* for live recording.

---

## What is real vs. simulated

This is a browser prototype of an Android/NPU application, so it is worth being exact
about which parts are genuinely running. The app labels this itself; it is not hidden.

**Genuinely real, running in your browser:**

- **The offline seal.** `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and
  `sendBeacon` are replaced at boot with traps that refuse the call and write it to an
  append-only violation log. The Evidence screen lets you fire real calls at it and watch
  them be refused. (`assets/js/core.js`)
- **Microphone capture, RMS metering and the VAD gate** with hysteresis and a hangover
  window. In mic mode the transcript only advances while the gate is open — stop talking
  and it stops. (`assets/js/audio.js`)
- **Audio-file validation.** The sample rate, channel count and duration are read from the
  decoded stream, never assumed. A truncated or corrupt file is refused before any
  transcription is attempted. (§7.1, §7.3)
- **The bounded ring buffer.** Decoded PCM is released, not accumulated — 180 chunks
  (90 minutes) hold the same memory as 12.
- **Incremental persistence and crash recovery.** Every persisted chunk writes to local
  storage with an append-only controller journal. Force-kill the app from the Capture
  screen, reload, and the session is recovered from the last persisted chunk.
- **The grounding filter.** This is the heart of §11 and it is ordinary, checkable code
  (`assets/js/pipeline.js`). Nothing about it is mocked.
- **9 of the 10 robustness tests** in §13 execute real assertions against real code paths.
  Each row is tagged `LIVE` or `DEVICE` so you can see which is which.

**Simulated at a documented seam:**

- **ASR decode.** `Session.decodeChunk()` in `assets/js/session.js` is where the device
  build calls `whisper-tiny.en INT8` through the QNN HTP delegate. Here it returns the
  authored transcript for the same time span. Timestamps, segment ids, block boundaries
  and the low-confidence flag are all *computed*, never authored (§6: system-resolved).
- **LLM summarisation.** The map-reduce stage runs over real blocks and emits real
  progress, but the candidate points and terms are authored rather than generated. They
  then pass through the **real** grounding filter — which is the part that matters.
- **NPU/battery/storage figures** on the Preflight screen fall back to a device profile
  where the browser exposes no equivalent API. Live values are used wherever the platform
  provides them.

---

## The grounding filter

The spec forbids the summariser or glossary from introducing anything the transcript does
not support (§20.3, §20.7). This is enforced mechanically, in two passes.

**1. Citation integrity.** Every claimed `source_segment_id` must resolve to a segment that
actually exists, is not an unrecoverable band, and is not below the confidence floor. A
fabricated citation dies here.

**2. Lexical grounding.** The generated text must share enough distinctive vocabulary with
the spans it cites (≥ 2 content words and ≥ 45% overlap). A fluent sentence about something
never said dies here, even when its citations are real.

Anything that fails is **dropped**, never shown with a caveat — an ungrounded claim is
worse than a missing one. Dropped candidates are listed under **Rejected** with the reason,
because a system that quietly discards things is just another kind of opaque.

On the bundled demo session it rejects six candidates:

```
[NOT_GROUNDED]       "FIFO suffers from Belady's anomaly…"
                     only 1/12 content words appear in the cited spans (8% < 45% floor)
[NOT_GROUNDED]       "Inverted page tables were recommended…"
                     only 3/12 content words appear in the cited spans (25% < 45% floor)
[CITATION_INTEGRITY] "Copy-on-write was described as…"
                     index 999 — no such segment
[TERM_NOT_SPOKEN]    "Belady's anomaly"    string does not occur in any segment
[TERM_NOT_SPOKEN]    "copy-on-write"       string does not occur in any segment
[TERM_NOT_SPOKEN]    "inverted page table" string does not occur in any segment
```

Every surviving glossary term shows the verbatim sentence it was heard in, with the term
highlighted. Click any summary point and curves are drawn to the exact transcript segments
it cites.

---

## The demo session

A recitation excerpt from **CS3006 Operating Systems, Lecture 14 — Virtual Memory: Paging,
the TLB & Thrashing.** 11 minutes, 68 segments, deliberately realistic for the target
setting:

- Indian-classroom acoustics with a projector-fan noise band
- English/Hindi code-switching (*"Samajh gaye?"*, *"Bilkul sahi"*, *"exam mein aata hai"*)
  which lands **7 segments below the confidence floor** — flagged and hatched, never
  smoothed into a confident-sounding all-English guess
- **one 68-second unrecoverable span**, marked with its time range and excluded from the
  summary rather than filled in
- student cross-talk and silence gaps, one of which the VAD skips before it ever reaches
  the ASR engine

Full-length reliability numbers (3 × 74–92 min runs), WER by acoustic condition, and the
ablation table on the Evidence screen are reference-device measurements, kept clearly
separate from anything derived from the live session.

---

## Try these

1. **Play demo** (top right) for the whole story in one click, or **Preflight → Run
   readiness check** to watch it resolve `READY` / `DEGRADED` / `BLOCKED` on its own.
   Degraded still records — losing audio is the worst outcome available.
2. **Capture → Start capture.** Allow the microphone and talk: the VAD gate opens, the
   waveform turns red, chunks move `buffered → validated → ASR → persisted`. Go quiet and
   it holds. (No microphone? It falls back to the captured lecture automatically.)
3. **Force-kill the app** mid-session, then reload the page. The session is recovered from
   the last persisted chunk and re-summarised.
4. **Study → click any summary point.** Curves are drawn to the exact segments cited.
   Open **Rejected** to see what the filter refused.
5. **Evidence → Attempt fetch.** A real network call, really refused. Then **Run all 10**.
6. **Trace → Export Markdown.** Low-confidence lines are marked `⚠︎` in the export too.

Keyboard: <kbd>1</kbd>–<kbd>5</kbd> switch screens, <kbd>/</kbd> searches the transcript,
<kbd>Esc</kbd> clears citation links.

---

## Layout

```
index.html                  app shell and markup
assets/styles/
  tokens.css                palette, type scale, spacing
  app.css                   shell and primitives
  views.css                 per-view composition
assets/js/
  core.js                   utilities, network guard, persistent store
  corpus.js                 demo lecture + raw LLM candidates
  pipeline.js               transcript assembly, grounding filter, bench data
  audio.js                  mic capture, VAD, ring buffer, waveform
  preflight.js              readiness checks (§8)
  session.js                phase controller (§10)
  views.js                  rendering
  app.js                    wiring, robustness suite, exports
build.mjs                   inlines everything into dist/
docs/shots/                 screenshots of each screen
```

Plain `<script>` tags and a `SHRUTI` namespace — no modules, no build step required,
so `file://` works. That is deliberate: an offline-only product should not need a server
to open.

```bash
node build.mjs      # → dist/shruti.html, a single self-contained file
```

---

## Honest gaps

- **Code-switched WER is 27.3%, above the 20% threshold.** Acceptance gate 3 is marked
  *partial*, not passed. The mitigation is confidence flagging, not a claim that the
  problem is solved (§15).
- **No speaker diarisation.** Tier C in §16; speaker tags in the transcript are
  best-effort role markers, not identity.
- The prototype does not ship the ONNX/GGUF weights or the QNN delegate — those belong to
  the device build.
